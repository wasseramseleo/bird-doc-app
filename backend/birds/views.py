import datetime

from django.db.models import IntegerField
from django.db.models.functions import Cast
from django.http import HttpResponse
from rest_framework import filters, viewsets
from rest_framework.decorators import action
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


class DataEntryViewSet(viewsets.ModelViewSet):
    queryset = (
        DataEntry.objects.select_related(
            "species", "ring", "staff", "ringing_station", "project", "project__organization"
        )
        .all()
        .order_by("-date_time")
    )
    serializer_class = DataEntrySerializer

    def get_queryset(self):
        """
        Optionally filters the queryset by ring_size and ring_number
        if they are provided as query parameters.
        """
        queryset = super().get_queryset()
        ring_size = self.request.query_params.get("ring_size")
        ring_number = self.request.query_params.get("ring_number")

        if ring_size and ring_number:
            queryset = queryset.filter(ring__size=ring_size, ring__number=ring_number)

        return queryset


class SpeciesViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SpeciesSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["^common_name_de", "scientific_name"]

    def get_queryset(self):
        """
        If the user has an active species list, return species from that list.
        Otherwise, return all species.
        """
        user = self.request.user
        active_list = SpeciesList.objects.filter(user=user, is_active=True).first()
        if active_list:
            return active_list.species.all().order_by("common_name_de")

        return Species.objects.all().order_by("common_name_de")


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
        Calculates the next available ring number for a given ring size.
        """
        ring_size = request.query_params.get("size")
        if not ring_size:
            return Response({"error": "Ring size parameter is required."}, status=400)

        latest_ring = (
            Ring.objects.filter(size=ring_size, number__regex=r"^\d+$")
            .annotate(number_int=Cast("number", IntegerField()))
            .order_by("-number_int")
            .first()
        )

        next_number = int(latest_ring.number) + 1 if latest_ring else 1
        return Response({"next_number": next_number})


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


class ScientistViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Scientist.objects.select_related("user").all().order_by("user__last_name")
    serializer_class = ScientistSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["handle", "user__first_name", "user__last_name"]


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
            .select_related("organization")
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
