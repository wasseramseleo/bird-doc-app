from datetime import UTC, datetime

import pytest

from birds.handle_regeneration import regenerate_handles
from birds.models import DataEntry, Scientist


@pytest.mark.django_db
def test_regenerates_non_standard_handle_to_austrian_standard():
    beringer = Scientist.objects.create(
        first_name="Filip", last_name="Reiter", handle="XYZ"
    )

    regenerate_handles(Scientist)

    beringer.refresh_from_db()
    assert beringer.handle == "FRE"


@pytest.mark.django_db
def test_leaves_colliding_handles_untouched_and_reports_them():
    filip = Scientist.objects.create(first_name="Filip", last_name="Reiter", handle="OLD1")
    franz = Scientist.objects.create(first_name="Franz", last_name="Reiter", handle="OLD2")

    collisions = regenerate_handles(Scientist)

    filip.refresh_from_db()
    franz.refresh_from_db()
    assert filip.handle == "OLD1"
    assert franz.handle == "OLD2"

    assert len(collisions) == 1
    assert collisions[0].handle == "FRE"
    assert {b.handle for b in collisions[0].beringer} == {"OLD1", "OLD2"}


@pytest.mark.django_db
def test_leaves_handle_untouched_when_it_would_collide_with_a_kept_handle():
    # A nameless legacy Beringer already holds "FRE" and cannot be regenerated.
    legacy = Scientist.objects.create(first_name="", last_name="", handle="FRE")
    # A named Beringer derives "FRE" but must not steal the held handle.
    filip = Scientist.objects.create(first_name="Filip", last_name="Reiter", handle="OLD")

    collisions = regenerate_handles(Scientist)

    legacy.refresh_from_db()
    filip.refresh_from_db()
    assert legacy.handle == "FRE"
    assert filip.handle == "OLD"

    assert len(collisions) == 1
    assert collisions[0].handle == "FRE"
    assert {b.handle for b in collisions[0].beringer} == {"OLD"}


@pytest.mark.django_db
def test_leaves_beringer_without_a_derivable_name_untouched():
    nameless = Scientist.objects.create(first_name="", last_name="", handle="LEGACY")

    collisions = regenerate_handles(Scientist)

    nameless.refresh_from_db()
    assert nameless.handle == "LEGACY"
    assert collisions == []


@pytest.mark.django_db
def test_existing_captures_still_resolve_to_the_beringer_after_regeneration(
    species, ring, ringing_station
):
    beringer = Scientist.objects.create(first_name="Filip", last_name="Reiter", handle="XYZ")
    capture = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=beringer,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )

    regenerate_handles(Scientist)

    capture.refresh_from_db()
    assert capture.staff_id == beringer.pk
    assert capture.staff.handle == "FRE"
