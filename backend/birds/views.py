import datetime

from django.db.models import Count, Q
from django.http import HttpResponse
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .iwm_export import build_iwm_workbook
from .models import (
    FALLBACK_BERINGER_HANDLE,
    DataEntry,
    Organization,
    Project,
    Ring,
    RingingStation,
    Scientist,
    Species,
    SpeciesList,
)
from .serializers import (
    DataEntrySerializer,
    OrganizationSerializer,
    ProjectSerializer,
    RingingStationSerializer,
    RingSerializer,
    ScientistSerializer,
    SpeciesListSerializer,
    SpeciesSerializer,
)
from .tenancy import active_organization


def _require_active_organization(user):
    """Resolve the requester's active Organisation or refuse the write (403).

    The shared guard behind every org-attaching create — capture, Beringer and
    Projekt alike: a row must belong to a tenant, so without a resolvable active
    Organisation the write cannot proceed (ADR 0005). Resolution itself lives in
    ``birds.tenancy.active_organization``; this only adds the HTTP-refusal policy.
    """
    organization = active_organization(user)
    if organization is None:
        raise PermissionDenied("Keine aktive Organisation — eine Mitgliedschaft ist erforderlich.")
    return organization


class DataEntryPagination(PageNumberPagination):
    """Pagination scoped to the data-entries list (selectable 10/50/100)."""

    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100


class DataEntryViewSet(viewsets.ModelViewSet):
    pagination_class = DataEntryPagination
    queryset = (
        DataEntry.objects.select_related(
            "species", "ring", "staff", "ringing_station", "project", "project__organization"
        )
        .all()
        .order_by("-date_time")
    )
    serializer_class = DataEntrySerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["species__common_name_de", "species__scientific_name"]

    def get_queryset(self):
        """
        Scopes captures to the requester's active Organisation (the tenant
        boundary — ADR 0005): a Mitglied of one Organisation sees only its
        captures, and a cross-tenant row is simply absent from the queryset, so
        a detail/write against it is a 404 (not a 403). An account with no
        resolvable active Organisation sees an empty list (mirrors
        ``ProjectViewSet`` — empty, not a 403).

        Within that scope the queryset is optionally filtered by ring_size and
        ring_number if they are provided as query parameters.
        """
        organization = active_organization(self.request.user)
        if organization is None:
            return DataEntry.objects.none()
        queryset = super().get_queryset().filter(organization=organization)
        ring_size = self.request.query_params.get("ring_size")
        ring_number = self.request.query_params.get("ring_number")
        project = self.request.query_params.get("project")

        if ring_size and ring_number:
            queryset = queryset.filter(ring__size=ring_size, ring__number=ring_number)

        if project:
            queryset = queryset.filter(project=project).order_by("-created")

        return queryset

    def perform_create(self, serializer):
        """Attach the new capture to the requester's active Organisation.

        A capture cannot be recorded without an active Organisation to own it, so
        an account with no resolvable membership is refused (ADR 0005).
        """
        serializer.save(organization=_require_active_organization(self.request.user))


class SpeciesViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SpeciesSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["common_name_de", "scientific_name"]

    def get_queryset(self):
        """
        Candidate species are filtered exactly as before: an active species
        list narrows the set to its members plus the always-selectable Sonderart
        rows (every Species whose ``special_kind`` is set — "Ring Vernichtet" and
        "Aves ignota"); otherwise all species are candidates. Frequency only
        reorders the candidates — see ``_order_by_usage``.
        """
        user = self.request.user
        active_list = SpeciesList.objects.filter(user=user, is_active=True).first()
        if active_list:
            candidate_ids = Species.objects.filter(
                Q(lists=active_list) | ~Q(special_kind="")
            ).values_list("id", flat=True)
            candidates = Species.objects.filter(id__in=candidate_ids)
        else:
            candidates = Species.objects.all()

        return self._order_by_usage(candidates, self.request.query_params.get("project"))

    @staticmethod
    def _order_by_usage(candidates, project):
        """
        Order candidate species by how often they are actually used — most-used
        first, alphabetically within equal counts. Usage is the number of related
        data entries, scoped to the current project when it has any; when the
        project is empty or unknown the count falls back to a global one, mirroring
        the project/global fallback of the ring-number suggestion (issue #27).
        """
        if project and DataEntry.objects.filter(project=project).exists():
            usage = Count("dataentry", filter=Q(dataentry__project=project))
        else:
            usage = Count("dataentry")
        return candidates.annotate(usage=usage).order_by("-usage", "common_name_de")


class SpeciesListViewSet(viewsets.ModelViewSet):
    """
    API endpoint for creating and managing user-specific species lists.
    """

    serializer_class = SpeciesListSerializer

    def get_queryset(self):
        """
        This view should only return the lists for the currently authenticated user.
        """
        return (
            SpeciesList.objects.filter(user=self.request.user)
            .prefetch_related("species")
            .order_by("name")
        )

    def perform_create(self, serializer):
        """
        Automatically associate the new species list with the logged-in user.
        """
        serializer.save(user=self.request.user)


class RingViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Ring.objects.all()
    serializer_class = RingSerializer

    @action(detail=False, methods=["get"], url_path="next-number")
    def next_number(self, request):
        """
        Suggests the next ring number for a given ring size.

        The suggestion is the *last consumed* number on the rope, incremented by
        one — i.e. it follows the most recently created (``created``) capture in
        the project that drew a fresh number from the rope, never ``max + 1``.
        A capture consumes a number when it is a first catch (Erstfang) **or** a
        destroyed-ring record (``species.special_kind == "ring_destroyed"``);
        recaptures (Wiederfang) consume nothing and are excluded. The recording
        Beringer is irrelevant.

        The numeric value is incremented while the original width is preserved,
        so ``0042`` → ``0043``. The response is ``{"next_number": <string>}``,
        or ``{"next_number": null}`` when the project has no qualifying capture
        of that size or the previous number is non-numeric. See issues #22, #42.
        """
        ring_size = request.query_params.get("size")
        if not ring_size:
            return Response({"error": "Ring size parameter is required."}, status=400)

        project = request.query_params.get("project")

        consumptions = DataEntry.objects.filter(ring__size=ring_size).filter(
            Q(bird_status=DataEntry.BirdStatus.FIRST_CATCH)
            | Q(species__special_kind=Species.SpecialKind.RING_DESTROYED)
        )
        if project:
            consumptions = consumptions.filter(project=project)

        latest = consumptions.select_related("ring").order_by("-created").first()
        return Response({"next_number": self._increment(latest.ring.number) if latest else None})

    @staticmethod
    def _increment(number):
        """Increment a ring number while preserving its leading-zero width.

        Returns ``None`` for a non-numeric number (nothing sensible to suggest).
        """
        if not number.isdigit():
            return None
        return f"{int(number) + 1:0{len(number)}d}"


class RingingStationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RingingStationSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "handle"]

    def get_queryset(self):
        """Scope Stationen to the requester's active Organisation (the tenant
        boundary — ADR 0005, issue #74): a Mitglied sees only its Organisation's
        Stationen, so a cross-tenant detail fetch is a 404 (the row is absent),
        not a 403. No active Organisation ⇒ empty list (mirrors the capture
        endpoint). The optional ``?organization=<handle>`` filter is preserved but
        can only narrow within the already-scoped set."""
        organization = active_organization(self.request.user)
        if organization is None:
            return RingingStation.objects.none()
        queryset = (
            RingingStation.objects.select_related("organization")
            .filter(organization=organization)
            .order_by("name")
        )
        handle = self.request.query_params.get("organization")
        if handle:
            queryset = queryset.filter(organization__handle=handle)
        return queryset


class ScientistViewSet(mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """List/retrieve plus authenticated create.

    A Beringer can be created mid-session with no linked account (an unknown
    Kürzel prompts a "Neuer Beringer" dialog); editing and deletion stay closed.
    The reserved fallback Beringer (Kürzel ``GELÖSCHT``, which adopts a deleted
    Beringer's captures) is excluded so no fresh capture is filed against it.
    See ADR 0001-account-independent-beringer and ADR 0003.
    """

    serializer_class = ScientistSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["handle", "first_name", "last_name"]

    def get_queryset(self):
        """Scope the Beringer autocomplete to the requester's active Organisation
        (the tenant boundary — ADR 0005, issue #74): only own-Organisation
        Beringer (Mitglieder and No-Account alike) appear, so a cross-tenant
        detail fetch is a 404. The reserved ``GELÖSCHT`` fallback is org-less, so
        the org filter already drops it; the explicit ``exclude`` keeps that
        intent loud and survives even were the sink ever mis-assigned an
        Organisation (ADR 0003). No active Organisation ⇒ empty list."""
        organization = active_organization(self.request.user)
        if organization is None:
            return Scientist.objects.none()
        return (
            Scientist.objects.select_related("user")
            .filter(organization=organization)
            .exclude(handle=FALLBACK_BERINGER_HANDLE)
            .order_by("last_name", "first_name")
        )

    def perform_create(self, serializer):
        """A quick-added No-Account Beringer is org-owned, so it attaches to the
        requester's active Organisation (ADR 0001, ADR 0005). Without one there is
        no tenant to own it, so creation is refused (mirrors the capture
        endpoint)."""
        serializer.save(organization=_require_active_organization(self.request.user))


class OrganizationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = OrganizationSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "handle"]

    def get_queryset(self):
        """Scope Organisations to the ones the requester is a Mitglied of (the
        tenant boundary — ADR 0005, issue #74): you see only your own
        Organisation(s), so a cross-tenant detail fetch is a 404. This filters by
        *membership* rather than the single active Organisation so a multi-org
        account (modelled, UI deferred) still sees each of its Organisations."""
        return (
            Organization.objects.filter(mitgliedschaften__user=self.request.user)
            .distinct()
            .order_by("name")
        )


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["title"]

    def get_queryset(self):
        scientist = getattr(self.request.user, "scientist", None)
        if scientist is None:
            return Project.objects.none()
        return (
            Project.objects.filter(scientists=scientist)
            .select_related("organization", "default_station__organization")
            .prefetch_related("scientists__user")
            .order_by("-updated")
        )

    def perform_create(self, serializer):
        """Attach the new Projekt to the requester's active Organisation (the
        tenant boundary — ADR 0005, issue #74). The Organisation is
        server-authoritative: a client-supplied ``organization_id`` cannot plant a
        Projekt in another tenant. Without an active Organisation there is no
        tenant to own it, so creation is refused (mirrors the capture endpoint)."""
        serializer.save(organization=_require_active_organization(self.request.user))

    @action(detail=True, methods=["get"], url_path="export-iwm")
    def export_iwm(self, request, pk=None):
        project = self.get_object()
        entries = (
            DataEntry.objects.filter(project=project)
            .select_related("species", "ring", "staff", "ringing_station")
            .order_by("date_time")
        )
        content = build_iwm_workbook(entries)
        filename = f"IWM_{project.title}_{datetime.date.today():%Y-%m-%d}.xlsx"
        response = HttpResponse(
            content,
            content_type=("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
