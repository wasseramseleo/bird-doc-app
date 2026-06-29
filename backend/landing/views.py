from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth import views as auth_views
from django.contrib.auth.tokens import default_token_generator
from django.contrib.sites.shortcuts import get_current_site
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.urls import reverse, reverse_lazy
from django.utils import translation
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.generic import FormView, TemplateView

from birds.accounts import EmailAlreadyExistsError
from birds.registration import InvalidZugangscodeError, register_organisation

from .forms import RegistrationForm, WartelisteForm


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


class ImpressumView(TemplateView):
    """The operator's Impressum — a server-rendered legal page (issue #78).

    The text is a review-ready *draft*, gated on human/lawyer review before
    go-live; operator-identifying details are clearly-marked placeholders."""

    template_name = "landing/impressum.html"


class DatenschutzView(TemplateView):
    """The Datenschutzerklärung — what data is processed and by which
    sub-processors (IPAX hosting, Brevo email) (issue #78). A review-ready
    draft, gated on human/lawyer review before go-live."""

    template_name = "landing/datenschutz.html"


class AGBView(TemplateView):
    """The AGB including a DPA (Auftragsverarbeitung) addendum — the Organisation
    is controller, BirdDoc is processor (issue #78). A review-ready draft, gated
    on human/lawyer review before go-live."""

    template_name = "landing/agb.html"


class GermanAuthFormMixin:
    """Render server-rendered public-landing forms in German.

    Field labels, password-validator help texts and the built-in "this field is
    required"/reset error messages are Django's own translatable strings. The
    public landing is German-only, so these views render under the ``de`` catalog
    without flipping the project-wide ``LANGUAGE_CODE`` (which would also
    translate the DRF API and the Django admin). A ``TemplateResponse`` renders
    lazily — after this view returns — so it is rendered eagerly here, while
    ``de`` is still active, before the language context unwinds (issue #77)."""

    def render_to_response(self, context, **response_kwargs):
        with translation.override("de"):
            return super().render_to_response(context, **response_kwargs).render()


class RegisterView(GermanAuthFormMixin, FormView):
    """Public, unauthenticated Zugangscode-gated registration (issue #79).

    A valid code founds an Organisation in one transaction (the founder becomes
    its Admin) and sends an email-verification mail (double opt-in); the visitor
    is then sent to a "check your mail" page that points at the app login. An
    invalid or already-used code — or a duplicate email — is rejected with a
    clear, field-level message and creates nothing.
    """

    template_name = "landing/register.html"
    form_class = RegistrationForm
    success_url = reverse_lazy("landing:register_done")

    def form_valid(self, form):
        data = form.cleaned_data
        try:
            user, _organization = register_organisation(
                code=data["code"],
                email=data["email"],
                password=data["password1"],
                first_name=data["first_name"],
                last_name=data["last_name"],
                organisation_name=data["organisation_name"],
            )
        except InvalidZugangscodeError:
            form.add_error(
                "code",
                translation.gettext(
                    "Dieser Zugangscode ist ungültig oder wurde bereits verwendet."
                ),
            )
            return self.form_invalid(form)
        except EmailAlreadyExistsError:
            form.add_error(
                "email",
                translation.gettext("Für diese E-Mail-Adresse gibt es bereits ein Konto."),
            )
            return self.form_invalid(form)

        self._send_verification_email(user)
        return super().form_valid(form)

    def _send_verification_email(self, user):
        """Email the founder a one-time link confirming their address."""
        site = get_current_site(self.request)
        context = {
            "protocol": "https" if self.request.is_secure() else "http",
            "domain": site.domain,
            "uid": urlsafe_base64_encode(force_bytes(user.pk)),
            "token": default_token_generator.make_token(user),
        }
        subject = render_to_string("landing/registration_verify_subject.txt", context).strip()
        body = render_to_string("landing/registration_verify_email.txt", context)
        with translation.override("de"):
            user.email_user(subject, body)


class RegisterDoneView(TemplateView):
    """Shown right after registering: confirm your mail, then sign in."""

    template_name = "landing/register_done.html"

    def get_context_data(self, **kwargs):
        return {**super().get_context_data(**kwargs), "app_login_url": settings.APP_LOGIN_URL}


class RegisterVerifyView(TemplateView):
    """Confirm the founder's email from the one-time link, activating the account.

    Strict double opt-in: the account is created inactive and cannot log in
    until this link flips ``is_active`` (the auth backend refuses inactive
    logins). A bad or expired link renders an explanatory page and changes
    nothing.
    """

    template_name = "landing/register_verify_done.html"

    def _get_user(self, uidb64):
        User = get_user_model()
        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            return User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return None

    def get(self, request, *args, **kwargs):
        user = self._get_user(kwargs["uidb64"])
        if user is None or not default_token_generator.check_token(user, kwargs["token"]):
            return self.render_to_response(
                {"valid": False, "app_login_url": settings.APP_LOGIN_URL}
            )
        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active"])
        return self.render_to_response({"valid": True, "app_login_url": settings.APP_LOGIN_URL})


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
