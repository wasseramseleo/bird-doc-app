from django.contrib.auth import authenticate, login, logout
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import Mitgliedschaft
from .serializers import OrganizationSerializer
from .tenancy import active_organization


def _active_organization_rolle(user, organization):
    """The actor's Rolle in ``organization`` (their active Organisation), or ``None``.

    Mirrors the tenancy spine (ADR 0005): the active Organisation is the org of
    the account's single Mitgliedschaft, so the Rolle is that membership's Rolle.
    With no unambiguous active Organisation (zero memberships, or several awaiting
    the org-switcher) there is no Rolle to report and this returns ``None``.
    """
    if organization is None:
        return None
    membership = Mitgliedschaft.objects.filter(user=user, organization=organization).first()
    return membership.rolle if membership is not None else None


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
        "active_organization_rolle": _active_organization_rolle(user, organization),
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
        return Response(
            {"detail": "Anmeldung fehlgeschlagen. Bitte überprüfe Benutzernamen und Passwort."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user = authenticate(request, username=username, password=password)
    if user is None:
        return Response(
            {"detail": "Anmeldung fehlgeschlagen. Bitte überprüfe Benutzernamen und Passwort."},
            status=status.HTTP_401_UNAUTHORIZED,
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
        return Response(
            {"detail": "Not authenticated."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    return Response(_user_payload(request.user))
