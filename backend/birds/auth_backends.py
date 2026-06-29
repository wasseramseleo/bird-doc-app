"""Authentication backend that resolves a login by email or username.

Per ADR 0008, email is the login identifier without a custom user model: a
public account stores ``username = email`` (lowercased), so a user may type the
email in any case. The default ``ModelBackend`` only matches an exact username;
this backend adds a case-insensitive lookup by username **or** email, leaving
legacy username login untouched.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q


class EmailOrUsernameModelBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        if username is None:
            username = kwargs.get(User.USERNAME_FIELD)
        if not username or password is None:
            return None

        identifier = username.strip()
        try:
            user = User.objects.get(Q(username__iexact=identifier) | Q(email__iexact=identifier))
        except User.DoesNotExist:
            # Run the password hasher once to keep timing similar whether or not
            # the account exists (mirrors ModelBackend's own mitigation).
            User().set_password(password)
            return None
        except User.MultipleObjectsReturned:
            # Ambiguous identifier — prefer an exact-username match.
            user = (
                User.objects.filter(username__iexact=identifier).order_by("pk").first()
                or User.objects.filter(email__iexact=identifier).order_by("pk").first()
            )

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
