from django.urls import path

from . import views

app_name = "landing"

urlpatterns = [
    path("", views.HomeView.as_view(), name="home"),
    # Zugangscode-gated public registration: found an Organisation + email
    # verification, reachable unauthenticated at the apex (issue #79).
    path("registrierung/", views.RegisterView.as_view(), name="register"),
    path("registrierung/gesendet/", views.RegisterDoneView.as_view(), name="register_done"),
    path(
        "registrierung/bestaetigen/<uidb64>/<token>/",
        views.RegisterVerifyView.as_view(),
        name="register_verify",
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
