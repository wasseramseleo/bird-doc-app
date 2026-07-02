"""Active-Organisation resolution (the tenancy spine — ADR 0005).

The Organisation is the tenant. Every request is scoped to the requesting
account's *active* Organisation. The org-switcher UI is deferred, so the active
Organisation is implicit: while an account holds exactly one Mitgliedschaft, that
is its active Organisation. With zero memberships (no tenant yet) or several
(awaiting the switcher), there is no unambiguous active Organisation and this
returns ``None`` rather than guess — callers treat that as "no tenant" (an empty
scope, never another tenant's data).
"""

from .models import Mitgliedschaft


def active_organization(user):
    """Return the account's active Organisation, or ``None``.

    Resolves to the Organisation of the account's single Mitgliedschaft. Returns
    ``None`` when the account has no membership or more than one (the latter
    awaits the deferred org-switcher).
    """
    if not getattr(user, "is_authenticated", False):
        return None
    memberships = list(Mitgliedschaft.objects.filter(user=user)[:2])
    if len(memberships) == 1:
        return memberships[0].organization
    return None


def active_organization_rolle(user):
    """Return the account's Rolle in its active Organisation, or ``None``.

    Mirrors ``active_organization`` itself: with no unambiguous active
    Organisation (zero memberships, or several awaiting the org-switcher) there
    is no Rolle to report. Shared by the ``/auth/me/`` identity payload and the
    offline reference bundle (issue #157), which both surface the requester's
    cached Rolle.
    """
    organization = active_organization(user)
    if organization is None:
        return None
    membership = Mitgliedschaft.objects.filter(user=user, organization=organization).first()
    return membership.rolle if membership is not None else None
