"""Session authentication whose CSRF refusal names itself (ADR 0037, ADR 0038).

A Rechteverweigerung and a CSRF-Ablehnung are the same HTTP 403 with opposite
ways out: the first needs another person to grant something, the second needs
nothing but pressing again. DRF renders both as ``permission_denied``, so a
client that reads only the status (or only the generic code) sends a Mitglied to
find an Admin over a stale token.

The refusal is born inside ``SessionAuthentication.enforce_csrf``, not at a raise
of ours, so it is annotated **there** — at the one place it can come from — and
not recognised afterwards by the ``CSRF Failed:`` prefix of its sentence. Matching
prose to infer a cause is exactly the coupling ADR 0038 exists to remove; that
the sentence in question is DRF's rather than ours does not make it stabler.

The body is untouched: the same English DRF sentence under the same ``detail``
key, with only the ``errors`` entry's code changed (ADR 0033 byte identity).
"""

from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied

from . import error_codes


class CodedSessionAuthentication(SessionAuthentication):
    """DRF's session authentication, with ``csrf_failed`` on its CSRF refusal."""

    def enforce_csrf(self, request):
        try:
            super().enforce_csrf(request)
        except PermissionDenied as exc:
            # ``str()`` sheds the ``ErrorDetail``'s own ``permission_denied``,
            # which would otherwise win over the code passed here.
            raise PermissionDenied(str(exc.detail), code=error_codes.CSRF_FAILED) from exc
