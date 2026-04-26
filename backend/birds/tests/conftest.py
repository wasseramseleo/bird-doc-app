from datetime import datetime, timezone

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from birds.models import (
    DataEntry,
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
def scientist(user):
    return Scientist.objects.create(user=user, handle="ALC")


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
        date_time=datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc),
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
