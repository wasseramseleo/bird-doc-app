"""Cutover transform: migrate the existing single-tenant data into the tenancy
model (issue #82, ADR 0005/0006).

The transform is a one-shot data migration (``0050``) run during a scheduled
maintenance window. It is exercised here the way the repo tests its other data
migrations (see ``test_models.py``): import the migration module and call its
function with the *real* app registry (``global_apps``) against a representative
pre-cutover fixture, then assert the post-cutover state through the public
models.
"""

import importlib
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from django.apps import apps as global_apps
from django.contrib.auth import authenticate
from django.contrib.auth.models import User

from birds.models import (
    DataEntry,
    Mitgliedschaft,
    Organization,
    Project,
    Ring,
    RingingStation,
    Scientist,
    Species,
)

cutover = importlib.import_module("birds.migrations.0050_cutover_to_iwm_linz")


@pytest.fixture
def pre_cutover_world(db):
    """A representative pre-cutover single-tenant dataset, mirroring production.

    All Organisation-owned rows sit under the ``AUW`` placeholder org seeded by
    migration 0016; Beringer are org-less (0042 added the field without a
    backfill); accounts log in by username with blank emails; and the reserved
    ``GELÖSCHT`` fallback (ADR 0003) and the Sonderart rows (ADR 0004) are
    already present from earlier migrations.
    """
    placeholder = Organization.objects.get(handle="AUW")

    station = RingingStation.objects.create(
        handle="LINZ-BG", name="Linz, Botanischer Garten", organization=placeholder
    )
    project = Project.objects.create(title="Monitoring", organization=placeholder)

    # filip and hans log in by username with blank emails (legacy accounts);
    # anna is a public account that already carries an email.
    filip = User.objects.create_user(username="filip", password="filip-pw-strong")
    filip.email = ""
    filip.save(update_fields=["email"])
    hans = User.objects.create_user(username="hans", password="hans-pw-strong")
    hans.email = ""
    hans.save(update_fields=["email"])
    anna = User.objects.create_user(
        username="anna@example.com", email="anna@example.com", password="anna-pw-strong"
    )

    # Beringer rows are org-less pre-cutover. filip is a Mitglied-to-be; Hilde is
    # a no-account helper (a selectable name, ADR 0001).
    filip_beringer = Scientist.objects.create(user=filip, first_name="Filip", last_name="Reiter")
    helper = Scientist.objects.create(first_name="Hilde", last_name="Helfer")

    species = Species.objects.create(
        common_name_de="Kohlmeise Cutover",
        common_name_en="Great Tit Cutover",
        scientific_name="Parus major cutover",
        family_name="Paridae",
        order_name="Passeriformes",
        ring_size=Ring.RingSizes.V,
    )
    ring = Ring.objects.create(number="0042", size=Ring.RingSizes.V, organization=placeholder)
    capture = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=filip_beringer,
        ringing_station=station,
        organization=placeholder,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    project.scientists.add(filip_beringer)

    return SimpleNamespace(
        placeholder=placeholder,
        station=station,
        project=project,
        filip=filip,
        hans=hans,
        anna=anna,
        filip_beringer=filip_beringer,
        helper=helper,
        species=species,
        ring=ring,
        capture=capture,
    )


