from django.db import models


class Warteliste(models.Model):
    """A public access-request lead — someone asking for a Zugangscode.

    The Warteliste ("Zugang anfragen" on the landing page) collects demand for
    Zugangscodes but grants nothing by itself (issue #80). The operator reviews
    these entries in the Django admin, where issuing a Zugangscode also happens.
    A lead carries no account and no Organisation — only enough for the operator
    to reach back: an email, the Organisation the visitor intends to found, and
    a free-form note.
    """

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
