"""
Django settings for birddoc project.

Configuration is read from environment variables (see .env.example).
A local .env file at backend/.env is loaded automatically when present.
"""

from pathlib import Path

import environ

from birddoc.conf import resolve_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
)
environ.Env.read_env(BASE_DIR / ".env")

DEBUG = env("DJANGO_DEBUG")

# In production (DJANGO_DEBUG=False) a real, env-driven SECRET_KEY is mandatory
# and the insecure development default is rejected — see birddoc/conf.py.
SECRET_KEY = resolve_secret_key(env, debug=DEBUG)

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "corsheaders",
    "django.contrib.staticfiles",
    "rest_framework",
    "birds",
    "landing",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "birddoc.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "birddoc.wsgi.application"

DATABASES = {
    "default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
# Anchor the capture-time round trip to Vienna: naive wall-clock input is
# interpreted as Europe/Vienna and server-side renderers emit Vienna localtime
# (issue #60). zoneinfo handles DST, so summer/winter offsets stay correct.
TIME_ZONE = "Europe/Vienna"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ModelBackend first preserves exact legacy username login; the email/username
# backend adds case-insensitive email resolution (ADR 0008).
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "birds.auth_backends.EmailOrUsernameModelBackend",
]

REST_FRAMEWORK = {
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 10,
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "{asctime} {levelname} {module}: {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "loggers": {
        "": {
            "level": "DEBUG" if DEBUG else "INFO",
            "handlers": ["console"],
            "propagate": True,
        },
        "django": {
            "level": "INFO" if DEBUG else "WARNING",
            "handlers": ["console"],
            "propagate": True,
        },
    },
}

CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:4200"],
)
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = env.list(
    "CSRF_TRUSTED_ORIGINS",
    default=["http://localhost:4200"],
)

SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# Scope the session cookie to the app subdomain so the Angular SPA and Django
# /admin (both served from app.birddoc.at) share one session. Unset in dev so
# the cookie stays host-only and works on localhost.
SESSION_COOKIE_DOMAIN = env("DJANGO_SESSION_COOKIE_DOMAIN", default=None)

# Trust the X-Forwarded-Proto header set by Caddy/nginx in front of the app
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Email: console in dev (verification/reset mails print to the log); production
# points DJANGO_EMAIL_BACKEND at the SMTP backend and supplies the Brevo (EU)
# SMTP credentials below. Every transactional mail leaves from noreply@birddoc.at
# (issue #77).
EMAIL_BACKEND = env(
    "DJANGO_EMAIL_BACKEND",
    default="django.core.mail.backends.console.EmailBackend",
)
DEFAULT_FROM_EMAIL = env("DJANGO_DEFAULT_FROM_EMAIL", default="noreply@birddoc.at")
SERVER_EMAIL = DEFAULT_FROM_EMAIL

# The operator's inbox — distinct from DEFAULT_FROM_EMAIL (the no-reply sender).
# Receives in-app feedback ("Feedback / Fehler melden", issue #81) and public
# Warteliste access-request notifications ("Zugang anfragen", issue #80), so the
# operator learns of demand for Zugangscodes without polling the admin.
OPERATOR_EMAIL = env("DJANGO_OPERATOR_EMAIL", default="operator@birddoc.at")

# SMTP transport (Brevo EU relay). Only consulted when DJANGO_EMAIL_BACKEND points
# at the SMTP backend; the dev console backend ignores these. Credentials come
# from the environment — never commit the Brevo SMTP key.
EMAIL_HOST = env("DJANGO_EMAIL_HOST", default="smtp-relay.brevo.com")
EMAIL_PORT = env.int("DJANGO_EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("DJANGO_EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("DJANGO_EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("DJANGO_EMAIL_USE_TLS", default=True)

# Where the public Landing app points a newly-registered founder to sign in:
# the Angular SPA login. The Landing app (apex, birddoc.at) and the SPA
# (app.birddoc.at) are separate hosts, so this is an absolute URL. Dev defaults
# to the local SPA; prod sets DJANGO_APP_LOGIN_URL to https://app.birddoc.at/login.
APP_LOGIN_URL = env("DJANGO_APP_LOGIN_URL", default="http://localhost:4200/login")
