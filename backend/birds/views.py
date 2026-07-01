import datetime

from django.conf import settings
from django.core.mail import EmailMessage
from django.db.models import Count, Q
from django.db.models.deletion import ProtectedError
from django.http import HttpResponse
from django.urls import reverse
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .accounts import normalize_email
from .invitations import account_for_email, seats_available
from .iwm_export import build_iwm_workbook
from .iwm_import import IwmStructureError, build_import_preview, commit_import
from .models import (
    FALLBACK_BERINGER_HANDLE,
    DataEntry,
    Mitgliedschaft,
    Organization,
    OrgEinladung,
    Project,
    Ring,
    RingingStation,
    Scientist,
    Species,
    SpeciesList,
)
from .permissions import (
    OTHER_ORG_MESSAGE,
    IsOrgAdmin,
    IsOrgAdminOrReadOnly,
)
from .serializers import (
    DataEntrySerializer,
    MitgliedschaftSerializer,
    OrganizationSerializer,
    OrgEinladungSerializer,
    ProjectSerializer,
    RingingStationSerializer,
    RingSerializer,
    ScientistSerializer,
    SpeciesListSerializer,
    SpeciesSerializer,
)
from .tenancy import active_organization

# Shown when an invite would push the Organisation past its Seat-Limit. The
# Org-Einladung is ungated by the operator but capped by the Seat-Limit (ADR
# 0005); each Mitgliedschaft and each pending Einladung consumes one seat.
SEAT_LIMIT_MESSAGE = (
    "Das Seat-Limit deiner Organisation ist erreicht. Entferne ein Mitglied oder "
    "eine offene Einladung, um eine Person einzuladen."
)

# Shown when removing or demoting a Mitgliedschaft would leave the Organisation
# with no Admin at all — every Organisation must keep at least one.
LAST_ADMIN_MESSAGE = (
    "Die Organisation braucht mindestens eine:n Administrator:in. "
    "Ernenne zuerst eine andere Person zur Administratorin oder zum Administrator."
)


# Shown when a hard-delete is refused because captures reference the Station. The
# FK is PROTECT (captures are never orphaned), so the fix is to archive instead.
STATION_HAS_CAPTURES_MESSAGE = (
    "Diese Station kann nicht gelöscht werden, weil ihr Fänge zugeordnet sind. "
    "Archiviere die Station stattdessen."
)


