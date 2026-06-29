from django.urls import path

from . import views

app_name = "landing"

urlpatterns = [
    path("", views.HomeView.as_view(), name="home"),
    # Public legal & trust surface, server-rendered on the shared landing base
    # (issue #78). German slugs mirror `passwort-zuruecksetzen/`. The texts are
    # review-ready drafts, gated on human/lawyer review before go-live.
    path("impressum/", views.ImpressumView.as_view(), name="impressum"),
    path("datenschutz/", views.DatenschutzView.as_view(), name="datenschutz"),
    path("agb/", views.AGBView.as_view(), name="agb"),
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
