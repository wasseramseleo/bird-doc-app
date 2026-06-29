from datetime import UTC, datetime

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from birds.models import (
    DataEntry,
    Mitgliedschaft,
    Organization,
    Project,
    Ring,
    RingingStation,
    Scientist,
    Species,
    SpeciesList,
)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", password="hunter2-very-strong")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="bob", password="hunter2-very-strong")


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def scientist(user, organization):
    """Alice — the primary Beringer, an Admin Mitglied of tenant A (``organization``).

    Her single Mitgliedschaft makes ``organization`` her implicit active
    Organisation, so the org-scoped capture endpoint resolves to tenant A.
    """
    s = Scientist.objects.create(user=user, handle="ALC", organization=organization)
    Mitgliedschaft.objects.create(
        user=user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )
    return s


@pytest.fixture
def membership(user, organization):
    """Alice's single Mitgliedschaft in tenant A — her implicit active Organisation.

    Use when a test needs Alice to have an active Organisation but **no** Beringer
    row of her own polluting the org-scoped ``/scientists/`` autocomplete. Do not
    combine with ``scientist`` (which adds its own Mitgliedschaft) — two
    memberships make the active Organisation ambiguous and resolve to ``None``.
    """
    return Mitgliedschaft.objects.create(
        user=user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )


@pytest.fixture
def other_scientist(other_user):
    return Scientist.objects.create(user=other_user, handle="BOB")


@pytest.fixture
def organization(db):
    return Organization.objects.create(handle="ORG1", name="Test Org", country="DE")


@pytest.fixture
def ringing_station(organization):
    return RingingStation.objects.create(
        handle="STN1", name="Test Station", organization=organization
    )


@pytest.fixture
def species(db):
    return Species.objects.create(
        common_name_de="Zzztestvogel Alpha",
        common_name_en="Zzztest Bird Alpha",
        scientific_name="Zzztestus alpha",
        family_name="Zzztestidae",
        order_name="Zzztestiformes",
        ring_size=Ring.RingSizes.V,
    )


@pytest.fixture
def sentinel_species(db):
    """The 'Ring Vernichtet' Sonderart row (special_kind='ring_destroyed'),
    seeded by migration 0032 and re-keyed by 0036."""
    return Species.objects.get(special_kind=Species.SpecialKind.RING_DESTROYED)


@pytest.fixture
def aves_ignota_species(db):
    """The 'Aves ignota' Sonderart row (special_kind='unknown_species'),
    created by data migration 0037."""
    return Species.objects.get(special_kind=Species.SpecialKind.UNKNOWN_SPECIES)


@pytest.fixture
def species_other(db):
    return Species.objects.create(
        common_name_de="Yyytestvogel Beta",
        common_name_en="Yyytest Bird Beta",
        scientific_name="Yyytestus beta",
        family_name="Yyytestidae",
        order_name="Yyytestiformes",
        ring_size=Ring.RingSizes.V,
    )


@pytest.fixture
def ring(db):
    return Ring.objects.create(number="100", size=Ring.RingSizes.V)


@pytest.fixture
def data_entry(species, ring, scientist, ringing_station):
    return DataEntry.objects.create(
        species=species,
        ring=ring,
        staff=scientist,
        ringing_station=ringing_station,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )


@pytest.fixture
def species_list(user, species):
    sl = SpeciesList.objects.create(name="My List", user=user, is_active=False)
    sl.species.add(species)
    return sl


@pytest.fixture
def project(organization, scientist):
    p = Project.objects.create(title="My Project", organization=organization)
    p.scientists.add(scientist)
    return p


# --- Two-tenant harness (ADR 0005, issue #69) -------------------------------
# Tenant A is the existing single-tenant set (``organization`` / ``scientist`` /
# ``ringing_station`` / ``project`` / ``data_entry``); tenant B mirrors it below.
# Each tenant is complete — its own Organisation, Mitglieder, no-account
# Beringer, Station, Projekt and captures — so isolation tests can prove a
# Mitglied of one tenant never sees the other's data.


@pytest.fixture
def organization_b(db):
    return Organization.objects.create(handle="ORG2", name="Second Org", country="AT")


@pytest.fixture
def user_b(db):
    return User.objects.create_user(username="bruno", password="hunter2-very-strong")


@pytest.fixture
def scientist_b(user_b, organization_b):
    """Bruno — an Admin Mitglied of tenant B (``organization_b``)."""
    s = Scientist.objects.create(user=user_b, handle="BRU", organization=organization_b)
    Mitgliedschaft.objects.create(
        user=user_b, organization=organization_b, rolle=Mitgliedschaft.Rolle.ADMIN
    )
    return s


@pytest.fixture
def no_account_beringer_b(organization_b):
    """A no-account Beringer owned by tenant B (a selectable name, not an actor)."""
    return Scientist.objects.create(
        first_name="Berta", last_name="Helfer", organization=organization_b
    )


@pytest.fixture
def auth_client_b(user_b):
    # An independent client so a test can act as tenant A and tenant B at once.
    client = APIClient()
    client.force_authenticate(user=user_b)
    return client


@pytest.fixture
def ringing_station_b(organization_b):
    return RingingStation.objects.create(
        handle="STN2", name="Station B", organization=organization_b
    )


@pytest.fixture
def project_b(organization_b, scientist_b):
    p = Project.objects.create(title="Project B", organization=organization_b)
    p.scientists.add(scientist_b)
    return p


@pytest.fixture
def data_entry_b(species, scientist_b, ringing_station_b, organization_b):
    # Species is global reference data; the Ring is scoped to tenant B (ADR 0006),
    # as are the other Organisation-owned bits that differ from tenant A.
    return DataEntry.objects.create(
        species=species,
        ring=Ring.objects.create(number="800", size=Ring.RingSizes.V, organization=organization_b),
        staff=scientist_b,
        ringing_station=ringing_station_b,
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
