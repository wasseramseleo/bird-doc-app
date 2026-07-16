from datetime import UTC, datetime

import pytest

from birds.models import DataEntry, Ring

NEXT_NUMBER_URL = "/api/birds/rings/next-number/"
LIST_URL = "/api/birds/rings/"


def _catch(
    *,
    number,
    species,
    scientist,
    ringing_station,
    size=Ring.RingSizes.V,
    status=DataEntry.BirdStatus.FIRST_CATCH,
    project=None,
    created=None,
):
    """Seed a Ring of the given size and a DataEntry capturing it with `status`.

    `created` overrides the record's creation timestamp (which is otherwise
    `auto_now_add`), letting a test pin down which entry is the *most recent*
    consumption of the rope independently of the order rows are inserted.
    """
    ring = Ring.objects.create(number=number, size=size)
    entry = DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        project=project,
        bird_status=status,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    if created is not None:
        DataEntry.objects.filter(pk=entry.pk).update(created=created)
    return ring


def _at(day):
    return datetime(2026, 1, day, 12, 0, tzinfo=UTC)


@pytest.mark.django_db
def test_next_number_requires_size_param(auth_client):
    response = auth_client.get(NEXT_NUMBER_URL)
    assert response.status_code == 400
    assert "error" in response.json()


@pytest.mark.django_db
def test_next_number_with_no_rings_returns_null(auth_client, project):
    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": None}


