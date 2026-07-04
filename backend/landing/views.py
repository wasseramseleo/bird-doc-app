from django.conf import settings
from django.contrib.auth import get_user_model, password_validation
from django.contrib.auth import views as auth_views
from django.contrib.auth.tokens import default_token_generator
from django.contrib.sites.shortcuts import get_current_site
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.shortcuts import render
from django.template.loader import render_to_string
from django.urls import reverse, reverse_lazy
from django.utils import translation
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.utils.translation import gettext as _
from django.views import View
from django.views.generic import FormView, TemplateView

from birds.accounts import EmailAlreadyExistsError
from birds.invitations import accept_invitation, account_for_email
from birds.models import OrgEinladung
from birds.registration import InvalidZugangscodeError, register_organisation

from .fang_formular import FANG_FORMULAR
from .fang_karte import FANG_KARTE
from .forms import GespraechForm, RegistrationForm, WartelisteForm
from .models import Warteliste
from .seo import organization_jsonld, software_application_jsonld
from .stats import STATION_STATS


def _notify_operator_of_lead(request, lead):
    """Email the operator about a new landing lead, of either type (issue #103).

    Every lead — the individual Beringer's Warteliste entry and the central
    body's Gespräch request alike — reaches the operator without polling, with
    enough context to act on it (the organisation lead's extra context included)
    and a link to the lead in the admin. The subject names the funnel so the
    operator can triage from the inbox."""
    body = render_to_string(
        "landing/warteliste_operator_email.txt",
        {
            "lead": lead,
            "protocol": "https" if request.is_secure() else "http",
            "domain": request.get_host(),
            "admin_url": reverse("admin:landing_warteliste_change", args=[lead.pk]),
        },
    )
    subjects = {
        Warteliste.LeadType.BERINGER: "BirdDoc — neue Zugang-Anfrage (Warteliste)",
        Warteliste.LeadType.ORGANISATION: "BirdDoc — neue Gesprächs-Anfrage (Organisation)",
    }
    send_mail(
        subject=subjects[lead.lead_type],
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[settings.OPERATOR_EMAIL],
    )


class HomeView(TemplateView):
    """The public apex landing page — a plain, server-rendered page served to
    unauthenticated visitors without loading the SPA (issue #71).

    The dual-track marketing home (issue #104): a top nav whose *Anmelden* action
    links OUT to the SPA login (login stays in the SPA — ADR 0008), a shared hero
    thesis, a two-track fork band, the Für-Beringer audience section ending in the
    Warteliste CTA, and the restyled beta badge + price teaser."""

    template_name = "landing/home.html"

    def get_context_data(self, **kwargs):
        return {
            **super().get_context_data(**kwargs),
            "app_login_url": settings.APP_LOGIN_URL,
            "fang_karte": FANG_KARTE,
            "fang_formular": FANG_FORMULAR,
            # Hand-maintained production figures for the stats row (issue #140):
            # constants, never a live cross-tenant aggregate (ADR 0005, ADR 0012).
            "station_stats": STATION_STATS,
            # Absolute URL for the Open-Graph card (issue #108): social scrapers
            # need scheme + host, not a relative path. The share image is the
            # Fang-Karte rendering, served language-independently at the root.
            # (og:url and the canonical link come from the `canonical_url`
            # template tag — one request-time source, issue #279.)
            "og_image_url": self.request.build_absolute_uri(reverse("og_fang_karte")),
            # Schema.org SoftwareApplication block (issue #283), dumped in
            # Python so it is parseable by construction — a rich-result shot
            # in a niche where no competitor bothers.
            "software_application_jsonld": software_application_jsonld(self.request),
            # Schema.org Organization block (issue #301): grounds BirdDoc as an
            # entity alongside the SoftwareApplication block, dumped in Python
            # so it too is parseable by construction.
            "organization_jsonld": organization_jsonld(self.request),
        }


class WartelisteView(FormView):
    """The public Warteliste — "Zugang anfragen" on the landing page (issue #80).

    A server-rendered, unauthenticated form that stores a `beringer` lead and
    emails the operator so they learn of demand without polling, then sends the
    visitor to a confirmation page. It grants nothing by itself — the operator
    reviews the lead in the Django admin and issues a Zugangscode there."""

    template_name = "landing/warteliste_form.html"
    form_class = WartelisteForm
    success_url = reverse_lazy("landing:warteliste_done")

    def form_valid(self, form):
        lead = form.save()
        _notify_operator_of_lead(self.request, lead)
        return super().form_valid(form)


class WartelisteDoneView(TemplateView):
    """Confirms the access request was received (issue #80)."""

    template_name = "landing/warteliste_done.html"


class GespraechView(FormView):
    """The public "Gespräch vereinbaren" funnel — a central body's lead (issue #103).

    The organisation counterpart to the Warteliste: a central authority (e.g. the
    Österreichische Vogelwarte) requests a conversation rather than self-serving a
    Zugangscode. It writes an `organisation` lead to the *same* model, carrying the
    extra context, and emails the operator that context. It introduces no new
    tenancy tier (ADR 0005) — the lead is an out-of-model sales signal."""

    template_name = "landing/gespraech_form.html"
    form_class = GespraechForm
    success_url = reverse_lazy("landing:gespraech_done")

    def form_valid(self, form):
        lead = form.save()
        _notify_operator_of_lead(self.request, lead)
        return super().form_valid(form)


class GespraechDoneView(TemplateView):
    """Confirms the Gespräch request was received (issue #103)."""

    template_name = "landing/gespraech_done.html"


