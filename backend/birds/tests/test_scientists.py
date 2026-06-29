import pytest

from birds.models import Scientist


@pytest.mark.django_db
def test_accountless_beringer_full_name_from_own_fields(auth_client):
    Scientist.objects.create(handle="FRE", first_name="Filip", last_name="Reiter")

    response = auth_client.get("/api/birds/scientists/")

    assert response.status_code == 200
    row = response.json()["results"][0]
    assert row["full_name"] == "Filip Reiter"


@pytest.mark.django_db
def test_full_name_falls_back_to_linked_user_when_own_fields_empty(auth_client, user):
    user.first_name = "Alice"
    user.last_name = "Adams"
    user.save()
    Scientist.objects.create(user=user, handle="AAD")

    response = auth_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert row["full_name"] == "Alice Adams"


@pytest.mark.django_db
def test_own_name_fields_take_precedence_over_linked_user(auth_client, user):
    user.first_name = "Alice"
    user.last_name = "Adams"
    user.save()
    Scientist.objects.create(user=user, handle="FRE", first_name="Filip", last_name="Reiter")

    response = auth_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert row["full_name"] == "Filip Reiter"


@pytest.mark.django_db
def test_search_matches_on_own_name_fields(auth_client):
    Scientist.objects.create(handle="FRE", first_name="Filip", last_name="Reiter")
    Scientist.objects.create(handle="JMU", first_name="Jana", last_name="Müller")

    response = auth_client.get("/api/birds/scientists/", {"search": "Reiter"})

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_search_matches_on_handle(auth_client):
    Scientist.objects.create(handle="FRE", first_name="Filip", last_name="Reiter")
    Scientist.objects.create(handle="JMU", first_name="Jana", last_name="Müller")

    response = auth_client.get("/api/birds/scientists/", {"search": "FRE"})

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_listing_is_ordered_by_own_last_name(auth_client):
    Scientist.objects.create(handle="JMU", first_name="Jana", last_name="Müller")
    Scientist.objects.create(handle="FRE", first_name="Filip", last_name="Reiter")
    Scientist.objects.create(handle="ABA", first_name="Anna", last_name="Bauer")

    response = auth_client.get("/api/birds/scientists/")

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["ABA", "JMU", "FRE"]


@pytest.mark.django_db
def test_authenticated_user_can_create_accountless_beringer(auth_client):
    response = auth_client.post(
        "/api/birds/scientists/",
        {"handle": "FRE", "first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 201
    beringer = Scientist.objects.get(handle="FRE")
    assert beringer.user is None
    assert beringer.full_name == "Filip Reiter"


@pytest.mark.django_db
def test_create_derives_kuerzel_when_omitted(auth_client):
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["handle"] == "FRE"
    assert Scientist.objects.get(first_name="Filip").handle == "FRE"


@pytest.mark.django_db
def test_create_respects_supplied_kuerzel(auth_client):
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter", "handle": "XYZ"},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["handle"] == "XYZ"


@pytest.mark.django_db
def test_listing_excludes_reserved_fallback_beringer(auth_client):
    # The fallback Beringer (Kürzel GELÖSCHT) exists via data migration; it must
    # stay hidden from the autocomplete so no fresh capture is filed against it.
    Scientist.objects.create(handle="FRE", first_name="Filip", last_name="Reiter")

    response = auth_client.get("/api/birds/scientists/")

    handles = [row["handle"] for row in response.json()["results"]]
    assert "GELÖSCHT" not in handles
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_search_never_matches_reserved_fallback_beringer(auth_client):
    response = auth_client.get("/api/birds/scientists/", {"search": "Nutzer"})

    assert response.json()["results"] == []


@pytest.mark.django_db
def test_beringer_cannot_be_edited_or_deleted_via_api(auth_client):
    beringer = Scientist.objects.create(handle="FRE", first_name="Filip", last_name="Reiter")
    detail = f"/api/birds/scientists/{beringer.id}/"

    assert auth_client.put(detail, {"handle": "XXX"}, format="json").status_code == 405
    assert auth_client.patch(detail, {"handle": "XXX"}, format="json").status_code == 405
    assert auth_client.delete(detail).status_code == 405