class SeatLimitReached(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = SEAT_LIMIT_MESSAGE
    default_code = "seat_limit_reached"


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

    def get_queryset(self):
        """Scope the ring list to the requester's active Organisation (the tenant
        boundary — ADR 0006): a Mitglied sees only its own Organisation's rings,
        and an account with no resolvable active Organisation sees an empty list
        (empty, not a 403 — mirrors the capture and project endpoints).
        """
        organization = active_organization(self.request.user)
        if organization is None:
            return Ring.objects.none()
        return super().get_queryset().filter(organization=organization).order_by("size", "number")

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

        The suggestion is scoped to the requester's active Organisation (the
        tenant boundary — ADR 0006): another Organisation's consumption of the
        same size never drives it, and an account with no active Organisation
        gets ``null``.
        """
        ring_size = request.query_params.get("size")
        if not ring_size:
            return Response({"error": "Ring size parameter is required."}, status=400)

        organization = active_organization(request.user)
        if organization is None:
            return Response({"next_number": None})

        project = request.query_params.get("project")

        consumptions = DataEntry.objects.filter(
            organization=organization, ring__size=ring_size
        ).filter(
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


class RingingStationViewSet(viewsets.ModelViewSet):
    """Read for any Mitglied; create/edit/delete for the Organisation's Admin.

    Managing Stationen is an Admin power (ADR 0005). Reads stay global (the list
    is filterable by ``?organization``); writes are admin-only and confined to
    the Admin's own Organisation, so a Station is never created in or moved to
    another tenant.
    """

    serializer_class = RingingStationSerializer
    permission_classes = [IsAuthenticated, IsOrgAdminOrReadOnly]
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "handle"]

    def get_queryset(self):
        """Scope Stationen to the requester's active Organisation (the tenant
        boundary — ADR 0005, issue #74): a Mitglied sees only its Organisation's
        Stationen, so a cross-tenant detail fetch is a 404 (the row is absent),
        not a 403. No active Organisation ⇒ empty list (mirrors the capture
        endpoint). The optional ``?organization=<handle>`` filter is preserved but
        can only narrow within the already-scoped set.

        The default **list** returns only active Stationen (the picker; issue
        #117); ``?include_archived=true`` widens it to active + archived for the
        management list. Detail routes (retrieve/update/destroy) are never
        is_active-filtered so an archived Station stays reachable by handle for
        un-archiving and deletion."""
        organization = active_organization(self.request.user)
        if organization is None:
            return RingingStation.objects.none()
        queryset = (
            RingingStation.objects.select_related("organization")
            .filter(organization=organization)
            .order_by("name")
        )
        if self.action == "list" and self.request.query_params.get("include_archived") != "true":
            queryset = queryset.filter(is_active=True)
        handle = self.request.query_params.get("organization")
        if handle:
            queryset = queryset.filter(organization__handle=handle)
        return queryset

    def perform_create(self, serializer):
        # The Station lands in the actor's active Organisation, server-authoritative
        # (issue #117, mirrors ProjectViewSet): a client-supplied ``organization_id``
        # can never plant it in another tenant.
        serializer.save(organization=_require_active_organization(self.request.user))

    def perform_update(self, serializer):
        target = serializer.validated_data.get("organization", serializer.instance.organization)
        self._reject_foreign_organization(target)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        """Hard-delete only when no capture references the Station.

        The ``DataEntry.ringing_station`` FK is PROTECT (captures are never
        orphaned), so a Station with Fänge cannot be deleted — the delete is
        refused with 409 and a hint to archive instead (issue #117). A Station
        with no captures deletes normally (204)."""
        instance = self.get_object()
        try:
            instance.delete()
        except ProtectedError:
            return Response(
                {"detail": STATION_HAS_CAPTURES_MESSAGE},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _reject_foreign_organization(self, organization):
        # A Station write must stay inside the Admin's own Organisation. (The
        # IsOrgAdminOrReadOnly object check already blocks editing a *foreign*
        # Station; this also blocks moving one to another tenant on update.)
        if organization != active_organization(self.request.user):
            raise PermissionDenied(OTHER_ORG_MESSAGE)


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


class OrganizationViewSet(mixins.UpdateModelMixin, viewsets.ReadOnlyModelViewSet):
    """Read for any Mitglied; edit for the Organisation's Admin.

    Editing the Organisation is an Admin power (ADR 0005). Only edit is exposed —
    org *creation* is gated by a Zugangscode (a separate slice) and there is no
    delete — so an Admin can only ever edit their own Organisation
    (``IsOrgAdminOrReadOnly`` confines the object to the active tenant).
    """

    serializer_class = OrganizationSerializer
    permission_classes = [IsAuthenticated, IsOrgAdminOrReadOnly]
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
    permission_classes = [IsAuthenticated, IsOrgAdminOrReadOnly]
    filter_backends = [filters.SearchFilter]
    search_fields = ["title"]

    def get_permissions(self):
        # The IWM export/import are privileged Admin-only operations: the export
        # despite being a GET, the import as a bulk write (ADR 0013). Neither may
        # ride the read exemption of ``IsOrgAdminOrReadOnly``.
        if self.action in ("export_iwm", "import_iwm"):
            return [IsAuthenticated(), IsOrgAdmin()]
        return super().get_permissions()

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

    @action(detail=True, methods=["post"], url_path="import-iwm")
    def import_iwm(self, request, pk=None):
        """Admin-only IWM import into this Projekt (ADR 0013, mirrors export-iwm).

        One multipart upload, two phases on the same file: without ``commit`` a
        dry-run returns an ``ImportPreview`` and writes nothing; with
        ``commit=true`` it atomically creates the importable captures and returns
        an ``ImportResult``. A structurally-wrong file fast-fails with a clear
        message (400). Captures land in this Projekt's Organisation
        server-authoritatively — a client cannot plant them in another tenant."""
        project = self.get_object()
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Es wurde keine Datei hochgeladen."})
        content = upload.read()
        commit = str(request.data.get("commit", "")).strip().lower() in ("true", "1", "yes", "on")
        try:
            if commit:
                return Response(commit_import(content, project))
            return Response(build_import_preview(content, project))
        except IwmStructureError as exc:
            raise ValidationError({"file": str(exc)}) from exc


class OrgEinladungViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Admin-only Org-Einladungen for the active Organisation (issue #83).

    An Admin invites a colleague by email (ungated by the operator, capped by the
    Seat-Limit — ADR 0005); the invitee gets a mail with a public accept link.
    List shows the Organisation's invitations; destroy revokes a pending one,
    freeing the Mitgliedsplatz it reserved. Member management is Admin-only
    (issue #76), so ``IsOrgAdmin`` gates every method.
    """

    serializer_class = OrgEinladungSerializer
    permission_classes = [IsAuthenticated, IsOrgAdmin]

    def get_queryset(self):
        organization = active_organization(self.request.user)
        if organization is None:
            return OrgEinladung.objects.none()
        return OrgEinladung.objects.filter(organization=organization)

    def perform_create(self, serializer):
        organization = _require_active_organization(self.request.user)
        email = normalize_email(serializer.validated_data["email"])

        if Mitgliedschaft.objects.filter(
            organization=organization, user=account_for_email(email)
        ).exists():
            raise ValidationError(
                {"email": "Diese Person ist bereits Mitglied dieser Organisation."}
            )
        if OrgEinladung.objects.filter(
            organization=organization, email=email, accepted_at__isnull=True
        ).exists():
            raise ValidationError(
                {"email": "Für diese E-Mail gibt es bereits eine offene Einladung."}
            )
        if seats_available(organization) <= 0:
            raise SeatLimitReached()

        invitation = serializer.save(
            organization=organization, email=email, invited_by=self.request.user
        )
        self._send_invitation_mail(invitation)

    def _send_invitation_mail(self, invitation):
        """Mail the invitee the public accept link.

        Sent over the same transactional channel as the rest of the app (issue
        #77): from the no-reply sender, with a reply-to of the inviting Admin so
        the invitee can ask them directly. The accept link is built against the
        requesting host, so it resolves on whichever domain served the API."""
        accept_url = self.request.build_absolute_uri(
            reverse("landing:invitation_accept", args=[invitation.token])
        )
        organization = invitation.organization
        reply_to = [self.request.user.email] if self.request.user.email else None
        body = (
            "Hallo,\n\n"
            f"du wurdest eingeladen, der Organisation {organization.name} "
            "bei BirdDoc beizutreten.\n\n"
            f"Tritt bei, indem du diesen Link öffnest:\n{accept_url}\n\n"
            "Wenn du diese Einladung nicht erwartet hast, kannst du diese "
            "E-Mail ignorieren.\n"
        )
        EmailMessage(
            subject=f"Einladung zu BirdDoc – {organization.name}",
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[invitation.email],
            reply_to=reply_to,
        ).send()


class MitgliedschaftViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Admin-only member management for the active Organisation (issue #83).

    The Admin lists the Organisation's Mitglieder, changes a Mitgliedschaft's
    Rolle (Admin ↔ Mitglied) and removes a Mitglied. Removing a Mitgliedschaft
    frees its Mitgliedsplatz. Management is Admin-only (issue #76) and scoped to
    the active Organisation, so a cross-tenant membership is simply absent from
    the queryset (a 404, not a 403). The Organisation can never be left without an
    Admin — the last Admin cannot be removed or demoted.
    """

    serializer_class = MitgliedschaftSerializer
    permission_classes = [IsAuthenticated, IsOrgAdmin]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        organization = active_organization(self.request.user)
        if organization is None:
            return Mitgliedschaft.objects.none()
        return (
            Mitgliedschaft.objects.filter(organization=organization)
            .select_related("user")
            .order_by("user__username")
        )

    def perform_update(self, serializer):
        membership = serializer.instance
        new_rolle = serializer.validated_data.get("rolle", membership.rolle)
        if (
            membership.rolle == Mitgliedschaft.Rolle.ADMIN
            and new_rolle != Mitgliedschaft.Rolle.ADMIN
            and self._is_last_admin(membership)
        ):
            raise ValidationError({"rolle": LAST_ADMIN_MESSAGE})
        serializer.save()

    def perform_destroy(self, instance):
        if instance.rolle == Mitgliedschaft.Rolle.ADMIN and self._is_last_admin(instance):
            raise ValidationError(LAST_ADMIN_MESSAGE)
        instance.delete()

    @staticmethod
    def _is_last_admin(membership):
        return (
            not Mitgliedschaft.objects.filter(
                organization=membership.organization, rolle=Mitgliedschaft.Rolle.ADMIN
            )
            .exclude(pk=membership.pk)
            .exists()
        )
