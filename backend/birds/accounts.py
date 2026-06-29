"""Public-account creation with email as the login identifier.

Per ADR 0008 we use email as the credential **without** a custom user model:
a public account stores its (normalised) email as both ``username`` and
``email`` on the stock Django ``User``. Uniqueness rides on the existing
``User.username`` unique constraint — see :func:`create_public_account`.
"""

from django.contrib.auth import get_user_model
from django.db.models import Q


class EmailAlreadyExistsError(ValueError):
    """Raised when a public account already exists for the given email."""


def normalize_email(email):
    """Return the canonical, comparable form of an email: stripped + lowercased."""
    return email.strip().lower()


def create_public_account(email, password):
    """Create a public account whose login identifier is its email.

    The email is normalised (lowercased) and stored as both ``username`` and
    ``email`` so ``username = email`` stays collision-free. Uniqueness rides on
    the existing ``User.username`` unique constraint; we pre-check
    case-insensitively to raise a clean :class:`EmailAlreadyExistsError` instead
    of a low-level ``IntegrityError``.
    """
    email = normalize_email(email)
    User = get_user_model()
    if User.objects.filter(Q(username__iexact=email) | Q(email__iexact=email)).exists():
        raise EmailAlreadyExistsError(email)
    return User.objects.create_user(username=email, email=email, password=password)
