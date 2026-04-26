import pytest

LOGIN_URL = "/api/auth/login/"
LOGOUT_URL = "/api/auth/logout/"
ME_URL = "/api/auth/me/"


@pytest.mark.django_db
def test_login_with_valid_credentials_returns_payload(api_client, user, scientist):
    response = api_client.post(
        LOGIN_URL,
        {"username": "alice", "password": "hunter2-very-strong"},
        format="json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body == {"username": "alice", "handle": "ALC", "is_staff": False}


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
    response = api_client.post(
        LOGIN_URL, {"username": "alice", "password": "wrong"}, format="json"
    )
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
def test_me_authenticated_returns_payload(auth_client, scientist):
    response = auth_client.get(ME_URL)
    assert response.status_code == 200
    assert response.json() == {"username": "alice", "handle": "ALC", "is_staff": False}


@pytest.mark.django_db
def test_me_sets_csrf_cookie(api_client):
    response = api_client.get(ME_URL)
    assert "csrftoken" in response.cookies
