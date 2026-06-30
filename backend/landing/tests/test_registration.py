"""Zugangscode-gated registration on the public Landing app (issue #79).

A newcomer founds an Organisation through a single-use Zugangscode: a public,
unauthenticated registration view validates the code and, in one transaction,
creates the User + Beringer + Organisation + Admin-Mitgliedschaft and sends an
email verification (double opt-in, ADR 0005/0008). Driven through the Django
test client as an ordinary visitor would reach it — no DRF, no SPA, no login.
"""

import re

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from birds.accounts import create_public_account
from birds.models import Mitgliedschaft, Organization, Scientist, Zugangscode

# The verification link the registration mails, as a server-relative path:
# /registrierung/bestaetigen/<uid>/<token>/
VERIFY_LINK = re.compile(r"/registrierung/bestaetigen/[\w\-]+/[\w\-]+/")

PASSWORD = "a-very-strong-pass-9"


@pytest.fixture
def code(db):
    """An unused single-use Zugangscode issued by the operator."""
    return Zugangscode.objects.create(code="BETA-WELCOME-1")


def _form_data(**overrides):
    data = {
        "email": "newcomer@example.org",
        "password1": PASSWORD,
        "password2": PASSWORD,
        "first_name": "Filip",
        "last_name": "Reiter",
        "organisation_name": "IWM Linz",
        "code": "BETA-WELCOME-1",
        # Founding requires accepting the AGB + DPA (issue #78); the checkbox is
        # ticked on the happy path.
        "accept_agb": "on",
    }
    data.update(overrides)
    return data


def test_registration_page_renders_unauthenticated(client, db):
    # An anonymous visitor reaches the registration page directly.
    response = client.get(reverse("landing:register"))
    assert response.status_code == 200
    # Server-rendered on the shared public base, not the Angular SPA shell.
    assert "landing/base.html" in {t.name for t in response.templates}
    assert "app-root" not in response.content.decode()


def test_registration_page_offers_the_agb_acceptance_with_a_link(client, db):
    # Founding is a recorded acceptance of the AGB + DPA (issue #78): the page
    # carries the acceptance checkbox and a link to the AGB (which holds the DPA).
    response = client.get(reverse("landing:register"))
    content = response.content.decode()
    assert 'name="accept_agb"' in content
    assert reverse("landing:agb") in content


def test_valid_code_founds_organisation_and_sends_verification_mail(client, code, mailoutbox):
    # A newcomer registers with a valid code through the public form.
    response = client.post(reverse("landing:register"), _form_data())
    assert response.status_code == 302

    User = get_user_model()
    user = User.objects.get(email="newcomer@example.org")
    org = Organization.objects.get(name="IWM Linz")
    # The founder holds an Admin-Mitgliedschaft in the new Organisation.
    membership = Mitgliedschaft.objects.get(user=user, organization=org)
    assert membership.rolle == Mitgliedschaft.Rolle.ADMIN
    # ...and is recorded as a Beringer owned by that Organisation.
    assert Scientist.objects.filter(user=user, organization=org).exists()
    # One verification mail leaves the system, from the BirdDoc sender.
    assert len(mailoutbox) == 1
    assert mailoutbox[0].to == ["newcomer@example.org"]
    assert mailoutbox[0].from_email == "noreply@birddoc.eu"


def test_new_organisation_defaults_to_beta_plan_in_the_beta_cohort(client, code):
    # Founding records the beta cohort at the moment of creation (ADR 0005).
    client.post(reverse("landing:register"), _form_data())
    org = Organization.objects.get(name="IWM Linz")
    assert org.plan == Organization.Plan.BETA
    assert org.beta_cohort is True


def test_founding_records_the_agb_dpa_acceptance_on_the_organisation(client, code):
    # Acceptance is durably recorded on the controlling Organisation (issue #78).
    client.post(reverse("landing:register"), _form_data())
    org = Organization.objects.get(name="IWM Linz")
    assert org.agb_accepted_at is not None


def test_founding_is_rejected_when_the_agb_dpa_is_not_accepted(client, code, mailoutbox):
    # Leaving the AGB + DPA box unchecked blocks founding entirely: the form is
    # re-rendered and nothing is created (issue #78, PRD #68 story 51).
    data = _form_data()
    del data["accept_agb"]  # an unchecked checkbox is simply absent from the POST
    response = client.post(reverse("landing:register"), data)
    assert response.status_code == 200
    assert not get_user_model().objects.filter(email="newcomer@example.org").exists()
    assert not Organization.objects.filter(name="IWM Linz").exists()
    # The single-use code is preserved for a later, valid attempt, and no mail left.
    code.refresh_from_db()
    assert code.is_used is False
    assert mailoutbox == []


