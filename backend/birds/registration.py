"""Zugangscode-gated founding of an Organisation (issue #79, ADR 0005).

A newcomer founds a new Organisation only with a valid single-use Zugangscode.
:func:`register_organisation` is the one transactional door: it validates and
consumes the code and, in a single atomic transaction, creates the founder's
``User`` (inactive until email verification), the founder's Beringer
(``Scientist``), the ``Organisation`` (``plan=beta`` with the durable
``beta_cohort`` marker) and the founder's Admin ``Mitgliedschaft``. An invalid
or already-used code is rejected before anything is created, so a failed
registration leaves no trace and one code can never found two Organisations.
"""

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from .accounts import create_public_account
from .kuerzel import derive_handle
from .models import Mitgliedschaft, Organization, Scientist, Zugangscode


class RegistrationError(ValueError):
    """Base class for registration failures that leave nothing created."""


class InvalidZugangscodeError(RegistrationError):
    """Raised when the Zugangscode is unknown or has already been used."""


def _unique_organization_handle(name):
    """Return a unique ``Organization.handle`` (the PK) derived from the name."""
    base = slugify(name)[:60] or "org"
    handle = base
    suffix = 2
    while Organization.objects.filter(handle=handle).exists():
        handle = f"{base[: 60 - len(str(suffix)) - 1]}-{suffix}"
        suffix += 1
    return handle


def _unique_beringer_handle(first_name, last_name):
    """Return a unique Beringer Kürzel, deduped against the global handle space.

    ``Scientist.handle`` is globally unique; two founders with the same initials
    would otherwise collide, so a numeric suffix disambiguates (FRE → FRE2)."""
    base = derive_handle(first_name, last_name) or "X"
    handle = base
    suffix = 2
    while Scientist.objects.filter(handle=handle).exists():
        handle = f"{base[: 10 - len(str(suffix))]}{suffix}"
        suffix += 1
    return handle


def register_organisation(*, code, email, password, first_name, last_name, organisation_name):
    """Found an Organisation behind a single-use Zugangscode, atomically.

    Returns ``(user, organization)`` on success. Raises
    :class:`InvalidZugangscodeError` for an unknown or already-used code and
    :class:`birds.accounts.EmailAlreadyExistsError` for a duplicate email —
    both before anything is persisted, so nothing is created on failure.
    """
    with transaction.atomic():
        # Lock-and-check the code first: an unknown or spent code is rejected
        # before any account or Organisation is created (so failure creates
        # nothing), and the row lock serialises concurrent redemptions so a
        # single code can never found two Organisations.
        zugangscode = Zugangscode.objects.select_for_update().filter(code=code).first()
        if zugangscode is None or zugangscode.is_used:
            raise InvalidZugangscodeError(code)

        # The founder's account stays inactive until the email is verified
        # (double opt-in); the auth backend refuses inactive logins (ADR 0008).
        user = create_public_account(email, password, is_active=False)
        user.first_name = first_name
        user.last_name = last_name
        user.save(update_fields=["first_name", "last_name"])

        organization = Organization.objects.create(
            name=organisation_name,
            handle=_unique_organization_handle(organisation_name),
            plan=Organization.Plan.BETA,
            beta_cohort=True,
        )
        Mitgliedschaft.objects.create(
            user=user,
            organization=organization,
            rolle=Mitgliedschaft.Rolle.ADMIN,
        )
        Scientist.objects.create(
            user=user,
            first_name=first_name,
            last_name=last_name,
            handle=_unique_beringer_handle(first_name, last_name),
            organization=organization,
        )

        zugangscode.used_at = timezone.now()
        zugangscode.founded_organization = organization
        zugangscode.save(update_fields=["used_at", "founded_organization"])

    return user, organization