@pytest.mark.django_db
def test_cutover_creates_the_iwm_linz_founding_organisation(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    iwm = Organization.objects.get(name="IWM Linz")
    assert iwm.plan == Organization.Plan.BETA
    assert iwm.beta_cohort is True


@pytest.mark.django_db
def test_filip_becomes_admin_of_iwm_linz(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    iwm = Organization.objects.get(name="IWM Linz")
    membership = Mitgliedschaft.objects.get(user=pre_cutover_world.filip, organization=iwm)
    assert membership.rolle == Mitgliedschaft.Rolle.ADMIN


@pytest.mark.django_db
def test_other_accounts_become_plain_mitglied(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    iwm = Organization.objects.get(name="IWM Linz")
    for account in (pre_cutover_world.hans, pre_cutover_world.anna):
        membership = Mitgliedschaft.objects.get(user=account, organization=iwm)
        assert membership.rolle == Mitgliedschaft.Rolle.MITGLIED


@pytest.mark.django_db
def test_seat_limit_is_raised_to_fit_every_membership(pre_cutover_world):
    # More accounts than the default Seat-Limit of 5, so "raised to fit" must
    # actually raise it rather than leave the default.
    for i in range(5):
        User.objects.create_user(username=f"ringer{i}", password="x-very-strong-pw")

    cutover.run_cutover(global_apps, None)

    iwm = Organization.objects.get(name="IWM Linz")
    seats_used = Mitgliedschaft.objects.filter(organization=iwm).count()
    assert seats_used > 5
    assert iwm.seat_limit >= seats_used


@pytest.mark.django_db
def test_existing_stations_projects_beringer_and_captures_move_to_iwm_linz(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    iwm = Organization.objects.get(name="IWM Linz")
    for row in (
        pre_cutover_world.station,
        pre_cutover_world.project,
        pre_cutover_world.filip_beringer,
        pre_cutover_world.helper,
        pre_cutover_world.capture,
    ):
        row.refresh_from_db()
        assert row.organization == iwm


@pytest.mark.django_db
def test_existing_rings_are_partitioned_under_iwm_linz(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    iwm = Organization.objects.get(name="IWM Linz")
    pre_cutover_world.ring.refresh_from_db()
    assert pre_cutover_world.ring.organization == iwm


@pytest.mark.django_db
def test_emails_are_backfilled_for_blank_accounts_and_existing_ones_kept(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    filip = User.objects.get(pk=pre_cutover_world.filip.pk)
    hans = User.objects.get(pk=pre_cutover_world.hans.pk)
    anna = User.objects.get(pk=pre_cutover_world.anna.pk)

    # Blank emails are backfilled with a clearly-placeholder address...
    assert filip.email == "filip@iwm-linz.invalid"
    assert hans.email == "hans@iwm-linz.invalid"
    # ...while an account that already had an email keeps it.
    assert anna.email == "anna@example.com"


@pytest.mark.django_db
def test_username_login_still_works_after_cutover(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    filip = User.objects.get(pk=pre_cutover_world.filip.pk)
    # The username is never rewritten, so the legacy by-username login is intact.
    assert filip.username == "filip"
    assert authenticate(username="filip", password="filip-pw-strong") == filip


@pytest.mark.django_db
def test_geloeschter_nutzer_fallback_is_preserved_org_less(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    # The reserved sink survives (ADR 0003) and is never pulled into a tenant.
    fallback = Scientist.objects.get(handle="GELÖSCHT")
    assert fallback.organization is None


@pytest.mark.django_db
def test_sonderart_rows_are_preserved(pre_cutover_world):
    before = {
        s.pk: s.special_kind
        for s in Species.objects.exclude(special_kind=Species.SpecialKind.NORMAL)
    }
    assert before  # the Sonderart rows exist before the cutover (ADR 0004)

    cutover.run_cutover(global_apps, None)

    after = {
        s.pk: s.special_kind
        for s in Species.objects.exclude(special_kind=Species.SpecialKind.NORMAL)
    }
    assert after == before


@pytest.mark.django_db
def test_auw_placeholder_org_is_dropped_leaving_only_iwm_linz(pre_cutover_world):
    cutover.run_cutover(global_apps, None)

    assert not Organization.objects.filter(handle="AUW").exists()
    assert list(Organization.objects.values_list("name", flat=True)) == ["IWM Linz"]


@pytest.mark.django_db
def test_cutover_is_a_noop_when_there_is_no_single_tenant_data(db):
    # A fresh database (no stations/captures/rings/real Beringer) has nothing to
    # cut over: the transform must leave it untouched rather than mint IWM Linz
    # and drop the AUW seed on every fresh migrate.
    assert not RingingStation.objects.exists()

    cutover.run_cutover(global_apps, None)

    assert not Organization.objects.filter(name="IWM Linz").exists()
    assert Organization.objects.filter(handle="AUW").exists()