def test_account_cannot_log_in_until_the_email_is_verified(client, code):
    # Strict double opt-in: the account is inactive until the link is followed,
    # and the auth backend refuses inactive logins (ADR 0008).
    client.post(reverse("landing:register"), _form_data())
    user = get_user_model().objects.get(email="newcomer@example.org")
    assert user.is_active is False
    assert not client.login(username="newcomer@example.org", password=PASSWORD)


def test_after_registering_the_user_is_directed_to_the_app_login(client, code):
    # The post-registration page points the founder at the app login to sign in.
    response = client.post(reverse("landing:register"), _form_data(), follow=True)
    assert settings.APP_LOGIN_URL in response.content.decode()


def test_verification_link_activates_the_account_and_enables_login(client, code, mailoutbox):
    client.post(reverse("landing:register"), _form_data())
    User = get_user_model()
    user = User.objects.get(email="newcomer@example.org")
    assert user.is_active is False

    verify_path = VERIFY_LINK.search(mailoutbox[0].body).group(0)
    response = client.get(verify_path)
    assert response.status_code == 200
    assert "landing/base.html" in {t.name for t in response.templates}

    # The address is confirmed: the account is now active and can sign in.
    user.refresh_from_db()
    assert user.is_active is True
    assert client.login(username="newcomer@example.org", password=PASSWORD)


def test_invalid_verification_link_confirms_nothing(client, code, mailoutbox):
    client.post(reverse("landing:register"), _form_data())
    user = get_user_model().objects.get(email="newcomer@example.org")

    # A tampered token is refused and the account stays inactive.
    bad_url = reverse(
        "landing:register_verify",
        kwargs={"uidb64": urlsafe_base64_encode(force_bytes(user.pk)), "token": "not-a-token"},
    )
    response = client.get(bad_url)
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.is_active is False


def test_unknown_code_is_rejected_and_creates_nothing(client, db, mailoutbox):
    response = client.post(reverse("landing:register"), _form_data(code="NOT-A-CODE"))
    # The form is re-rendered (not a redirect) with a clear message.
    assert response.status_code == 200
    assert "ungültig" in response.content.decode()
    # Nothing was created and no mail left the system.
    assert not get_user_model().objects.filter(email="newcomer@example.org").exists()
    assert not Organization.objects.filter(name="IWM Linz").exists()
    assert mailoutbox == []


def test_a_used_code_cannot_found_a_second_organisation(client, code, mailoutbox):
    # First founding succeeds and spends the code.
    first = client.post(reverse("landing:register"), _form_data())
    assert first.status_code == 302

    # A second newcomer tries the very same code.
    response = client.post(
        reverse("landing:register"),
        _form_data(email="second@example.org", organisation_name="Zweite Org"),
    )
    assert response.status_code == 200
    assert "ungültig" in response.content.decode()
    # The second founding created nothing; only the first ever mailed.
    assert not get_user_model().objects.filter(email="second@example.org").exists()
    assert not Organization.objects.filter(name="Zweite Org").exists()
    assert len(mailoutbox) == 1


def test_duplicate_email_is_rejected_and_leaves_the_code_unspent(client, code, mailoutbox):
    # An account already exists for this email.
    create_public_account("newcomer@example.org", "existing-pass-strong-2")
    response = client.post(reverse("landing:register"), _form_data())
    assert response.status_code == 200
    assert "bereits ein Konto" in response.content.decode()
    # The code is not consumed and no Organisation was founded.
    code.refresh_from_db()
    assert code.is_used is False
    assert not Organization.objects.filter(name="IWM Linz").exists()
    assert mailoutbox == []


def test_operator_creates_single_use_code_in_the_admin(client, db):
    # The operator issues a code through the Django admin (ADR 0005).
    User = get_user_model()
    User.objects.create_superuser("operator", "op@example.org", "admin-pass-strong-3")
    assert client.login(username="operator", password="admin-pass-strong-3")

    response = client.post(
        reverse("admin:birds_zugangscode_add"),
        {"code": "OP-CODE-1", "note": "für Filip"},
    )
    assert response.status_code == 302
    issued = Zugangscode.objects.get(code="OP-CODE-1")
    # A freshly issued code is unused.
    assert issued.is_used is False
