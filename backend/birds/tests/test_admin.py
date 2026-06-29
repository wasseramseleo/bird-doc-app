import csv
from datetime import UTC, datetime
from io import StringIO

import pytest
from django.contrib.admin.sites import AdminSite

from birds.admin import (
    MitgliedschaftAdmin,
    OrganizationAdmin,
    ProjectAdmin,
    RingingStationAdmin,
    export_as_csv,
)
from birds.models import DataEntry, Mitgliedschaft, Organization, Project, Ring, RingingStation


@pytest.mark.django_db
def test_ringing_station_geography_fields_editable_in_admin():
    admin = RingingStationAdmin(RingingStation, AdminSite())
    form_fields = admin.get_form(request=None).base_fields

    for field in ("country", "region", "place_code", "latitude", "longitude"):
        assert field in form_fields


@pytest.mark.django_db
def test_csv_export_emits_vienna_localtime(species, scientist, ringing_station):
    # 23:00 UTC is 01:00 the next day in Vienna (CEST, UTC+2); the CSV must
    # report the Vienna wall clock, not the stored UTC instant.
    DataEntry.objects.create(
        species=species,
        ring=Ring.objects.create(number="604", size=Ring.RingSizes.V),
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 6, 30, 23, 0, tzinfo=UTC),
    )

    response = export_as_csv(None, None, DataEntry.objects.all())
    rows = list(csv.DictReader(StringIO(response.content.decode("utf-8"))))

    assert rows[0]["Zeitpunkt"] == "2026-07-01 01:00:00"


@pytest.mark.django_db
def test_project_capture_context_fields_editable_in_admin():
    admin = ProjectAdmin(Project, AdminSite())
    form_fields = admin.get_form(request=None).base_fields

    for field in ("circumstance", "capture_method", "lure"):
        assert field in form_fields


@pytest.mark.django_db
def test_organization_tenancy_fields_editable_in_admin():
    # The operator manages the per-Organisation tenant/monetisation fields from
    # the Django admin (issue #69, ADR 0005).
    admin = OrganizationAdmin(Organization, AdminSite())
    form_fields = admin.get_form(request=None).base_fields

    for field in ("plan", "seat_limit", "beta_cohort"):
        assert field in form_fields


@pytest.mark.django_db
def test_mitgliedschaft_fields_editable_in_admin():
    # The operator manages who belongs to which Organisation, and their Rolle.
    admin = MitgliedschaftAdmin(Mitgliedschaft, AdminSite())
    form_fields = admin.get_form(request=None).base_fields

    for field in ("user", "organization", "rolle"):
        assert field in form_fields
