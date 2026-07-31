from django.contrib.auth import authenticate, login, logout
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import error_codes
from .errors import error_entry
from .serializers import OrganizationSerializer
from .tenancy import active_organization, active_organization_rolle

# The refusals here are hand-built ``Response`` objects, not raises, so they never
# pass an exception handler — they carry their own ``errors`` envelope (ADR 0038).
# A failed attempt and a dead session are different causes with different ways
# out: retype the credentials, or sign in again.
LOGIN_FAILED_MESSAGE = "Anmeldung fehlgeschlagen. Bitte überprüfe Benutzernamen und Passwort."
NOT_AUTHENTICATED_MESSAGE = "Not authenticated."


def _refusal(message, code, status_code):
    return Response(
        {"detail": message, "errors": [error_entry(code, message)]},
        status=status_code,
    )


def _user_payload(user):
    handle = None
    scientist = getattr(user, "scientist", None)
    if scientist is not None:
        handle = scientist.handle
    organization = active_organization(user)
    return {
        "username": user.username,
        "handle": handle,
        "is_staff": user.is_staff,
        "active_organization_rolle": active_organization_rolle(user),
        # The identity the offline PWA caches (issue #156): user, Organisation, Rolle.
        "active_organization": (
            OrganizationSerializer(organization).data if organization is not None else None
        ),
    }


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def login_view(request):
    username = request.data.get("username")
    password = request.data.get("password")
    if not username or not password:
        return _refusal(
            LOGIN_FAILED_MESSAGE, error_codes.LOGIN_FAILED, status.HTTP_401_UNAUTHORIZED
        )

    user = authenticate(request, username=username, password=password)
    if user is None:
        return _refusal(
            LOGIN_FAILED_MESSAGE, error_codes.LOGIN_FAILED, status.HTTP_401_UNAUTHORIZED
        )

    login(request, user)
    return Response(_user_payload(user))


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def logout_view(request):
    logout(request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def me_view(request):
    if not request.user.is_authenticated:
        return _refusal(
            NOT_AUTHENTICATED_MESSAGE,
            error_codes.NOT_AUTHENTICATED,
            status.HTTP_401_UNAUTHORIZED,
        )
    return Response(_user_payload(request.user))
