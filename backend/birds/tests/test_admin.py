import pytest
from django.contrib.admin.sites import AdminSite

from birds.admin import ProjectAdmin, RingingStationAdmin
from birds.models import Project, RingingStation


@pytest.mark.django_db
def test_ringing_station_geography_fields_editable_in_admin():
    admin = RingingStationAdmin(RingingStation, AdminSite())
    form_fields = admin.get_form(request=None).base_fields

    for field in ("country", "region", "place_code", "latitude", "longitude"):
        assert field in form_fields


@pytest.mark.django_db
def test_project_capture_context_fields_editable_in_admin():
    admin = ProjectAdmin(Project, AdminSite())
    form_fields = admin.get_form(request=None).base_fields

    for field in ("circumstance", "capture_method", "lure"):
        assert field in form_fields
