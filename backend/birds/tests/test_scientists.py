import pytest

from birds.models import Scientist


@pytest.mark.django_db
def test_autocomplete_shows_only_active_organisations_beringer(
    auth_client, membership, organization, organization_b
):
    """The Beringer autocomplete is tenant-scoped: it shows only own-Organisation
    Beringer (Mitglieder + No-Account), never another tenant's (issue #74)."""
    mine = Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )
    Scientist.objects.create(
        handle="BER", first_name="Berta", last_name="Fremd", organization=organization_b
    )

    response = auth_client.get("/api/birds/scientists/")

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == [mine.handle]


@pytest.mark.django_db
def test_two_tenant_beringer_isolation_includes_mitglieder_and_no_account(
    auth_client, auth_client_b, membership, organization, scientist_b, no_account_beringer_b
):
    """Two complete tenants: each Mitglied's autocomplete lists only its own
    Organisation's Beringer — both Mitglieder (``scientist_b``) and No-Account
    Beringer (``no_account_beringer_b``) — with no A↔B leakage (issue #74)."""
    mine = Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    a = [row["handle"] for row in auth_client.get("/api/birds/scientists/").json()["results"]]
    b = [row["handle"] for row in auth_client_b.get("/api/birds/scientists/").json()["results"]]

    assert a == [mine.handle]
    assert set(b) == {scientist_b.handle, no_account_beringer_b.handle}


@pytest.mark.django_db
def test_cross_tenant_beringer_detail_returns_404(auth_client, membership, organization_b):
    """A cross-tenant Beringer detail fetch is a 404 (the row is invisible), not a
    403 (issue #74)."""
    foreign = Scientist.objects.create(
        handle="BER", first_name="Berta", last_name="Fremd", organization=organization_b
    )

    response = auth_client.get(f"/api/birds/scientists/{foreign.id}/")

    assert response.status_code == 404


@pytest.mark.django_db
def test_accountless_beringer_full_name_from_own_fields(auth_client, membership, organization):
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    assert response.status_code == 200
    row = response.json()["results"][0]
    assert row["full_name"] == "Filip Reiter"


@pytest.mark.django_db
def test_full_name_falls_back_to_linked_user_when_own_fields_empty(
    auth_client, membership, organization, user
):
    user.first_name = "Alice"
    user.last_name = "Adams"
    user.save()
    Scientist.objects.create(user=user, handle="AAD", organization=organization)

    response = auth_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert row["full_name"] == "Alice Adams"


@pytest.mark.django_db
def test_own_name_fields_take_precedence_over_linked_user(
    auth_client, membership, organization, user
):
    user.first_name = "Alice"
    user.last_name = "Adams"
    user.save()
    Scientist.objects.create(
        user=user, handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    row = response.json()["results"][0]
    assert row["full_name"] == "Filip Reiter"


@pytest.mark.django_db
def test_search_matches_on_own_name_fields(auth_client, membership, organization):
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )
    Scientist.objects.create(
        handle="JMU", first_name="Jana", last_name="Müller", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/", {"search": "Reiter"})

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_search_matches_on_handle(auth_client, membership, organization):
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )
    Scientist.objects.create(
        handle="JMU", first_name="Jana", last_name="Müller", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/", {"search": "FRE"})

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_listing_is_ordered_by_own_last_name(auth_client, membership, organization):
    Scientist.objects.create(
        handle="JMU", first_name="Jana", last_name="Müller", organization=organization
    )
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )
    Scientist.objects.create(
        handle="ABA", first_name="Anna", last_name="Bauer", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    handles = [row["handle"] for row in response.json()["results"]]
    assert handles == ["ABA", "JMU", "FRE"]


@pytest.mark.django_db
def test_authenticated_user_can_create_accountless_beringer(auth_client, membership, organization):
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
def test_new_beringer_attaches_to_active_organisation(auth_client, membership, organization):
    """A quick-added No-Account Beringer attaches to the requester's active
    Organisation, so it is org-owned and appears only in that tenant's
    autocomplete (issue #74)."""
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert Scientist.objects.get(handle="FRE").organization == organization


@pytest.mark.django_db
def test_create_beringer_rejected_without_active_organisation(auth_client):
    """Without a Mitgliedschaft there is no active Organisation to own the
    Beringer, so the quick-add is refused (issue #74)."""
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 403
    assert not Scientist.objects.filter(first_name="Filip").exists()


@pytest.mark.django_db
def test_create_derives_kuerzel_when_omitted(auth_client, membership):
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter"},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["handle"] == "FRE"
    assert Scientist.objects.get(first_name="Filip").handle == "FRE"


@pytest.mark.django_db
def test_create_respects_supplied_kuerzel(auth_client, membership):
    response = auth_client.post(
        "/api/birds/scientists/",
        {"first_name": "Filip", "last_name": "Reiter", "handle": "XYZ"},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["handle"] == "XYZ"


@pytest.mark.django_db
def test_listing_excludes_reserved_fallback_beringer(auth_client, membership, organization):
    # The fallback Beringer (Kürzel GELÖSCHT) exists via data migration; it is
    # org-less, so the tenant scope already drops it, and it must stay hidden from
    # the autocomplete so no fresh capture is filed against it.
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.get("/api/birds/scientists/")

    handles = [row["handle"] for row in response.json()["results"]]
    assert "GELÖSCHT" not in handles
    assert handles == ["FRE"]


@pytest.mark.django_db
def test_search_never_matches_reserved_fallback_beringer(auth_client, membership):
    response = auth_client.get("/api/birds/scientists/", {"search": "Nutzer"})

    assert response.json()["results"] == []


@pytest.mark.django_db
def test_beringer_cannot_be_edited_or_deleted_via_api(auth_client):
    beringer = Scientist.objects.create(handle="FRE", first_name="Filip", last_name="Reiter")
    detail = f"/api/birds/scientists/{beringer.id}/"

    assert auth_client.put(detail, {"handle": "XXX"}, format="json").status_code == 405
    assert auth_client.patch(detail, {"handle": "XXX"}, format="json").status_code == 405
    assert auth_client.delete(detail).status_code == 405
