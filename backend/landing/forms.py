"""Forms for the public Landing app.

German-labelled, server-rendered forms reached by an ordinary unauthenticated
visitor — no DRF, no SPA. The registration form gathers what founding an
Organisation behind a Zugangscode needs (issue #79); the transactional creation
itself lives in :mod:`birds.registration`. The Warteliste form (issue #80)
stores an access-request lead.
"""

from django import forms
from django.contrib.auth.password_validation import validate_password
from django.urls import reverse
from django.utils.html import format_html
from django.utils.translation import gettext
from django.utils.translation import gettext_lazy as _

from .models import Warteliste


class WartelisteForm(forms.ModelForm):
    """The public "Zugang anfragen" form — an individual Beringer's lead. Only the
    email is required; the Organisation name and the note give the operator
    context but stay optional, so leaving a lead costs the visitor a single field.
    The lead type defaults to ``beringer`` on the model, so this funnel is
    unchanged by the typed extension (issue #103).

    Its labels/help texts are translatable (``gettext_lazy``) so the form renders
    English under ``/en/`` (issue #107); the model keeps its plain German
    verbose names for the German-only admin."""

    class Meta:
        model = Warteliste
        fields = ["email", "organisation_name", "message"]
        labels = {
            "email": _("E-Mail"),
            "organisation_name": _("Organisation"),
            "message": _("Nachricht"),
        }
        help_texts = {
            "email": _("Wir melden uns unter dieser Adresse, sobald ein Zugang frei wird."),
            "organisation_name": _(
                "Die Beringungs-Organisation, die du gründen möchtest (optional)."
            ),
            "message": _("Worum geht es? Erzähl uns kurz von deinem Vorhaben (optional)."),
        }


class GespraechForm(forms.ModelForm):
    """The public "Gespräch vereinbaren" form — a central body's lead (issue #103).

    Writes to the same model as the Warteliste but stamps an ``organisation`` lead
    and collects the extra context the operator needs to follow up: who is asking
    (Funktion/Rolle) and roughly how many Beringer they speak for. Only the email
    is required; everything else is optional, mirroring the low-friction Warteliste."""

    class Meta:
        model = Warteliste
        fields = ["email", "organisation_name", "contact_role", "approx_beringer_count", "message"]
        labels = {
            "email": _("E-Mail"),
            "organisation_name": _("Organisation / Stelle"),
            "contact_role": _("Funktion / Rolle"),
            "approx_beringer_count": _("Ungefähre Anzahl Beringer"),
            "message": _("Nachricht"),
        }
        help_texts = {
            "email": _("An diese Adresse melden wir uns, um ein Gespräch zu vereinbaren."),
            "organisation_name": _(
                "Die zentrale Stelle, für die du anfragst (z. B. eine Vogelwarte)."
            ),
            "contact_role": _(
                "Deine Funktion in der Organisation (z. B. wissenschaftliche Leitung)."
            ),
            "approx_beringer_count": _("Für wie viele Beringer sprichst du ungefähr? (optional)"),
            "message": _("Worum geht es? Erzähl uns kurz von eurem Vorhaben (optional)."),
        }

    def save(self, commit=True):
        lead = super().save(commit=False)
        lead.lead_type = Warteliste.LeadType.ORGANISATION
        if commit:
            lead.save()
        return lead


class RegistrationForm(forms.Form):
    """Collects the newcomer's account, name, Organisation and Zugangscode."""

    first_name = forms.CharField(label=_("Vorname"), max_length=150)
    last_name = forms.CharField(label=_("Nachname"), max_length=150)
    email = forms.EmailField(label=_("E-Mail"))
    organisation_name = forms.CharField(label=_("Name der Organisation"), max_length=255)
    code = forms.CharField(label=_("Zugangscode"), max_length=64)
    password1 = forms.CharField(label=_("Passwort"), widget=forms.PasswordInput)
    password2 = forms.CharField(label=_("Passwort bestätigen"), widget=forms.PasswordInput)
    # Founding an Organisation requires affirmative, recorded acceptance of the
    # AGB + DPA — the Organisation is the controller, BirdDoc the processor (PRD
    # #68 story 51, issue #78). A required BooleanField rejects an unchecked box.
    accept_agb = forms.BooleanField(
        required=True,
        error_messages={
            "required": _(
                "Bitte akzeptiere die AGB und die Vereinbarung zur "
                "Auftragsverarbeitung (DPA), um eine Organisation zu gründen."
            )
        },
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # The label links to the AGB page (which carries the DPA appendix at
        # #dpa). Built with format_html so the anchor renders clickable through
        # {{ form.as_p }} on the German-only registration page.
        self.fields["accept_agb"].label = format_html(
            gettext(
                'Ich akzeptiere die <a href="{}" target="_blank" rel="noopener">AGB '
                "und die Vereinbarung zur Auftragsverarbeitung (DPA)</a>."
            ),
            reverse("landing:agb"),
        )

    def clean_password2(self):
        password1 = self.cleaned_data.get("password1")
        password2 = self.cleaned_data.get("password2")
        if password1 and password2 and password1 != password2:
            raise forms.ValidationError(_("Die Passwörter stimmen nicht überein."))
        validate_password(password2)
        return password2
