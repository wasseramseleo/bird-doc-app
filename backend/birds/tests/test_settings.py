"""Production-hardening behaviour for birddoc settings (issue #73)."""

import importlib

import environ
import pytest
from django.core.exceptions import ImproperlyConfigured

import birddoc.settings as settings_module
from birddoc.conf import INSECURE_SECRET_KEY, resolve_secret_key


class _DictEnv(environ.Env):
    """A django-environ Env that reads from an explicit dict, not os.environ.

    Keeps the secret-key tests independent of the ambient process environment
    (and of any local backend/.env).
    """

    def __init__(self, values):
        super().__init__()
        self.ENVIRON = values


def _env(**values):
    return _DictEnv(values)


def test_production_rejects_missing_secret_key():
    with pytest.raises(ImproperlyConfigured):
        resolve_secret_key(_env(), debug=False)


def test_production_rejects_the_insecure_default_key():
    with pytest.raises(ImproperlyConfigured):
        resolve_secret_key(_env(DJANGO_SECRET_KEY=INSECURE_SECRET_KEY), debug=False)


def test_production_rejects_any_django_insecure_prefixed_key():
    with pytest.raises(ImproperlyConfigured):
        resolve_secret_key(
            _env(DJANGO_SECRET_KEY="django-insecure-freshly-generated-by-startproject"),
            debug=False,
        )


def test_production_accepts_a_real_secret_key():
    real = "k7$z9-real-production-secret-not-the-default-aBc123XyZ"
    assert resolve_secret_key(_env(DJANGO_SECRET_KEY=real), debug=False) == real


def test_development_falls_back_to_the_insecure_default():
    # Dev stays zero-config: a missing key is fine and yields the insecure default.
    assert resolve_secret_key(_env(), debug=True) == INSECURE_SECRET_KEY


# --- Full settings module, reloaded under a controlled environment ------------

# Every env var the hardened settings read, cleared before each reload so a
# local backend/.env or the test key can't leak into a case meant to omit it.
_SETTINGS_ENV_KEYS = (
    "DJANGO_SECRET_KEY",
    "DJANGO_DEBUG",
    "DJANGO_ALLOWED_HOSTS",
    "CORS_ALLOWED_ORIGINS",
    "CSRF_TRUSTED_ORIGINS",
    "DJANGO_SESSION_COOKIE_DOMAIN",
    "DJANGO_EMAIL_BACKEND",
    "DJANGO_DEFAULT_FROM_EMAIL",
    "DJANGO_EMAIL_HOST",
    "DJANGO_EMAIL_PORT",
    "DJANGO_EMAIL_HOST_USER",
    "DJANGO_EMAIL_HOST_PASSWORD",
    "DJANGO_EMAIL_USE_TLS",
)

# A production-like deployment of the app subdomain + apex (ADR 0007).
_PROD_ENV = {
    "DJANGO_DEBUG": "false",
    "DJANGO_SECRET_KEY": "a-real-production-secret-aBc123-not-the-insecure-default",
    "DJANGO_ALLOWED_HOSTS": "app.birddoc.eu,birddoc.eu",
    "CORS_ALLOWED_ORIGINS": "https://app.birddoc.eu,https://birddoc.eu",
    "CSRF_TRUSTED_ORIGINS": "https://app.birddoc.eu,https://birddoc.eu",
    "DJANGO_SESSION_COOKIE_DOMAIN": "app.birddoc.eu",
}


@pytest.fixture
def reload_settings(monkeypatch):
    """Reload birddoc.settings under an explicit env, ignoring any local .env.

    Mutating ``birddoc.settings`` is safe: pytest-django's live config comes from
    ``birddoc.settings_test``, whose names were copied at import, so reloading the
    underlying module here does not disturb the running test session. The module
    is restored to the ambient environment on teardown regardless.
    """

    def _reload(**env):
        monkeypatch.setattr(environ.Env, "read_env", staticmethod(lambda *a, **k: None))
        for key in _SETTINGS_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return importlib.reload(settings_module)

    try:
        yield _reload
    finally:
        monkeypatch.undo()
        importlib.reload(settings_module)


def test_production_settings_boot_with_a_real_key(reload_settings):
    settings = reload_settings(**_PROD_ENV)
    assert settings.DEBUG is False
    assert settings.SECRET_KEY == _PROD_ENV["DJANGO_SECRET_KEY"]


def test_production_settings_reject_a_missing_secret_key(reload_settings):
    env = {k: v for k, v in _PROD_ENV.items() if k != "DJANGO_SECRET_KEY"}
    with pytest.raises(ImproperlyConfigured):
        reload_settings(**env)


def test_production_hosts_cover_app_and_apex(reload_settings):
    settings = reload_settings(**_PROD_ENV)
    for host in ("app.birddoc.eu", "birddoc.eu"):
        assert host in settings.ALLOWED_HOSTS
    for origin in ("https://app.birddoc.eu", "https://birddoc.eu"):
        assert origin in settings.CORS_ALLOWED_ORIGINS
        assert origin in settings.CSRF_TRUSTED_ORIGINS


def test_production_shares_session_across_the_app_subdomain(reload_settings):
    settings = reload_settings(**_PROD_ENV)
    # SPA and /admin both live on app.birddoc.eu and share one session cookie.
    assert settings.SESSION_COOKIE_DOMAIN == "app.birddoc.eu"
    assert settings.SESSION_COOKIE_SECURE is True
    assert settings.CSRF_COOKIE_SECURE is True


def test_development_defaults_remain_working(reload_settings):
    settings = reload_settings(DJANGO_DEBUG="true")
    assert settings.DEBUG is True
    assert settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend"
    assert settings.CORS_ALLOWED_ORIGINS == ["http://localhost:4200"]
    assert settings.SESSION_COOKIE_DOMAIN is None
    assert settings.SESSION_COOKIE_SECURE is False


# --- Transactional email (issue #77) -----------------------------------------


def test_transactional_mail_leaves_from_the_birddoc_sender(reload_settings):
    # Every transactional mail (reset, later verification/invites) is from
    # noreply@birddoc.eu unless the environment overrides it.
    settings = reload_settings(DJANGO_DEBUG="true")
    assert settings.DEFAULT_FROM_EMAIL == "noreply@birddoc.eu"
    assert settings.SERVER_EMAIL == "noreply@birddoc.eu"


def test_production_email_uses_env_driven_smtp(reload_settings):
    # In prod the backend points at SMTP and the Brevo (EU) relay credentials
    # are read entirely from the environment — nothing secret is hard-coded.
    settings = reload_settings(
        **_PROD_ENV,
        DJANGO_EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
        DJANGO_EMAIL_HOST="smtp-relay.brevo.com",
        DJANGO_EMAIL_PORT="587",
        DJANGO_EMAIL_HOST_USER="brevo-smtp-user",
        DJANGO_EMAIL_HOST_PASSWORD="brevo-smtp-key",
        DJANGO_EMAIL_USE_TLS="true",
    )
    assert settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend"
    assert settings.EMAIL_HOST == "smtp-relay.brevo.com"
    assert settings.EMAIL_PORT == 587
    assert settings.EMAIL_HOST_USER == "brevo-smtp-user"
    assert settings.EMAIL_HOST_PASSWORD == "brevo-smtp-key"
    assert settings.EMAIL_USE_TLS is True