class VergleichView(TemplateView):
    """`/vergleich/` — the bilingual BirdDoc-vs-Excel/Papierlisten comparison
    (issue #302, PRD #300).

    A citable bottom-funnel page that lifts the homepage's Excel-comparison
    section (issue #116) into its own indexable URL, so that when a
    Stationsleiter asks an AI chat „BirdDoc oder Excel?" the answer can be
    grounded in BirdDoc's actual differences instead of a hallucinated summary.
    Part of the bilingual marketing surface (issue #107): German at the apex,
    English under ``/en/``; server-rendered and script-free (ADR 0009), with the
    self-referential canonical + hreflang cluster of the home. The meta
    description states the answer first (issue #305) — the same sentence that
    opens the page — so the search/AI snippet and the on-page lead never drift.

    Prices and the numeric Artennorm are deliberately out of scope: this page
    contrasts the *workflow* against paper and Excel, not a price list."""

    template_name = "landing/vergleich.html"


class FunktionenView(TemplateView):
    """`/funktionen/` — the bilingual feature-overview page (issue #303, PRD #300).

    A citable bottom-funnel page describing what a Beringungssoftware should do
    — offline capture, IWM export, plausibility warnings and ring-series logic —
    so that when someone asks an AI chat „Welche Funktionen sollte eine
    Beringungssoftware haben?" the answer can be grounded in BirdDoc's actual
    capabilities. Each capability is framed as a self-contained, quotable
    passage. Part of the bilingual marketing surface (issue #107): German at the
    apex, English under ``/en/``; server-rendered and script-free (ADR 0009),
    with the self-referential canonical + hreflang cluster of the home. The meta
    description states the answer first (issue #305) — the same sentence that
    opens the page — so the search/AI snippet and the on-page lead never drift.

    Prices and the numeric Artennorm are deliberately out of scope: this page
    names the *capabilities* a ringing software should have, not a price list."""

    template_name = "landing/funktionen.html"


class PreiseView(TemplateView):
    """`/preise/` — the bilingual pricing-model page (issue #304, PRD #300).

    A citable bottom-funnel page that describes the *durable pricing model* —
    licensed per Organisation not per head, no-account Beringer free, and the
    beta cohort keeps its preferential price — so that when an Organisation
    decision-maker asks an AI chat „Was kostet BirdDoc?" the answer quoted
    months later is still roughly right. The page leads with the *model*, not a
    price point: the current beta status is stated honestly, but no specific
    price number is the quotable core (a figure dates fast; the model does not).
    Part of the bilingual marketing surface (issue #107): German at the apex,
    English under ``/en/``; server-rendered and script-free (ADR 0009), with the
    self-referential canonical + hreflang cluster of the home. The meta
    description states the answer first (issue #305) — the same sentence that
    opens the page — so the search/AI snippet and the on-page lead never drift."""

    template_name = "landing/preise.html"


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


class OrgEinladungAcceptView(View):
    """Accept an Org-Einladung on the public Landing (issue #83).

    The accept link's token (mailed only to the invitee) is the proof that lets
    them join: ``GET`` shows the accept page — a set-a-password form when no
    account yet exists for the invited email, or a one-click join when one does
    (they keep their own credentials, ADR 0008). ``POST`` creates the account (if
    new) and the Mitgliedschaft via ``birds.invitations.accept_invitation``, after
    which they can record captures as a Mitglied. Server-rendered on the shared
    Landing base, German-only — never the Angular SPA shell.
    """

    form_template = "landing/invitation_accept.html"
    invalid_template = "landing/invitation_invalid.html"
    done_template = "landing/invitation_done.html"

    def _pending(self, token):
        return (
            OrgEinladung.objects.filter(token=token, accepted_at__isnull=True)
            .select_related("organization")
            .first()
        )

    def get(self, request, token):
        invitation = self._pending(token)
        if invitation is None:
            return self._render_invalid(request)
        return self._render_form(request, invitation)

    def post(self, request, token):
        invitation = self._pending(token)
        if invitation is None:
            return self._render_invalid(request)

        needs_password = account_for_email(invitation.email) is None
        password = None
        if needs_password:
            password = request.POST.get("new_password1") or ""
            errors = self._password_errors(password, request.POST.get("new_password2") or "")
            if errors:
                return self._render_form(request, invitation, errors=errors)

        accept_invitation(invitation, password=password)
        with translation.override("de"):
            return render(
                request,
                self.done_template,
                {"organization": invitation.organization},
            )

    @staticmethod
    def _password_errors(password, confirm):
        """German validation errors for a new account's password, or an empty list.

        The two entries must match and the password must clear Django's configured
        validators; messages are rendered under the ``de`` catalog so the
        German-only Landing never leaks English (mirrors ``GermanAuthFormMixin``)."""
        with translation.override("de"):
            if password != confirm:
                return [_("Die beiden Passwörter stimmen nicht überein.")]
            try:
                password_validation.validate_password(password)
            except ValidationError as exc:
                return list(exc.messages)
        return []

    def _render_form(self, request, invitation, errors=None):
        with translation.override("de"):
            return render(
                request,
                self.form_template,
                {
                    "organization": invitation.organization,
                    "email": invitation.email,
                    "needs_password": account_for_email(invitation.email) is None,
                    "errors": errors or [],
                    "password_help": password_validation.password_validators_help_texts(),
                },
            )

    def _render_invalid(self, request):
        with translation.override("de"):
            return render(request, self.invalid_template, status=404)


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
