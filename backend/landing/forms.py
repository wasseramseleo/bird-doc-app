from django import forms

from .models import Warteliste


class WartelisteForm(forms.ModelForm):
    """The public "Zugang anfragen" form. Only the email is required — the
    Organisation name and the note give the operator context but stay optional,
    so leaving a lead costs the visitor a single field."""

    class Meta:
        model = Warteliste
        fields = ["email", "organisation_name", "message"]
