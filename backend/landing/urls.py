from django.contrib.auth import views as auth_views
from django.urls import path, reverse_lazy

from . import views

app_name = "landing"

urlpatterns = [
    path("", views.HomeView.as_view(), name="home"),
    # Built-in password reset, server-rendered as Landing-app templates and
    # reachable unauthenticated at the apex (issue #77). Names live under the
    # `landing:` namespace, so the views and the email template reverse the
    # namespaced names explicitly rather than Django's bare defaults.
    path(
        "passwort-zuruecksetzen/",
        auth_views.PasswordResetView.as_view(
            template_name="landing/password_reset_form.html",
            email_template_name="landing/password_reset_email.txt",
            subject_template_name="landing/password_reset_subject.txt",
            success_url=reverse_lazy("landing:password_reset_done"),
        ),
        name="password_reset",
    ),
    path(
        "passwort-zuruecksetzen/gesendet/",
        auth_views.PasswordResetDoneView.as_view(
            template_name="landing/password_reset_done.html",
        ),
        name="password_reset_done",
    ),
    path(
        "passwort-zuruecksetzen/<uidb64>/<token>/",
        auth_views.PasswordResetConfirmView.as_view(
            template_name="landing/password_reset_confirm.html",
            success_url=reverse_lazy("landing:password_reset_complete"),
        ),
        name="password_reset_confirm",
    ),
    path(
        "passwort-zuruecksetzen/abgeschlossen/",
        auth_views.PasswordResetCompleteView.as_view(
            template_name="landing/password_reset_complete.html",
        ),
        name="password_reset_complete",
    ),
]
