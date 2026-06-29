from django.contrib.auth import views as auth_views
from django.urls import reverse_lazy
from django.utils import translation
from django.views.generic import TemplateView


class HomeView(TemplateView):
    """The public apex landing page — a plain, server-rendered page served to
    unauthenticated visitors without loading the SPA (issue #71)."""

    template_name = "landing/home.html"


class GermanAuthFormMixin:
    """Render Django's built-in auth forms in German on the public landing.

    The password-reset form labels, password-validator help texts and error
    messages are Django's own translatable strings. The public landing is
    German-only, so these views render under the ``de`` catalog without flipping
    the project-wide ``LANGUAGE_CODE`` (which would also translate the DRF API
    and the Django admin). A ``TemplateResponse`` renders lazily — after this
    view returns — so it is rendered eagerly here, while ``de`` is still active,
    before the language context unwinds (issue #77)."""

    def render_to_response(self, context, **response_kwargs):
        with translation.override("de"):
            return super().render_to_response(context, **response_kwargs).render()


class PasswordResetView(GermanAuthFormMixin, auth_views.PasswordResetView):
    template_name = "landing/password_reset_form.html"
    email_template_name = "landing/password_reset_email.txt"
    subject_template_name = "landing/password_reset_subject.txt"
    success_url = reverse_lazy("landing:password_reset_done")


class PasswordResetDoneView(GermanAuthFormMixin, auth_views.PasswordResetDoneView):
    template_name = "landing/password_reset_done.html"


class PasswordResetConfirmView(GermanAuthFormMixin, auth_views.PasswordResetConfirmView):
    template_name = "landing/password_reset_confirm.html"
    success_url = reverse_lazy("landing:password_reset_complete")


class PasswordResetCompleteView(GermanAuthFormMixin, auth_views.PasswordResetCompleteView):
    template_name = "landing/password_reset_complete.html"
