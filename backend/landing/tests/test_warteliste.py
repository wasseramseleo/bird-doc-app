"""The public Warteliste — "Zugang anfragen" on the landing page (issue #80).

The Warteliste collects demand for Zugangscodes but grants nothing by itself:
a visitor leaves a lead, the operator is emailed, and a confirmation is shown.
These exercise the slice through the Django test client as an ordinary,
unauthenticated visitor would reach it — no DRF, no SPA, no login.
"""

from django.urls import reverse

from landing.models import Warteliste


def test_warteliste_form_renders_unauthenticated(client):
    # An anonymous visitor reaches the "Zugang anfragen" form directly.
    response = client.get(reverse("landing:warteliste"))
    assert response.status_code == 200
    # Server-rendered on the shared public base, not the Angular SPA shell.
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    content = response.content.decode()
    assert "app-root" not in content


def test_submitting_stores_a_lead_and_redirects_to_confirmation(client, db):
    response = client.post(
        reverse("landing:warteliste"),
        {"email": "neue.beringerin@example.org"},
    )
    # The visitor is sent on to the confirmation page.
    assert response.status_code == 302
    assert response.url == reverse("landing:warteliste_done")
    # The lead is stored exactly as left.
    lead = Warteliste.objects.get()
    assert lead.email == "neue.beringerin@example.org"


def test_confirmation_page_renders_unauthenticated(client):
    response = client.get(reverse("landing:warteliste_done"))
    assert response.status_code == 200
    # Server-rendered on the shared public base, not the SPA, and it confirms
    # the request was received.
    template_names = {t.name for t in response.templates}
    assert "landing/base.html" in template_names
    content = response.content.decode()
    assert "app-root" not in content
    assert "Warteliste" in content


def test_submitting_emails_the_operator(client, db, mailoutbox, settings):
    settings.OPERATOR_EMAIL = "operator@example.test"
    client.post(
        reverse("landing:warteliste"),
        {
            "email": "neue.beringerin@example.org",
            "organisation_name": "IWM Linz",
        },
    )
    # Exactly one notification leaves the system, to the operator, from BirdDoc.
    assert len(mailoutbox) == 1
    message = mailoutbox[0]
    assert message.to == ["operator@example.test"]
    assert message.from_email == "noreply@birddoc.at"
    # The operator can act on it without opening the admin: the lead's email and
    # the Organisation it names are in the body.
    assert "neue.beringerin@example.org" in message.body
    assert "IWM Linz" in message.body


def test_blank_email_stores_nothing_and_re_renders_the_form(client, db, mailoutbox):
    response = client.post(reverse("landing:warteliste"), {"email": ""})
    # The form comes back (200, not a redirect) with a validation error.
    assert response.status_code == 200
    assert response.context["form"].errors
    # Nothing is stored and the operator is not bothered.
    assert Warteliste.objects.count() == 0
    assert len(mailoutbox) == 0


def test_operator_reviews_leads_in_the_django_admin(client, db, django_user_model):
    lead = Warteliste.objects.create(
        email="warteschlange@example.org", organisation_name="IWM Linz"
    )
    operator = django_user_model.objects.create_superuser(
        username="operator", email="operator@example.test", password="x-very-strong-9"
    )
    client.force_login(operator)

    # The lead shows up on the Warteliste changelist...
    changelist = client.get(reverse("admin:landing_warteliste_changelist"))
    assert changelist.status_code == 200
    assert "warteschlange@example.org" in changelist.content.decode()

    # ...and the operator can open it for review.
    detail = client.get(reverse("admin:landing_warteliste_change", args=[lead.pk]))
    assert detail.status_code == 200


def test_home_page_links_to_the_warteliste(client):
    # The apex landing page invites visitors to "Zugang anfragen".
    response = client.get(reverse("landing:home"))
    content = response.content.decode()
    assert reverse("landing:warteliste") in content
    assert "Zugang anfragen" in content
