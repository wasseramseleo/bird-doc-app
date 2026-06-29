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
    # The lead is stored exactly as left, typed as a `beringer` lead — the
    # Warteliste funnel is unchanged by the typed extension (issue #103).
    lead = Warteliste.objects.get()
    assert lead.email == "neue.beringerin@example.org"
    assert lead.lead_type == Warteliste.LeadType.BERINGER


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


def test_operator_filters_the_lead_queue_by_type(client, db, django_user_model):
    # One lead of each type lands in the same queue.
    Warteliste.objects.create(
        email="einzel.beringer@example.org",
        lead_type=Warteliste.LeadType.BERINGER,
    )
    Warteliste.objects.create(
        email="leitung@vogelwarte.example",
        organisation_name="Österreichische Vogelwarte",
        lead_type=Warteliste.LeadType.ORGANISATION,
    )
    operator = django_user_model.objects.create_superuser(
        username="operator", email="operator@example.test", password="x-very-strong-9"
    )
    client.force_login(operator)

    changelist_url = reverse("admin:landing_warteliste_changelist")

    # The changelist offers a type filter as a clickable affordance (the admin
    # sidebar), not just a hand-typed URL — that is what "filters by type" means
    # to the operator.
    unfiltered = client.get(changelist_url)
    unfiltered_body = unfiltered.content.decode()
    assert 'id="changelist-filter"' in unfiltered_body
    assert "lead_type__exact=organisation" in unfiltered_body

    # The operator narrows the queue to organisation leads only...
    org_only = client.get(changelist_url, {"lead_type": Warteliste.LeadType.ORGANISATION})
    assert org_only.status_code == 200
    body = org_only.content.decode()
    assert "leitung@vogelwarte.example" in body
    assert "einzel.beringer@example.org" not in body

    # ...and back to beringer leads only.
    beringer_only = client.get(changelist_url, {"lead_type": Warteliste.LeadType.BERINGER})
    beringer_body = beringer_only.content.decode()
    assert "einzel.beringer@example.org" in beringer_body
    assert "leitung@vogelwarte.example" not in beringer_body


def test_home_page_links_to_the_warteliste(client):
    # The apex landing page invites visitors to "Zugang anfragen".
    response = client.get(reverse("landing:home"))
    content = response.content.decode()
    assert reverse("landing:warteliste") in content
    assert "Zugang anfragen" in content


def test_home_page_links_to_the_gespraech_funnel(client):
    # The apex landing page also offers the organisation track its own CTA — a
    # Gespräch, distinct from the individual Beringer's Warteliste (issue #103).
    # The org-track slice (#105) labels that CTA "Gespräch anfragen".
    response = client.get(reverse("landing:home"))
    content = response.content.decode()
    assert reverse("landing:gespraech") in content
    assert "Gespräch anfragen" in content


def test_a_legacy_style_lead_defaults_to_a_beringer_lead(db):
    # A row left exactly as the pre-#103 model stored it (only an email) reads
    # back as a `beringer` lead with empty org-context — the typed extension is
    # additive, so existing rows and behaviour are unaffected.
    lead = Warteliste.objects.create(email="schon.da@example.org")
    lead.refresh_from_db()
    assert lead.lead_type == Warteliste.LeadType.BERINGER
    assert lead.contact_role == ""
    assert lead.approx_beringer_count == ""


# --- Gespräch (organisation lead) -----------------------------------------
#
# The second public funnel of issue #103: a central body (e.g. the
# Österreichische Vogelwarte) requests a Gespräch instead of self-serving the
# Warteliste. It writes an `organisation` lead to the *same* model, carrying the
# extra org-context the operator needs to follow up.


def test_gespraech_post_stores_an_organisation_lead_with_its_context(client, db):
    response = client.post(
        reverse("landing:gespraech"),
        {
            "email": "leitung@vogelwarte.example",
            "organisation_name": "Österreichische Vogelwarte",
            "contact_role": "Wissenschaftliche Leitung",
            "approx_beringer_count": "ca. 120",
            "message": "Wir prüfen BirdDoc schemaweit.",
        },
    )
    # The visitor is sent on to a confirmation page.
    assert response.status_code == 302
    assert response.url == reverse("landing:gespraech_done")
    # One lead is stored, typed as an organisation, with the context preserved.
    lead = Warteliste.objects.get()
    assert lead.lead_type == Warteliste.LeadType.ORGANISATION
    assert lead.organisation_name == "Österreichische Vogelwarte"
    assert lead.contact_role == "Wissenschaftliche Leitung"
    assert lead.approx_beringer_count == "ca. 120"
    assert lead.message == "Wir prüfen BirdDoc schemaweit."


def test_gespraech_post_emails_the_operator_with_the_context(client, db, mailoutbox, settings):
    settings.OPERATOR_EMAIL = "operator@example.test"
    client.post(
        reverse("landing:gespraech"),
        {
            "email": "leitung@vogelwarte.example",
            "organisation_name": "Österreichische Vogelwarte",
            "contact_role": "Wissenschaftliche Leitung",
            "approx_beringer_count": "ca. 120",
            "message": "Wir prüfen BirdDoc schemaweit.",
        },
    )
    # Exactly one notification leaves the system, to the operator, from BirdDoc.
    assert len(mailoutbox) == 1
    message = mailoutbox[0]
    assert message.to == ["operator@example.test"]
    assert message.from_email == "noreply@birddoc.at"
    # The operator can triage from the inbox: the subject marks it an org lead...
    assert "Organisation" in message.subject
    # ...and the body carries the extra org context, not just the email.
    assert "leitung@vogelwarte.example" in message.body
    assert "Österreichische Vogelwarte" in message.body
    assert "Wissenschaftliche Leitung" in message.body
    assert "ca. 120" in message.body
    assert "Wir prüfen BirdDoc schemaweit." in message.body
