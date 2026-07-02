import pytest

from birds.accounts import create_public_account

LOGIN_URL = "/api/auth/login/"
LOGOUT_URL = "/api/auth/logout/"
ME_URL = "/api/auth/me/"


@pytest.mark.django_db
def test_login_with_email_for_public_account(api_client):
    create_public_account("birder@example.com", "hunter2-very-strong")
    response = api_client.post(
        LOGIN_URL,
        {"username": "birder@example.com", "password": "hunter2-very-strong"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["username"] == "birder@example.com"


@pytest.mark.django_db
def test_login_with_email_is_case_insensitive(api_client):
    create_public_account("birder@example.com", "hunter2-very-strong")
    response = api_client.post(
        LOGIN_URL,
        {"username": "Birder@Example.COM", "password": "hunter2-very-strong"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["username"] == "birder@example.com"


@pytest.mark.django_db
def test_legacy_username_account_still_logs_in_by_username(api_client, user):
    # `user` fixture is a legacy account: username "alice", no email set.
    assert user.email == ""
    response = api_client.post(
        LOGIN_URL,
        {"username": "alice", "password": "hunter2-very-strong"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["username"] == "alice"


@pytest.mark.django_db
def test_login_with_valid_credentials_returns_payload(api_client, user, scientist, organization):
    response = api_client.post(
        LOGIN_URL,
        {"username": "alice", "password": "hunter2-very-strong"},
        format="json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "username": "alice",
        "handle": "ALC",
        "is_staff": False,
        "active_organization_rolle": "admin",
        "active_organization": {
            "id": str(organization.id),
            "handle": "ORG1",
            "name": "Test Org",
            "country": "DE",
        },
    }


@pytest.mark.django_db
def test_login_payload_handle_is_null_without_scientist(api_client, user):
    response = api_client.post(
        LOGIN_URL,
        {"username": "alice", "password": "hunter2-very-strong"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["handle"] is None


@pytest.mark.django_db
def test_login_with_missing_fields_returns_401(api_client):
    response = api_client.post(LOGIN_URL, {"username": "alice"}, format="json")
    assert response.status_code == 401


@pytest.mark.django_db
def test_login_with_invalid_credentials_returns_401(api_client, user):
    response = api_client.post(LOGIN_URL, {"username": "alice", "password": "wrong"}, format="json")
    assert response.status_code == 401


@pytest.mark.django_db
def test_logout_requires_authentication(api_client):
    response = api_client.post(LOGOUT_URL)
    assert response.status_code in (401, 403)


@pytest.mark.django_db
def test_logout_authenticated_returns_204(auth_client):
    response = auth_client.post(LOGOUT_URL)
    assert response.status_code == 204


@pytest.mark.django_db
def test_me_unauthenticated_returns_401(api_client):
    response = api_client.get(ME_URL)
    assert response.status_code == 401


@pytest.mark.django_db
def test_me_authenticated_returns_payload(auth_client, scientist, organization):
    response = auth_client.get(ME_URL)
    assert response.status_code == 200
    assert response.json() == {
        "username": "alice",
        "handle": "ALC",
        "is_staff": False,
        "active_organization_rolle": "admin",
        "active_organization": {
            "id": str(organization.id),
            "handle": "ORG1",
            "name": "Test Org",
            "country": "DE",
        },
    }


@pytest.mark.django_db
def test_me_sets_csrf_cookie(api_client):
    response = api_client.get(ME_URL)
    assert "csrftoken" in response.cookies


@pytest.mark.django_db
def test_me_reports_active_organization_rolle_admin(auth_client, scientist):
    # Alice's single Mitgliedschaft in tenant A is Admin, so her active
    # Organisation's Rolle resolves to "admin".
    response = auth_client.get(ME_URL)
    assert response.status_code == 200
    assert response.json()["active_organization_rolle"] == "admin"


@pytest.mark.django_db
def test_me_reports_active_organization_rolle_mitglied(mitglied_client, mitglied_scientist):
    response = mitglied_client.get(ME_URL)
    assert response.status_code == 200
    assert response.json()["active_organization_rolle"] == "mitglied"


@pytest.mark.django_db
def test_me_reports_null_rolle_without_unambiguous_active_organisation(auth_client, user):
    # No Mitgliedschaft ⇒ no unambiguous active Organisation ⇒ null Rolle.
    response = auth_client.get(ME_URL)
    assert response.status_code == 200
    assert response.json()["active_organization_rolle"] is None


@pytest.mark.django_db
def test_me_reports_null_active_organization_without_unambiguous_active_organisation(
    auth_client, user
):
    # Same "no unambiguous active Organisation" case, for the Organisation itself
    # — this is the identity the offline PWA caches (issue #156).
    response = auth_client.get(ME_URL)
    assert response.status_code == 200
    assert response.json()["active_organization"] is None
