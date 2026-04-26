import pytest

from birds.models import Ring

NEXT_NUMBER_URL = "/api/birds/rings/next-number/"
LIST_URL = "/api/birds/rings/"


@pytest.mark.django_db
def test_next_number_requires_size_param(auth_client):
    response = auth_client.get(NEXT_NUMBER_URL)
    assert response.status_code == 400
    assert "error" in response.json()


@pytest.mark.django_db
def test_next_number_with_no_rings_returns_one(auth_client):
    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V"})
    assert response.status_code == 200
    assert response.json() == {"next_number": 1}


@pytest.mark.django_db
def test_next_number_returns_max_plus_one(auth_client):
    Ring.objects.create(number="9", size=Ring.RingSizes.V)
    Ring.objects.create(number="10", size=Ring.RingSizes.V)
    Ring.objects.create(number="2", size=Ring.RingSizes.V)

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V"})
    assert response.status_code == 200
    assert response.json() == {"next_number": 11}


@pytest.mark.django_db
def test_next_number_isolated_per_size(auth_client):
    Ring.objects.create(number="50", size=Ring.RingSizes.V)
    Ring.objects.create(number="5", size=Ring.RingSizes.T)

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "T"})
    assert response.json() == {"next_number": 6}


@pytest.mark.django_db
def test_next_number_falls_back_to_one_for_non_numeric(auth_client):
    Ring.objects.create(number="ABC", size=Ring.RingSizes.V)

    response = auth_client.get(NEXT_NUMBER_URL, {"size": "V"})
    assert response.json() == {"next_number": 1}


@pytest.mark.django_db
def test_rings_endpoint_is_read_only(auth_client):
    response = auth_client.post(LIST_URL, {"number": "1", "size": "V"}, format="json")
    assert response.status_code == 405
