from django.urls import path

from . import views

app_name = "landing"

urlpatterns = [
    path("", views.HomeView.as_view(), name="home"),
    # Public Warteliste — "Zugang anfragen" collects demand for Zugangscodes
    # but grants nothing by itself; the operator reviews leads in the admin
    # (issue #80).
    path("zugang-anfragen/", views.WartelisteView.as_view(), name="warteliste"),
    path(
        "zugang-anfragen/gesendet/",
        views.WartelisteDoneView.as_view(),
        name="warteliste_done",
    ),
    # Public Gespräch funnel — a central body requests a conversation instead of
    # self-serving the Warteliste; it writes an `organisation` lead to the same
    # model (issue #103).
    path("gespraech/", views.GespraechView.as_view(), name="gespraech"),
    path(
        "gespraech/gesendet/",
        views.GespraechDoneView.as_view(),
        name="gespraech_done",
    ),
    # Public bottom-funnel comparison — the citable BirdDoc-vs-Excel/Papierlisten
    # page (issue #302). Bilingual like the home: German at the apex, English
    # under /en/ (this urlconf is wrapped by i18n_patterns in birddoc/urls.py).
    path("vergleich/", views.VergleichView.as_view(), name="vergleich"),
    # Public bottom-funnel feature overview — the citable „was eine
    # Beringungssoftware können muss" page (issue #303). Bilingual like the home:
    # German at the apex, English under /en/ (this urlconf is wrapped by
    # i18n_patterns in birddoc/urls.py).
    path("funktionen/", views.FunktionenView.as_view(), name="funktionen"),
    # Zugangscode-gated public registration: found an Organisation + email
    # verification, reachable unauthenticated at the apex (issue #79).
    path("registrierung/", views.RegisterView.as_view(), name="register"),
    path("registrierung/gesendet/", views.RegisterDoneView.as_view(), name="register_done"),
    path(
        "registrierung/bestaetigen/<uidb64>/<token>/",
        views.RegisterVerifyView.as_view(),
        name="register_verify",
    ),
    # Public legal & trust surface, server-rendered on the shared landing base
    # (issue #78). German slugs mirror `passwort-zuruecksetzen/`. The texts are
    # review-ready drafts, gated on human/lawyer review before go-live.
    path("impressum/", views.ImpressumView.as_view(), name="impressum"),
    path("datenschutz/", views.DatenschutzView.as_view(), name="datenschutz"),
    path("agb/", views.AGBView.as_view(), name="agb"),
    # Public Org-Einladung accept flow (issue #83): the token in the path is the
    # accept-link secret, mailed only to the invitee. Server-rendered, reachable
    # unauthenticated at the apex like the password-reset flow.
    path(
        "einladung/<token>/",
        views.OrgEinladungAcceptView.as_view(),
        name="invitation_accept",
    ),
    # Built-in password reset, server-rendered as Landing-app templates and
    # reachable unauthenticated at the apex (issue #77). Names live under the
    # `landing:` namespace, so the views and the email template reverse the
    # namespaced names explicitly rather than Django's bare defaults.
    path(
        "passwort-zuruecksetzen/",
        views.PasswordResetView.as_view(),
        name="password_reset",
    ),
    path(
        "passwort-zuruecksetzen/gesendet/",
        views.PasswordResetDoneView.as_view(),
        name="password_reset_done",
    ),
    path(
        "passwort-zuruecksetzen/<uidb64>/<token>/",
        views.PasswordResetConfirmView.as_view(),
        name="password_reset_confirm",
    ),
    path(
        "passwort-zuruecksetzen/abgeschlossen/",
        views.PasswordResetCompleteView.as_view(),
        name="password_reset_complete",
    ),
]
