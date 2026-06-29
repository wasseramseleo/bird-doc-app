"""Tenancy spine: Mitgliedschaft, active-Organisation resolution (issue #69, ADR 0005)."""

import pytest
from django.db import IntegrityError, transaction

from birds.models import FALLBACK_BERINGER_HANDLE, Mitgliedschaft, Organization, Scientist
from birds.tenancy import active_organization


@pytest.mark.django_db
def test_mitgliedschaft_links_account_to_organisation_with_rolle(user, organization):
    membership = Mitgliedschaft.objects.create(
        user=user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )

    assert membership.user == user
    assert membership.organization == organization
    assert membership.rolle == Mitgliedschaft.Rolle.ADMIN


@pytest.mark.django_db
def test_account_may_hold_mitgliedschaften_in_several_organisations(user, organization):
    """The schema allows multiple Mitgliedschaften per account (multi-org), and
    the Rolle is per-org: Admin in one, plain Mitglied in another."""
    org_b = Organization.objects.create(handle="ORG2", name="Second Org")

    a = Mitgliedschaft.objects.create(
        user=user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )
    b = Mitgliedschaft.objects.create(
        user=user, organization=org_b, rolle=Mitgliedschaft.Rolle.MITGLIED
    )

    assert {m.organization for m in user.mitgliedschaften.all()} == {organization, org_b}
    assert a.rolle == Mitgliedschaft.Rolle.ADMIN
    assert b.rolle == Mitgliedschaft.Rolle.MITGLIED


@pytest.mark.django_db
def test_account_cannot_hold_two_mitgliedschaften_in_one_organisation(user, organization):
    Mitgliedschaft.objects.create(user=user, organization=organization)

    with pytest.raises(IntegrityError), transaction.atomic():
        Mitgliedschaft.objects.create(user=user, organization=organization)


@pytest.mark.django_db
def test_beringer_is_org_owned(organization):
    """Both Mitglieder and no-account Beringer carry an Organisation link."""
    no_account = Scientist.objects.create(
        first_name="Hans", last_name="Helfer", organization=organization
    )

    assert no_account.organization == organization
    assert organization.scientists.filter(pk=no_account.pk).exists()


@pytest.mark.django_db
def test_fallback_beringer_stays_org_less():
    """The reserved GELÖSCHT sink is a global cross-tenant fallback, not a real
    org-owned Beringer, so it carries no Organisation."""
    fallback = Scientist.objects.get(handle=FALLBACK_BERINGER_HANDLE)

    assert fallback.organization is None


@pytest.mark.django_db
def test_organization_tenancy_field_defaults():
    """A fresh Organisation is a free beta tenant with the default Seat-Limit and
    no beta-cohort marker until one is set durably."""
    org = Organization.objects.create(handle="NEW", name="New Org")

    assert org.plan == Organization.Plan.BETA
    assert org.seat_limit == 5
    assert org.beta_cohort is False


@pytest.mark.django_db
def test_active_organisation_resolves_single_mitgliedschaft(user, organization):
    """An account with exactly one Mitgliedschaft resolves to that Organisation
    (the org-switcher UI is deferred, so a single membership is implicit)."""
    Mitgliedschaft.objects.create(user=user, organization=organization)

    assert active_organization(user) == organization


@pytest.mark.django_db
def test_active_organisation_is_none_without_mitgliedschaft(user):
    assert active_organization(user) is None


@pytest.mark.django_db
def test_active_organisation_is_none_when_multiple_mitgliedschaften(user, organization):
    # Multi-org is modelled, but resolving among several memberships needs the
    # deferred org-switcher; until then it resolves to nothing rather than guess.
    org_b = Organization.objects.create(handle="ORG2", name="Second Org")
    Mitgliedschaft.objects.create(user=user, organization=organization)
    Mitgliedschaft.objects.create(user=user, organization=org_b)

    assert active_organization(user) is None