@pytest.mark.django_db
def test_next_number_follows_last_consumed_not_max(
    auth_client, species, scientist, ringing_station, project
):
    # A higher number was consumed earlier; a lower number is the most recent
    # draw from the rope. The suggestion follows the latter (+1), not the max.
    _catch(
        number="0050",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(1),
    )
    _catch(
        number="0042",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(2),
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_next_number_offers_a_deleted_erstfangs_number_again(
    auth_client, species, scientist, ringing_station, project
):
    """The number returns to the rope (ADR 0030): once the Erstfang that consumed
    0043 is deleted, the rope's last consumption is 0042 again — so 0043 is
    suggested a second time, ready to be re-issued on the physical ring."""
    _catch(
        number="0042",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(1),
    )
    mis_entry = _catch(
        number="0043",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(2),
    )
    assert auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)}).json() == {
        "next_number": "0044"
    }

    entry = DataEntry.objects.get(ring=mis_entry)
    auth_client.delete(f"/api/birds/data-entries/{entry.id}/")

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_next_number_preserves_leading_zero_width(
    auth_client, species, scientist, ringing_station, project
):
    _catch(
        number="0042",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_sentinel_entry_advances_the_number(
    auth_client, sentinel_species, scientist, ringing_station, project
):
    # A destroyed ring is recorded against the sentinel species; its number was
    # drawn from the rope, so the next suggestion follows it.
    _catch(
        number="0007",
        species=sentinel_species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.json() == {"next_number": "0008"}


@pytest.mark.django_db
def test_recapture_does_not_advance_the_number(
    auth_client, species, scientist, ringing_station, project
):
    # A genuine first catch consumes a number...
    _catch(
        number="0042",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(1),
    )
    # ...and a later recapture of a high foreign mark consumes nothing.
    _catch(
        number="900000",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        status=DataEntry.BirdStatus.RE_CATCH,
        project=project,
        created=_at(2),
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_recording_beringer_is_irrelevant(
    auth_client, species, scientist, other_scientist, ringing_station, project
):
    # The most recent consumption was recorded by a different Beringer; it still
    # drives the suggestion.
    _catch(
        number="0042",
        species=species,
        scientist=other_scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_next_number_isolated_per_size(auth_client, species, scientist, ringing_station, project):
    _catch(
        number="0050",
        size=Ring.RingSizes.V,
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )
    _catch(
        number="0005",
        size=Ring.RingSizes.T,
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "T", "project": str(project.id)})
    assert response.json() == {"next_number": "0006"}


@pytest.mark.django_db
def test_first_entry_of_a_size_returns_null(
    auth_client, species, scientist, ringing_station, project
):
    # Only a recapture exists — no number has been drawn from the rope yet.
    _catch(
        number="0500",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        status=DataEntry.BirdStatus.RE_CATCH,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": None}


@pytest.mark.django_db
def test_non_numeric_previous_number_returns_null(
    auth_client, species, scientist, ringing_station, project
):
    _catch(
        number="ABC",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": None}


@pytest.mark.django_db
def test_other_project_consumption_is_ignored(
    auth_client, species, scientist, ringing_station, project, organization
):
    from birds.models import Project

    other_project = Project.objects.create(title="Other", organization=organization)
    # A consumption in a different project must not bleed into this one.
    _catch(
        number="0099",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=other_project,
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": None}


@pytest.mark.django_db
def test_foreign_wiederfang_does_not_derail_next_number(
    auth_client, species, scientist, ringing_station, project
):
    """Regression (US 14): a foreign Wiederfang is a recapture, so it consumes no
    rope number and never derails the next-number suggestion — it still follows
    the last genuine Austrian consumption (+1). The next-number rule is unchanged
    by the Zentrale write path (ADR 0019)."""
    # A genuine Austrian first catch consumes 0042.
    _catch(
        number="0042",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(1),
    )
    # A later foreign Wiederfang of a high Slovak number in the same project+size.
    foreign = auth_client.post(
        "/api/birds/data-entries/",
        {
            "species_id": str(species.id),
            "staff_id": scientist.id,
            "ringing_station_id": ringing_station.handle,
            "ring_number": "SK900000",
            "ring_size": "V",
            "central": "SKB",
            "project_id": str(project.id),
            "bird_status": DataEntry.BirdStatus.RE_CATCH,
            "date_time": "2026-03-02T12:00:00Z",
        },
        format="json",
    )
    assert foreign.status_code == 201, foreign.json()

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V", "project": str(project.id)})
    assert response.status_code == 200
    assert response.json() == {"next_number": "0043"}


@pytest.mark.django_db
def test_rings_endpoint_is_read_only(auth_client):
    response = auth_client.post(LIST_URL, {"number": "1", "size": "V"}, format="json")
    assert response.status_code == 405


# --- Ring scoped to Organisation (ADR 0006, issue #75) ----------------------


@pytest.mark.django_db
def test_two_orgs_hold_same_size_number_independently(organization, organization_b):
    """Ring uniqueness is scoped to the Organisation (ADR 0006): an Austrian
    V 0042 and a foreign V 0042 are different physical rings, so two
    Organisations may each own a Ring with the same (size, number) without
    collision."""
    ring_a = Ring.objects.create(number="0042", size=Ring.RingSizes.V, organization=organization)
    ring_b = Ring.objects.create(number="0042", size=Ring.RingSizes.V, organization=organization_b)

    assert ring_a.organization == organization
    assert ring_b.organization == organization_b
    assert Ring.objects.filter(size=Ring.RingSizes.V, number="0042").count() == 2


@pytest.mark.django_db
def test_capture_on_foreign_number_creates_ring_in_recording_org(
    auth_client_b, species, scientist_b, ringing_station_b, organization, organization_b
):
    """Recording a capture on a number another Organisation already owns creates
    a new Ring row in the recording Organisation rather than reusing the other's
    — BirdDoc records the number read, it does not resolve ring identity across
    Organisations (ADR 0006)."""
    Ring.objects.create(number="0042", size=Ring.RingSizes.V, organization=organization)

    response = auth_client_b.post(
        "/api/birds/data-entries/",
        {
            "species_id": str(species.id),
            "staff_id": scientist_b.id,
            "ringing_station_id": ringing_station_b.handle,
            "ring_number": "0042",
            "ring_size": "V",
            "date_time": "2026-03-01T12:00:00Z",
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    rings = Ring.objects.filter(size=Ring.RingSizes.V, number="0042")
    assert rings.count() == 2
    assert set(rings.values_list("organization", flat=True)) == {
        organization.pk,
        organization_b.pk,
    }
    entry = DataEntry.objects.get(id=response.json()["id"])
    assert entry.ring.organization == organization_b


@pytest.mark.django_db
def test_next_number_is_scoped_to_requester_org(
    auth_client,
    species,
    scientist,
    ringing_station,
    project,
    scientist_b,
    ringing_station_b,
    project_b,
):
    """`next-number` is computed within the requester's Organisation (ADR 0006):
    another Organisation's higher, later consumption of the same size must not
    drive the suggestion. The requester (Alice, tenant A) consumed V 0050; tenant
    B consumed V 0099 afterwards, so a global view would suggest 0100 — but the
    org-scoped suggestion follows tenant A's 0050."""
    _catch(
        number="0050",
        species=species,
        scientist=scientist,
        ringing_station=ringing_station,
        project=project,
        created=_at(1),
    )
    _catch(
        number="0099",
        species=species,
        scientist=scientist_b,
        ringing_station=ringing_station_b,
        project=project_b,
        created=_at(2),
    )

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V"})
    assert response.status_code == 200
    assert response.json() == {"next_number": "0051"}


@pytest.mark.django_db
def test_rings_list_is_scoped_to_requester_org(
    auth_client, scientist, organization, organization_b
):
    """The /rings/ list is scoped to the requester's Organisation (ADR 0006): a
    Mitglied sees only its own Organisation's rings, never another tenant's."""
    mine = Ring.objects.create(number="0042", size=Ring.RingSizes.V, organization=organization)
    Ring.objects.create(number="0099", size=Ring.RingSizes.V, organization=organization_b)

    response = auth_client.get(LIST_URL)
    assert response.status_code == 200
    ids = [row["id"] for row in response.json()["results"]]
    assert ids == [str(mine.id)]


@pytest.mark.django_db
def test_rings_list_is_empty_without_active_org(auth_client, organization):
    """An account with no resolvable active Organisation sees no rings (empty,
    not a 403 — mirrors the capture and project endpoints)."""
    Ring.objects.create(number="0042", size=Ring.RingSizes.V, organization=organization)

    response = auth_client.get(LIST_URL)
    assert response.status_code == 200
    assert response.json()["results"] == []


# --- Ring uniqueness widened by the Zentrale (ADR 0019, issue #228) ----------


@pytest.mark.django_db
def test_same_size_number_coexists_under_two_zentralen(organization):
    """Ring uniqueness widens to (organization, central, size, number) — ADR
    0019: the same Größe+Nummer under two different Zentralen (an Austrian
    V 0042 and a Slovak V 0042) are distinct physical rings that coexist within
    one Organisation (US 18, model level)."""
    from birds.models import Central

    auw = Central.objects.get(scheme_code="AUW")
    skb = Central.objects.get(scheme_code="SKB")

    ring_auw = Ring.objects.create(
        number="0042", size=Ring.RingSizes.V, organization=organization, central=auw
    )
    ring_skb = Ring.objects.create(
        number="0042", size=Ring.RingSizes.V, organization=organization, central=skb
    )

    assert ring_auw.central == auw
    assert ring_skb.central == skb
    assert (
        Ring.objects.filter(organization=organization, size=Ring.RingSizes.V, number="0042").count()
        == 2
    )


@pytest.mark.django_db
def test_backfill_assigns_existing_ring_its_org_from_captures(
    species, scientist, ringing_station, organization
):
    """The data migration attributes a legacy (org-less) Ring to an Organisation
    without data loss (ADR 0006): it inherits the Organisation of a capture that
    references it. The Station is org-owned, so the capture carries the org."""
    import importlib

    from django.apps import apps as global_apps

    ring_migration = importlib.import_module("birds.migrations.0047_backfill_ring_organization")

    ring = Ring.objects.create(number="0042", size=Ring.RingSizes.V)
    assert ring.organization is None
    DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )

    ring_migration.backfill_ring_organization(global_apps, None)

    ring.refresh_from_db()
    assert ring.organization == organization
