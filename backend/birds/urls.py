from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

# Create a router and register our viewsets with it.
# The DefaultRouter automatically generates the URL patterns for us.
router = DefaultRouter()
router.register(r'data-entries', views.DataEntryViewSet, basename='dataentry')
router.register(r'species', views.SpeciesViewSet, basename='species')
router.register(r'rings', views.RingViewSet, basename='ring')
router.register(r'ringing-stations', views.RingingStationViewSet, basename='ringingstation')
router.register(r'scientists', views.ScientistViewSet, basename='scientist')
router.register(r'species-lists', views.SpeciesListViewSet, basename='specieslist')

# The API URLs are now determined automatically by the router.
# We just need to include the router.urls in our urlpatterns.
urlpatterns = [
    path('', include(router.urls)),
]

