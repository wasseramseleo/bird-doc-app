"""Forms for the public Landing app.

German-labelled, server-rendered forms reached by an ordinary unauthenticated
visitor — no DRF, no SPA. The registration form gathers what founding an
Organisation behind a Zugangscode needs (issue #79); the transactional creation
itself lives in :mod:`birds.registration`. The Warteliste form (issue #80)
stores an access-request lead.
"""

from django import forms
from django.contrib.auth.password_validation import validate_password
from django.utils.translation import gettext_lazy as _

from .models import Warteliste


class WartelisteForm(forms.ModelForm):
    """The public "Zugang anfragen" form. Only the email is required — the
    Organisation name and the note give the operator context but stay optional,
    so leaving a lead costs the visitor a single field."""

    class Meta:
        model = Warteliste
        fields = ["email", "organisation_name", "message"]


class RegistrationForm(forms.Form):
    """Collects the newcomer's account, name, Organisation and Zugangscode."""

    first_name = forms.CharField(label=_("Vorname"), max_length=150)
    last_name = forms.CharField(label=_("Nachname"), max_length=150)
    email = forms.EmailField(label=_("E-Mail"))
    organisation_name = forms.CharField(label=_("Name der Organisation"), max_length=255)
    code = forms.CharField(label=_("Zugangscode"), max_length=64)
    password1 = forms.CharField(label=_("Passwort"), widget=forms.PasswordInput)
    password2 = forms.CharField(label=_("Passwort bestätigen"), widget=forms.PasswordInput)

    def clean_password2(self):
        password1 = self.cleaned_data.get("password1")
        password2 = self.cleaned_data.get("password2")
        if password1 and password2 and password1 != password2:
            raise forms.ValidationError(_("Die Passwörter stimmen nicht überein."))
        validate_password(password2)
        return password2
