"""Configuration helpers that enforce production-safe settings.

Kept separate from ``settings.py`` so the fail-loud policy can be unit-tested
without reloading Django's settings module.
"""

from django.core.exceptions import ImproperlyConfigured

#: The development-only key shipped in ``.env.example``. Never valid in prod.
INSECURE_SECRET_KEY = "django-insecure-dev-only-do-not-use-in-production"


def resolve_secret_key(env, *, debug):
    """Resolve ``DJANGO_SECRET_KEY``, refusing an insecure key in production.

    In development (``debug=True``) the insecure default is allowed so local
    setup stays zero-config. In production (``debug=False``) a real
    ``DJANGO_SECRET_KEY`` is mandatory: a missing or empty key raises
    ``ImproperlyConfigured`` so the app fails to start rather than booting with
    a known-insecure secret.
    """
    if debug:
        return env("DJANGO_SECRET_KEY", default=INSECURE_SECRET_KEY)
    key = env("DJANGO_SECRET_KEY", default="")
    if not key or key.startswith("django-insecure-"):
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY must be set to a real, non-default secret when "
            "DJANGO_DEBUG=False; the insecure development default is not allowed."
        )
    return key
