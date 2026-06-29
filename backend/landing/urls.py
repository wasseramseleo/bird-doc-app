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
