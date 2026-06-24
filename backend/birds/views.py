import datetime

from django.db.models import Count, IntegerField, Q
from django.db.models.functions import Cast
from django.http import HttpResponse
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .iwm_export import build_iwm_workbook
from .models import (
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
        Optionally filters the queryset by ring_size and ring_number
        if they are provided as query parameters.
        """
        queryset = super().get_queryset()
        ring_size = self.request.query_params.get("ring_size")
        ring_number = self.request.query_params.get("ring_number")
        project = self.request.query_params.get("project")

        if ring_size and ring_number:
            queryset = queryset.filter(ring__size=ring_size, ring__number=ring_number)

        if project:
            queryset = queryset.filter(project=project).order_by("-created")

        return queryset


class SpeciesViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SpeciesSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["^common_name_de", "scientific_name"]

    def get_queryset(self):
        """
        Candidate species are filtered exactly as before: an active species
        list narrows the set to its members plus the always-selectable sentinel
        species; otherwise all species are candidates. Frequency only reorders
        the candidates — see ``_order_by_usage``.
        """
        user = self.request.user
        active_list = SpeciesList.objects.filter(user=user, is_active=True).first()
        if active_list:
            candidate_ids = Species.objects.filter(
                Q(lists=active_list) | Q(is_sentinel=True)
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

        The suggestion is ``max(number) + 1`` over the *first-catch* (Erstfang)
        rings of that size — rings whose number was newly applied to a bird,
        excluding recaptures (Wiederfang) of foreign marks. It is scoped to the
        current project when one is given, falling back to the global first-catch
        maximum when the project has no such ring, and to ``1`` when none exists
        anywhere. See issue #22.
        """
        ring_size = request.query_params.get("size")
        if not ring_size:
            return Response({"error": "Ring size parameter is required."}, status=400)

        project = request.query_params.get("project")

        first_catches = Ring.objects.filter(
            size=ring_size,
            number__regex=r"^\d+$",
            dataentry__bird_status=DataEntry.BirdStatus.FIRST_CATCH,
        )

        latest = None
        if project:
            latest = self._max_number(first_catches.filter(dataentry__project=project))
        if latest is None:
            latest = self._max_number(first_catches)

        next_number = latest + 1 if latest is not None else 1
        return Response({"next_number": next_number})

    @staticmethod
    def _max_number(queryset):
        """Largest integer ring number in the queryset, or None if it is empty."""
        latest = (
            queryset.annotate(number_int=Cast("number", IntegerField()))
            .order_by("-number_int")
            .first()
        )
        return latest.number_int if latest else None


class RingingStationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RingingStationSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "handle"]

    def get_queryset(self):
        queryset = RingingStation.objects.select_related("organization").all().order_by("name")
        organization = self.request.query_params.get("organization")
        if organization:
            queryset = queryset.filter(organization__handle=organization)
        return queryset


class ScientistViewSet(mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """List/retrieve plus authenticated create.

    A Beringer can be created mid-session with no linked account (an unknown
    Kürzel prompts a "Neuer Beringer" dialog); editing and deletion stay closed.
    See ADR 0001-account-independent-beringer.
    """

    queryset = Scientist.objects.select_related("user").all().order_by("last_name", "first_name")
    serializer_class = ScientistSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["handle", "first_name", "last_name"]


class OrganizationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Organization.objects.all().order_by("name")
    serializer_class = OrganizationSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "handle"]


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
