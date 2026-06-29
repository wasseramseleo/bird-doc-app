from django.conf import settings
from django.contrib.auth import views as auth_views
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.urls import reverse, reverse_lazy
from django.utils import translation
from django.views.generic import TemplateView
from django.views.generic.edit import FormView

from .forms import WartelisteForm


class HomeView(TemplateView):
    """The public apex landing page — a plain, server-rendered page served to
    unauthenticated visitors without loading the SPA (issue #71)."""

    template_name = "landing/home.html"


class WartelisteView(FormView):
    """The public Warteliste — "Zugang anfragen" on the landing page (issue #80).

    A server-rendered, unauthenticated form that stores a lead and emails the
    operator so they learn of demand without polling, then sends the visitor to
    a confirmation page. It grants nothing by itself — the operator reviews the
    lead in the Django admin and issues a Zugangscode there."""

    template_name = "landing/warteliste_form.html"
    form_class = WartelisteForm
    success_url = reverse_lazy("landing:warteliste_done")

    def form_valid(self, form):
        lead = form.save()
        self._notify_operator(lead)
        return super().form_valid(form)

    def _notify_operator(self, lead):
        """Email the operator that a Zugang was requested, with enough context
        to act on it (and a link to the lead in the admin)."""
        body = render_to_string(
            "landing/warteliste_operator_email.txt",
            {
                "lead": lead,
                "protocol": "https" if self.request.is_secure() else "http",
                "domain": self.request.get_host(),
                "admin_url": reverse("admin:landing_warteliste_change", args=[lead.pk]),
            },
        )
        send_mail(
            subject="BirdDoc — neue Zugang-Anfrage (Warteliste)",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[settings.OPERATOR_EMAIL],
        )


class WartelisteDoneView(TemplateView):
    """Confirms the access request was received (issue #80)."""

    template_name = "landing/warteliste_done.html"


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
