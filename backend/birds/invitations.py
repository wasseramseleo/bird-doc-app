"""Org-Einladung domain logic: Seat-Limit accounting and acceptance (issue #83).

Kept separate from the HTTP layer so both surfaces share one source of truth: the
DRF invite API (``birds.views``) and the public, server-rendered accept view
(``landing.views``). Per ADR 0005 each Mitgliedschaft consumes one Mitgliedsplatz
and so does each *pending* Einladung (it reserves the seat it will fill);
no-account Beringer consume none.
"""

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone

from .accounts import create_public_account
from .models import Mitgliedschaft, OrgEinladung


def seats_used(organization):
    """Mitgliedsplätze consumed in ``organization``.

    A seat is consumed by every Mitgliedschaft (including the Admin's own) and by
    every *pending* Einladung — a pending invite reserves the seat it will fill,
    so ten invites cannot all accept against one free seat. No-account Beringer
    are mere selectable names, not actors, and consume none.
    """
    memberships = Mitgliedschaft.objects.filter(organization=organization).count()
    pending = OrgEinladung.objects.filter(
        organization=organization, accepted_at__isnull=True
    ).count()
    return memberships + pending


def seats_available(organization):
    """Free Mitgliedsplätze left under the Organisation's Seat-Limit (never < 0)."""
    return max(organization.seat_limit - seats_used(organization), 0)


def account_for_email(email):
    """The existing account whose login identifier is ``email``, or ``None``.

    Public accounts store their email as both ``username`` and ``email`` (ADR
    0008); matching is case-insensitive on either, mirroring
    ``accounts.create_public_account``'s uniqueness check.
    """
    User = get_user_model()
    return User.objects.filter(Q(username__iexact=email) | Q(email__iexact=email)).first()


def accept_invitation(invitation, *, password=None):
    """Accept ``invitation``: create the account (if new) + the Mitgliedschaft.

    Reuses the registration pattern (ADR 0008): a brand-new invitee gets a public
    account from ``password``; an invitee who already has an account simply gains
    the Mitgliedschaft (no password needed — they keep their own credentials). The
    membership create is idempotent, so re-accepting is harmless, and the invite is
    stamped ``accepted_at`` so it stops reserving its seat. Returns
    ``(user, account_created)``.
    """
    existing = account_for_email(invitation.email)
    if existing is None:
        user = create_public_account(invitation.email, password)
        account_created = True
    else:
        user = existing
        account_created = False

    Mitgliedschaft.objects.get_or_create(
        user=user,
        organization=invitation.organization,
        defaults={"rolle": invitation.rolle},
    )

    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=["accepted_at", "updated"])
    return user, account_created
