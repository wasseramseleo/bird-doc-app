from django.db.models.functions import Cast
from django.db.models import IntegerField
from rest_framework import viewsets, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import DataEntry, Species, Ring, RingingStation, Scientist, SpeciesList
from .serializers import DataEntrySerializer, SpeciesSerializer, RingSerializer, RingingStationSerializer, \
    ScientistSerializer, SpeciesListSerializer


class DataEntryViewSet(viewsets.ModelViewSet):
    queryset = DataEntry.objects.select_related('species', 'ring', 'staff', 'ringing_station').all().order_by('-date_time')
    serializer_class = DataEntrySerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        """
        Optionally filters the queryset by ring_size and ring_number
        if they are provided as query parameters.
        """
        queryset = super().get_queryset()
        ring_size = self.request.query_params.get('ring_size')
        ring_number = self.request.query_params.get('ring_number')

        if ring_size and ring_number:
            queryset = queryset.filter(ring__size=ring_size, ring__number=ring_number)

        return queryset


class SpeciesViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SpeciesSerializer
    permission_classes = [permissions.AllowAny]
    filter_backends = [filters.SearchFilter]
    search_fields = ['^common_name_de', 'scientific_name']

    def get_queryset(self):
        """
        If the user is authenticated and has an active species list,
        return species from that list. Otherwise, return all species.
        """
        user = self.request.user
        if user.is_authenticated:
            # Try to find an active list for the current user
            active_list = SpeciesList.objects.filter(user=user, is_active=True).first()
            if active_list:
                # Return species from the active list, ordered by name
                return active_list.species.all().order_by('common_name_de')

        # Fallback for anonymous users or users without an active list
        return Species.objects.all().order_by('common_name_de')


class SpeciesListViewSet(viewsets.ModelViewSet):
    """
    API endpoint for creating and managing user-specific species lists.
    """
    serializer_class = SpeciesListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """
        This view should only return the lists for the currently authenticated user.
        """
        return SpeciesList.objects.filter(user=self.request.user).prefetch_related('species')

    def perform_create(self, serializer):
        """
        Automatically associate the new species list with the logged-in user.
        """
        serializer.save(user=self.request.user)


class RingViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Ring.objects.all()
    serializer_class = RingSerializer
    permission_classes = [permissions.AllowAny]

    @action(detail=False, methods=['get'], url_path='next-number')
    def next_number(self, request):
        """
        Calculates the next available ring number for a given ring size.
        """
        ring_size = request.query_params.get('size')
        if not ring_size:
            return Response({'error': 'Ring size parameter is required.'}, status=400)

        # Find the highest existing numeric ring number for the given size
        latest_ring = Ring.objects.annotate(
            number_int=Cast('number', IntegerField())
        ).filter(
            size=ring_size
        ).order_by('-number_int').first()

        if latest_ring and latest_ring.number.isdigit():
            next_number = int(latest_ring.number) + 1
        else:
            next_number = 1

        return Response({'next_number': next_number})


class RingingStationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = RingingStation.objects.all().order_by('name')
    serializer_class = RingingStationSerializer
    permission_classes = [permissions.AllowAny]
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'handle']


class ScientistViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Scientist.objects.select_related('user').all().order_by('user__last_name')
    serializer_class = ScientistSerializer
    permission_classes = [permissions.AllowAny]
    filter_backends = [filters.SearchFilter]
    search_fields = ['handle', 'user__first_name', 'user__last_name']