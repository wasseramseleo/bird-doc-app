from django.db import models


class Warteliste(models.Model):
    """A public lead — someone reaching out from the landing page (issue #80, #103).

    The model holds two typed funnels that write to the *one* table (issue #103):
    an individual **Beringer** self-serves the Warteliste ("Zugang anfragen") to
    ask for a Zugangscode, while a central body requests a **Gespräch** as an
    `organisation` lead. The Warteliste grants nothing by itself; the operator
    reviews every lead in the Django admin (filtering by type), where issuing a
    Zugangscode also happens. A lead carries no account and no Organisation — only
    enough for the operator to reach back: an email, the Organisation named, and a
    free-form note, plus (for an organisation lead) who is asking and roughly how
    many Beringer they speak for. The organisation lead is an out-of-model sales
    signal (ADR 0005): naming a central authority such as the Österreichische
    Vogelwarte introduces no parent-of-Organisations tier.
    """

    class LeadType(models.TextChoices):
        BERINGER = "beringer", "Beringer (Warteliste)"
        ORGANISATION = "organisation", "Organisation (Gespräch)"

    lead_type = models.CharField(
        "Typ",
        max_length=20,
        choices=LeadType.choices,
        default=LeadType.BERINGER,
        help_text="Welcher Funnel den Lead hinterlassen hat.",
    )
    email = models.EmailField(
        "E-Mail",
        help_text="Wir melden uns unter dieser Adresse, sobald ein Zugang frei wird.",
    )
    organisation_name = models.CharField(
        "Organisation",
        max_length=200,
        blank=True,
        help_text="Die Beringungs-Organisation, die du gründen möchtest (optional).",
    )
    contact_role = models.CharField(
        "Funktion / Rolle",
        max_length=200,
        blank=True,
        help_text="Deine Funktion in der Organisation (z. B. wissenschaftliche "
        "Leitung) — nur für Organisations-Anfragen relevant.",
    )
    approx_beringer_count = models.CharField(
        "Ungefähre Anzahl Beringer",
        max_length=50,
        blank=True,
        help_text="Für wie viele Beringer sprichst du ungefähr? (optional)",
    )
    message = models.TextField(
        "Nachricht",
        blank=True,
        help_text="Worum geht es? Erzähl uns kurz von deinem Vorhaben (optional).",
    )
    created = models.DateTimeField("Angefragt am", auto_now_add=True)

    class Meta:
        verbose_name = "Warteliste-Eintrag"
        verbose_name_plural = "Warteliste"
        ordering = ["-created"]

    def __str__(self):
        return self.email
