"""Rolle-based authorization (ADR 0005, issue #76).

The Organisation is the tenant and a Mitgliedschaft carries a Rolle there. This
module turns that Rolle into DRF permissions: structural management (Projekte,
Stationen, the Organisation, the IWM export) is **Admin**-only, while reading and
capture CRUD stay open to any Mitglied. A refused Mitglied gets a clear,
friendly message rather than a bare 403.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import Mitgliedschaft, Organization
from .tenancy import active_organization

# Shown to a Mitglied who attempts an Admin-only action. DRF surfaces it as the
# 403 body's ``detail``, so the refusal is never a bare, message-less 403.
ADMIN_ONLY_MESSAGE = (
    "Diese Aktion ist Administrator:innen der Organisation vorbehalten. "
    "Bitte wende dich an eine Administratorin oder einen Administrator."
)

# Shown when an Admin tries to manage a record that belongs to a *different*
# Organisation than their own — structural management never crosses the tenant
# boundary.
OTHER_ORG_MESSAGE = "Du kannst nur Objekte deiner eigenen Organisation verwalten."


def is_org_admin(user):
    """True when ``user`` is an **Admin** of their active Organisation.

    Resolves the active Organisation the same way the capture endpoint does
    (``tenancy.active_organization`` — the org of the account's single
    Mitgliedschaft) and checks that membership's Rolle is Admin. Any account
    without a resolvable active Organisation (anonymous, no membership, or
    several awaiting the org-switcher) is not an Admin.
    """
    organization = active_organization(user)
    if organization is None:
        return False
    return Mitgliedschaft.objects.filter(
        user=user,
        organization=organization,
        rolle=Mitgliedschaft.Rolle.ADMIN,
    ).exists()


def _object_organization(obj):
    """The Organisation that owns ``obj`` (the object itself when it is one)."""
    if isinstance(obj, Organization):
        return obj
    return getattr(obj, "organization", None)


class IsOrgAdminOrReadOnly(BasePermission):
    """Read for any authenticated Mitglied; write only for an Organisation Admin.

    Safe methods pass (list/retrieve stay open within the tenant); an unsafe
    method requires the requester to be an Admin of their active Organisation and
    — at the object level — for the target to belong to that same Organisation,
    so an Admin of one tenant can never mutate another tenant's structure.
    """

    message = ADMIN_ONLY_MESSAGE

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return is_org_admin(request.user)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if not is_org_admin(request.user):
            return False
        return _object_organization(obj) == active_organization(request.user)


class IsOrgAdmin(BasePermission):
    """Admin-only for every method — used to gate read-style management actions
    (e.g. the IWM export, a GET that is nonetheless a privileged operation)."""

    message = ADMIN_ONLY_MESSAGE

    def has_permission(self, request, view):
        return is_org_admin(request.user)

    def has_object_permission(self, request, view, obj):
        if not is_org_admin(request.user):
            return False
        return _object_organization(obj) == active_organization(request.user)
