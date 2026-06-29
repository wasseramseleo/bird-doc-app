"""In-app feedback form that emails the operator (issue #81).

A logged-in user submits a free-text message through the SPA; the backend
emails the operator over the same transactional channel as the rest of the app
(issue #77). It does **not** create GitHub issues — the only side effect is the
operator notification, asserted here via ``mailoutbox``.
"""

import pytest
from django.conf import settings
from rest_framework.test import APIClient

from birds.accounts import create_public_account

FEEDBACK_URL = "/api/feedback/"


@pytest.mark.django_db
def test_authenticated_submission_emails_the_operator(auth_client, mailoutbox):
    response = auth_client.post(
        FEEDBACK_URL,
        {"message": "Die Ringgröße lässt sich nicht speichern."},
        format="json",
    )
    assert response.status_code == 200
    # Exactly one mail leaves the system, to the operator, from the BirdDoc sender.
    assert len(mailoutbox) == 1
    message = mailoutbox[0]
    assert message.to == [settings.OPERATOR_EMAIL]
    assert message.from_email == "noreply@birddoc.at"


@pytest.mark.django_db
def test_operator_mail_carries_the_message_and_lets_the_operator_reply(mailoutbox):
    # A public account logs in by email (ADR 0008); its email is its identity.
    create_public_account("birder@example.org", "hunter2-very-strong")
    client = APIClient()
    assert client.login(username="birder@example.org", password="hunter2-very-strong")

    client.post(
        FEEDBACK_URL,
        {"message": "Der Export bricht bei großen Projekten ab."},
        format="json",
    )

    message = mailoutbox[0]
    # The operator reads the verbatim feedback...
    assert "Der Export bricht bei großen Projekten ab." in message.body
    # ...sees who sent it...
    assert "birder@example.org" in message.subject
    # ...and can reply straight to the submitter (mail still leaves from no-reply).
    assert message.reply_to == ["birder@example.org"]
    assert message.from_email == "noreply@birddoc.at"


@pytest.mark.django_db
@pytest.mark.parametrize("payload", [{"message": "   "}, {"message": ""}, {}])
def test_blank_or_missing_message_is_rejected_and_sends_no_mail(auth_client, mailoutbox, payload):
    response = auth_client.post(FEEDBACK_URL, payload, format="json")
    assert response.status_code == 400
    assert mailoutbox == []


@pytest.mark.django_db
def test_anonymous_user_cannot_submit_and_sends_no_mail(api_client, mailoutbox):
    # The form is for logged-in users only; anonymous posts are refused.
    response = api_client.post(FEEDBACK_URL, {"message": "Hallo"}, format="json")
    assert response.status_code in (401, 403)
    assert mailoutbox == []


@pytest.mark.django_db
def test_submission_emails_the_operator_and_creates_no_github_issue(auth_client, mailoutbox):
    # The feedback path notifies the operator by email — it does NOT open a
    # GitHub issue. The email is the sole side effect and the response carries
    # no issue reference (no number, no URL back to a tracker).
    response = auth_client.post(FEEDBACK_URL, {"message": "Ein Fehler!"}, format="json")
    assert response.status_code == 200
    body = response.json()
    assert not any(key in body for key in ("issue", "issue_url", "html_url", "number"))
    assert len(mailoutbox) == 1
