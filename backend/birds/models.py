import secrets
import uuid
from decimal import Decimal

from django.contrib.auth.models import User
from django.db import models
from django.db.models import ProtectedError
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.utils.translation import gettext_lazy as _

from .kuerzel import derive_handle

# EURING scheme code of the default Zentrale — the Austrian Vogelwarte. Every
# existing Ring and Projekt is backfilled to it, and every new Projekt defaults
# to it (ADR 0019); the capture write path creates rings under the Projekt's
# Zentrale, which today is always AUW.
AUW_SCHEME_CODE = "AUW"


class Central(models.Model):
    """A ringing centre / EURING ringing scheme — a *Zentrale* (ADR 0019).

    Global reference data like ``Species``: explicitly **never** tenant-scoped.
    Every Ring and Projekt carries one; the published EURING scheme list is
    seeded by data migration. ``scheme_code`` is the EURING three-letter scheme
    code (e.g. ``AUW`` for the Austrian Vogelwarte, ``SKB`` for the Slovak
    Bratislava scheme) and is globally unique.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scheme_code = models.CharField(max_length=8, unique=True, verbose_name=_("Zentralen-Code"))
    name = models.CharField(max_length=255, verbose_name=_("Name"))
    country = models.CharField(max_length=64, blank=True, verbose_name=_("Land"))

    class Meta:
        verbose_name = _("Zentrale")
        verbose_name_plural = _("Zentralen")
        ordering = ("scheme_code",)

    def __str__(self):
        return f"{self.scheme_code} ({self.name})"


def get_auw_central():
    """Return the default Zentrale (EURING scheme ``AUW``), creating it
    defensively if absent.

    The Ring/Projekt Zentrale fallback: ``Ring.save()`` and ``Project.save()``
    resolve an unset ``central`` here so every row is attributed to AUW (the
    cutover state — ADR 0019), and the capture write path uses the Projekt's
    Zentrale, which today is always AUW. The row normally exists via the EURING
    seed migration; ``get_or_create`` keeps the contract safe on a fresh or
    edge-case database.
    """
    central, _ = Central.objects.get_or_create(
        scheme_code=AUW_SCHEME_CODE,
        defaults={"name": "Österreichische Vogelwarte", "country": "Austria"},
    )
    return central


class Ring(models.Model):
    class RingSizes(models.TextChoices):
        # Austrian ringing scheme (AOC / Österreichische Vogelwarte).
        # Ordered largest → smallest inner diameter. The "A" suffix denotes
        # Stahl (steel); the "S" suffix denotes "mit Lasche" (with tab).
        AS = "AS", _("AS")
        BS = "BS", _("BS")
        C = "C", _("C")
        D = "D", _("D")
        DS = "DS", _("DS")
        DA = "DA", _("DA")
        F = "F", _("F")
        FA = "FA", _("FA")
        G = "G", _("G")
        GA = "GA", _("GA")
        H = "H", _("H")
        HA = "HA", _("HA")
        K = "K", _("K")
        KA = "KA", _("KA")
        L = "L", _("L")
        LA = "LA", _("LA")
        M = "M", _("M")
        N = "N", _("N")
        NA = "NA", _("NA")
        P = "P", _("P")
        PA = "PA", _("PA")
        R = "R", _("R")
        S = "S", _("S")
        SA = "SA", _("SA")
        T = "T", _("T")
        TA = "TA", _("TA")
        V = "V", _("V")
        X = "X", _("X")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number = models.CharField(max_length=64)
    # Widened from 3 to 10 for the Zentrale write path (ADR 0019): an AUW ring
    # keeps a short Austrian scheme code (``choices``, enforced conditionally in
    # the capture write path — never at the DB), while a foreign Zentrale records
    # a free-text Größe capped at ``FOREIGN_RING_SIZE_MAX_LENGTH``. The single
    # ``size`` column carries both; ``choices`` stays for the Austrian admin
    # dropdown and never restricts a stored free-text value (``save()`` runs no
    # full_clean).
    size = models.CharField(
        max_length=10, choices=RingSizes.choices, default=RingSizes.V, verbose_name=_("Ringgröße")
    )
    # The owning Organisation — the tenant boundary (ADR 0006). Ring uniqueness is
    # scoped to it, so two Organisations may each own the same (size, number): an
    # Austrian V 0042 and a foreign V 0042 are different physical rings. Nullable
    # only as a migration safety net for legacy rows that predate the field; the
    # capture path always creates rings within the recording Organisation.
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="rings",
        null=True,
        blank=True,
        verbose_name=_("Organisation"),
    )
    # The issuing Zentrale (ADR 0019). Ring uniqueness widens to
    # (organization, central, size, number), so the same Größe+Nummer under two
    # different Zentralen — an Austrian V 0042 and a Slovak V 0042 — are distinct
    # physical rings within one Organisation. Nullable only as a migration safety
    # net for legacy rows that predate the field; ``save()`` resolves an unset
    # Zentrale to AUW, and the capture path always records the Projekt's Zentrale
    # (today AUW), so every persisted Ring carries one.
    central = models.ForeignKey(
        "Central",
        on_delete=models.PROTECT,
        related_name="rings",
        null=True,
        blank=True,
        verbose_name=_("Zentrale"),
    )

    class Meta:
        unique_together = ("organization", "central", "size", "number")

    def save(self, *args, **kwargs):
        # Keep every Ring attributed to a Zentrale: when it is left unset
        # (admin/ORM/test paths), inherit the default AUW Zentrale (ADR 0019).
        # The capture write path sets it to the Projekt's Zentrale before saving,
        # so this never overrides an explicit value.
        if self.central_id is None:
            self.central = get_auw_central()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.size} {self.number}"


class Species(models.Model):
    class SpecialKind(models.TextChoices):
        # A Sonderart discriminator: a non-empty value marks a non-taxon Species
        # row that is always selectable (it bypasses the active Artenliste). Each
        # kind derives its own behaviour — see the Sonderart entry in CONTEXT.md
        # and ADR 0004.
        NORMAL = "", _("Normale Art")
        RING_DESTROYED = "ring_destroyed", _("Ring vernichtet")
        UNKNOWN_SPECIES = "unknown_species", _("Unbekannte Art (Aves ignota)")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    common_name_de = models.CharField(max_length=127, unique=True)
    common_name_en = models.CharField(max_length=127, unique=True)
    scientific_name = models.CharField(max_length=127, unique=True)
    family_name = models.CharField(max_length=255)
    order_name = models.CharField(max_length=255)
    ring_size = models.CharField(
        max_length=3,
        choices=Ring.RingSizes.choices,
        null=True,
        blank=True,
        verbose_name=_("Empfohlene Ringgröße"),
    )
    # The Sonderart discriminator (replaces the former is_sentinel boolean). It
    # drives three independent behaviours keyed off the value: visibility
    # (always-selectable when non-empty), form-collapse + server-side bird-data
    # null-out (ring_destroyed), and mandatory Bemerkung (unknown_species).
    special_kind = models.CharField(
        max_length=32,
        choices=SpecialKind.choices,
        default=SpecialKind.NORMAL,
        blank=True,
        verbose_name=_("Sonderart"),
    )

    def __str__(self):
        return f"{self.common_name_de} ({self.scientific_name})"


class Scientist(models.Model):
    user = models.OneToOneField(
        User, on_delete=models.PROTECT, null=True, blank=True, verbose_name=_("Beringer")
    )
    first_name = models.CharField(max_length=150, blank=True, verbose_name=_("Vorname"))
    last_name = models.CharField(max_length=150, blank=True, verbose_name=_("Nachname"))
    handle = models.CharField(unique=True, max_length=11, blank=True, verbose_name=_("Kürzel"))
    # The Organisation that owns this Beringer (ADR 0005). Both Mitglieder and
    # no-account Beringer are org-owned; only the reserved GELÖSCHT fallback — a
    # global cross-tenant sink, not a real Beringer — stays org-less, so the
    # field is nullable.
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="scientists",
        null=True,
        blank=True,
        verbose_name=_("Organisation"),
    )

    @property
    def full_name(self):
        own = f"{self.first_name} {self.last_name}".strip()
        if own:
            return own
        if self.user:
            return self.user.get_full_name()
        return ""

    def save(self, *args, **kwargs):
        # Derive the Kürzel only while it is empty; a typed value is respected.
        if not self.handle:
            self.handle = derive_handle(self.first_name, self.last_name)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.handle}"


# Reserved fallback Beringer that adopts the captures of a deleted Beringer.
# Deleting a Beringer must never destroy capture data, so DataEntry.staff is
# on_delete=SET(get_fallback_beringer) instead of PROTECT. The row is created by
# a data migration and hidden from the Beringer autocomplete (ScientistViewSet).
FALLBACK_BERINGER_HANDLE = "GELÖSCHT"
FALLBACK_BERINGER_FIRST_NAME = "Gelöschter"
FALLBACK_BERINGER_LAST_NAME = "Nutzer"


def get_fallback_beringer():
    """Return the reserved fallback Beringer, creating it defensively if absent.

    Serves as the ``on_delete=SET(...)`` resolver for ``DataEntry.staff`` so a
    deleted Beringer's captures are reassigned here across every deletion path
    (admin single, admin bulk, ORM/shell). The row normally exists via data
    migration; ``get_or_create`` keeps the contract safe even if it does not.
    """
    beringer, _ = Scientist.objects.get_or_create(
        handle=FALLBACK_BERINGER_HANDLE,
        defaults={
            "first_name": FALLBACK_BERINGER_FIRST_NAME,
            "last_name": FALLBACK_BERINGER_LAST_NAME,
        },
    )
    return beringer


@receiver(pre_delete, sender=Scientist)
def protect_fallback_beringer(sender, instance, **kwargs):
    """Block deletion of the reserved fallback Beringer on every ORM path.

    The fallback is the sink that adopts deleted Beringers' captures; deleting
    it would orphan exactly those captures. ``pre_delete`` fires for both single
    (``instance.delete()``) and bulk (``QuerySet.delete()``) paths, so this one
    guard covers admin, shell and ORM alike — the same totality argument that
    puts the reassignment on ``on_delete=SET``. The receiver is bound to the
    real ``Scientist`` class, so migrations (which use a historical model) can
    still tear the row down on reverse.
    """
    if instance.handle == FALLBACK_BERINGER_HANDLE:
        raise ProtectedError(
            f"The reserved fallback Beringer ({FALLBACK_BERINGER_HANDLE}) cannot be deleted.",
            {instance},
        )


class Organization(models.Model):
    class Plan(models.TextChoices):
        # The Organisation's licensing phase and unit of monetisation (pricing is
        # per Organisation, never per head — ADR 0005). Only the free public-beta
        # plan exists today; paid tiers arrive at 1.0.
        BETA = "beta", _("Beta")

    id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    name = models.CharField(max_length=255, verbose_name=_("Name"))
    handle = models.CharField(
        primary_key=True, max_length=64, unique=True, verbose_name=_("Kürzel")
    )
    country = models.CharField(max_length=8, blank=True, verbose_name=_("Land"))
    # Per-Organisation tenant/monetisation fields (ADR 0005). ``plan`` is the
    # mutable licensing tier; ``seat_limit`` caps the number of Mitgliedschaften
    # (each consumes one Mitgliedsplatz, no-account Beringer consume none);
    # ``beta_cohort`` is a *durable* marker — separate from the mutable plan —
    # entitling beta-era Organisations to a permanent preferential price at 1.0.
    plan = models.CharField(
        max_length=16,
        choices=Plan.choices,
        default=Plan.BETA,
        verbose_name=_("Plan"),
    )
    seat_limit = models.PositiveIntegerField(default=5, verbose_name=_("Seat-Limit"))
    beta_cohort = models.BooleanField(default=False, verbose_name=_("Beta-Kohorte"))
    # When the founder accepted the AGB + DPA at org founding (PRD #68 story 51,
    # issue #78). The Organisation is the controller and BirdDoc the processor;
    # acceptance is a required, recorded step of the gated founding flow, stamped
    # in ``birds.registration.register_organisation``. Nullable for legacy rows
    # founded before this gate (e.g. the cutover-migrated IWM Linz Organisation).
    agb_accepted_at = models.DateTimeField(
        null=True, blank=True, verbose_name=_("AGB/DPA akzeptiert am")
    )

    def __str__(self):
        return f"{self.handle}"


class Mitgliedschaft(models.Model):
    """A login account's membership in an Organisation, carrying a Rolle.

    The tenancy spine (ADR 0005): a Mitgliedschaft links a Django ``User`` to an
    ``Organisation`` and grants a ``Rolle`` there. Memberships are **per
    Organisation** — multiple are allowed per account (a Beringer may ring for
    more than one body), so the Rolle is per-org: Admin in one, plain Mitglied in
    another. ``unique_together`` forbids only a *duplicate* membership in the same
    Organisation. The org-switcher UI is deferred; while an account holds exactly
    one Mitgliedschaft that is its implicit active Organisation
    (``birds.tenancy.active_organization``).
    """

    class Rolle(models.TextChoices):
        ADMIN = "admin", _("Admin")
        MITGLIED = "mitglied", _("Mitglied")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="mitgliedschaften",
        verbose_name=_("Konto"),
    )
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="mitgliedschaften",
        verbose_name=_("Organisation"),
    )
    rolle = models.CharField(
        max_length=16,
        choices=Rolle.choices,
        default=Rolle.MITGLIED,
        verbose_name=_("Rolle"),
    )
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "organization")
        verbose_name = _("Mitgliedschaft")
        verbose_name_plural = _("Mitgliedschaften")

    def __str__(self):
        return f"{self.user.username} @ {self.organization_id} ({self.rolle})"


class Zugangscode(models.Model):
    """A single-use invite code that gates the founding of an Organisation.

    The only door through which a newcomer founds a new Organisation during the
    beta (ADR 0005): the operator issues a code in the Django admin, the public
    registration consumes it, and a consumed code can never found a second
    Organisation. ``used_at`` is the single-use ledger — ``None`` while the code
    is unused; stamped (together with ``founded_organization``) the moment it is
    spent. See :func:`birds.registration.register_organisation`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=64, unique=True, verbose_name=_("Zugangscode"))
    note = models.CharField(
        max_length=255,
        blank=True,
        verbose_name=_("Notiz"),
        help_text=_("Optionaler Vermerk des Betreibers (für wen / warum ausgestellt)."),
    )
    created = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True, verbose_name=_("Eingelöst am"))
    founded_organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="founding_codes",
        verbose_name=_("Gegründete Organisation"),
    )

    class Meta:
        verbose_name = _("Zugangscode")
        verbose_name_plural = _("Zugangscodes")

    @property
    def is_used(self):
        """A code is spent once it has been stamped with a redemption time."""
        return self.used_at is not None

    def __str__(self):
        return self.code


def generate_invite_token():
    """A high-entropy, URL-safe token that doubles as the secret in the accept
    link — possession of the token (mailed only to the invitee's address) is the
    proof that authorises joining the Organisation."""
    return secrets.token_urlsafe(32)


class OrgEinladung(models.Model):
    """An Admin's invitation of a colleague into an already-admitted Organisation
    as a Mitglied (the Org-Einladung — ADR 0005, issue #83).

    Distinct from a Zugangscode: it grows a team *inside* one Organisation and is
    **ungated** by the operator — but capped by the Organisation's Seat-Limit.
    Each *pending* (un-accepted) Einladung reserves one Mitgliedsplatz, exactly as
    a Mitgliedschaft consumes one; no-account Beringer consume none. Accepting it
    on the public Landing creates the account (if new) and the Mitgliedschaft and
    stamps ``accepted_at`` — see ``birds.invitations``.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.CASCADE,
        related_name="invitations",
        verbose_name=_("Organisation"),
    )
    email = models.EmailField(verbose_name=_("E-Mail"))
    rolle = models.CharField(
        max_length=16,
        choices=Mitgliedschaft.Rolle.choices,
        default=Mitgliedschaft.Rolle.MITGLIED,
        verbose_name=_("Rolle"),
    )
    token = models.CharField(
        max_length=64, unique=True, default=generate_invite_token, editable=False
    )
    invited_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_invitations",
        verbose_name=_("Eingeladen von"),
    )
    accepted_at = models.DateTimeField(null=True, blank=True, verbose_name=_("Angenommen am"))
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Org-Einladung")
        verbose_name_plural = _("Org-Einladungen")
        ordering = ("-created",)

    @property
    def is_pending(self):
        return self.accepted_at is None

    def __str__(self):
        return f"{self.email} → {self.organization_id} ({self.rolle})"


class RingingStation(models.Model):
    id = models.UUIDField(default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    handle = models.CharField(primary_key=True, max_length=124, unique=True)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name="ringing_stations",
        verbose_name=_("Organisation"),
    )
    country = models.CharField(max_length=64, blank=True, verbose_name=_("Land"))
    region = models.CharField(max_length=128, blank=True, verbose_name=_("Region"))
    place_code = models.CharField(max_length=16, blank=True, verbose_name=_("Ortskodierung"))
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True, verbose_name=_("Breitengrad")
    )
    longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True, verbose_name=_("Längengrad")
    )
    # Archiving flag (issue #117). A Station is never hard-deleted while captures
    # reference it (the FK is PROTECT); archiving hides it from the default
    # list/picker while keeping its captures intact and exportable. Reversible.
    is_active = models.BooleanField(default=True, verbose_name=_("Aktiv"))

    def __str__(self):
        return f"{self.handle}"


class Project(models.Model):
    class CaptureMethod(models.TextChoices):
        # IWM "Fangmethode" codes (see Datenmeldung_Vorlage_IWM, Erläuterungen).
        UNKNOWN = "Z", _("unbekannt")
        HAND = "H", _("mit der Hand gefangen")
        NEST = "N", _("am Nest, alle Methoden außer Handfang")
        MIST_NET = "M", _("Japannetz")
        CAGE_TRAP = "W", _("Käfigfalle (Reuse)")
        CLAP_NET = "L", _("Klappnetz")
        HOLLAND_TRAP = "U", _("Hollandfalle")
        OTHER_NET = "O", _("mit sonstigem Netz")
        HELGOLAND = "T", _("Helgolandreuse oder Entenlocke")
        SNARE = "S", _("Ball-Chatri oder Schlingen-Falle")
        DAZZLING = "D", _("mit Blend-Licht")
        RINGER_TRIGGERED = "A", _("durch Beringer ausgelöste Falle")
        BIRD_TRIGGERED = "B", _("durch Vogel selbst ausgelöste Falle")

    class Lure(models.TextChoices):
        # IWM "Lockmittel" codes (see Datenmeldung_Vorlage_IWM, Erläuterungen).
        UNKNOWN = "U", _("unbekannt")
        NONE = "N", _("sicher kein Lockmittel")
        MULTIPLE = "M", _("mehr als ein Lockmittel")
        FOOD = "A", _("Futter als Lockmittel")
        WATER = "B", _("Wasser als Lockmittel")
        LIGHT = "C", _("Licht als Lockmittel")
        LIVE_DECOY = "D", _("lebender Lockvogel")
        ARTIFICIAL_DECOY = "E", _("künstlicher/ausgestopfter Lockvogel")
        TAPE_SAME = "F", _("Klangattrappe (gleiche Art)")
        TAPE_OTHER = "G", _("Klangattrappe (andere Arten)")
        WHISTLE = "H", _("Lockpfeife")

    class Projekttyp(models.TextChoices):
        # Which programme a Projekt runs — descriptive, internal metadata only
        # (ADR 0023). It is never exported and gates no capture field; an unset
        # Projekttyp reads as Sonstiges (the default). db-values match members.
        IWM = "IWM", _("IWM")
        IMS = "IMS", _("IMS")
        ZUGVOGELMONITORING = "ZUGVOGELMONITORING", _("Zugvogelmonitoring")
        NESTLINGSBERINGUNG = "NESTLINGSBERINGUNG", _("Nestlingsberingung")
        SONSTIGES = "SONSTIGES", _("Sonstiges")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255, verbose_name=_("Titel"))
    description = models.TextField(blank=True, verbose_name=_("Beschreibung"))
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name="projects",
        verbose_name=_("Organisation"),
    )
    # The Projekt's Zentrale (ADR 0019): the ringing scheme its rings are issued
    # under. Defaults to AUW — backfilled for every existing Projekt and resolved
    # in ``save()`` for new ones. There is no settings UI yet (out of scope); the
    # follow-up slice adds the write path. Nullable only as a migration safety net
    # for legacy rows; ``save()`` resolves an unset Zentrale to AUW.
    central = models.ForeignKey(
        "Central",
        on_delete=models.PROTECT,
        related_name="projects",
        null=True,
        blank=True,
        verbose_name=_("Zentrale"),
    )
    default_station = models.ForeignKey(
        RingingStation,
        on_delete=models.SET_NULL,
        related_name="default_for_projects",
        null=True,
        blank=True,
        verbose_name=_("Standard-Station"),
    )
    scientists = models.ManyToManyField(
        Scientist,
        related_name="projects",
        blank=True,
        verbose_name=_("Beringer"),
    )
    show_optional_fields = models.BooleanField(
        default=True,
        verbose_name=_("Optionale Felder anzeigen"),
    )
    # Netzfelder anzeigen (issue #336, ADR 0023): an independent per-Projekt
    # switch — parallel to ``show_optional_fields`` and NOT derived from
    # ``projekttyp`` — that hides the capture form's whole net block (Netznr.,
    # Netzfach, Flugrichtung) when off. Default on so every existing Projekt keeps
    # showing the net fields. Display-only: values already stored on historical
    # captures are untouched and still export.
    show_net_fields = models.BooleanField(
        default=True,
        verbose_name=_("Netzfelder anzeigen"),
    )
    projekttyp = models.CharField(
        max_length=32,
        choices=Projekttyp.choices,
        default=Projekttyp.SONSTIGES,
        verbose_name=_("Projekttyp"),
    )
    circumstance = models.CharField(max_length=8, default="25", verbose_name=_("Umstand"))
    capture_method = models.CharField(
        max_length=1,
        choices=CaptureMethod.choices,
        default=CaptureMethod.MIST_NET,
        verbose_name=_("Fangmethode"),
    )
    lure = models.CharField(
        max_length=1,
        choices=Lure.choices,
        default=Lure.NONE,
        verbose_name=_("Lockmittel"),
    )
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        # A new Projekt defaults to the AUW Zentrale (ADR 0019) when none was set
        # explicitly. There is no Zentrale write path yet, so this is the sole
        # runtime source for a new Projekt's Zentrale.
        if self.central_id is None:
            self.central = get_auw_central()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class DataEntry(models.Model):
    class Direction(models.TextChoices):
        LEFT = "L", _("Links")
        RIGHT = "R", _("Rechts")

    class BirdStatus(models.TextChoices):
        FIRST_CATCH = "e", _("Erstfang")
        RE_CATCH = "w", _("Wiederfang")

    class AgeClass(models.IntegerChoices):
        NEST = 1, _("Nestling oder Nestflüchter")
        UNKNOWN = 2, _("Fängling (Alter unbekannt)")
        THIS_YEAR = 3, _("Diesjährig")
        NOT_THIS_YEAR = 4, _("Nicht Diensjährig")
        LAST_YEAR = 5, _("Vorjährig")
        NOT_LAST_YEAR = 6, _("Nicht Vorjährig")

    class Sex(models.IntegerChoices):
        UNKNOWN = 0, _("Unbestimmt")
        MALE = 1, _("Männlich")
        FEMALE = 2, _("Weiblich")

    class SmallFeatherIntMoult(models.IntegerChoices):
        NONE = 0, _("keine")
        SOME = 1, _("bis zu 20 Federn")
        MANY = 2, _("mehr als 20 Federn")

    class SmallFeatherAppMoult(models.TextChoices):
        JUVENILE = "J", _("Eben flügger Jungvogel")
        UNMOULTED = "U", _("Weniger als 1/3 erneuert")
        MIXED = "M", _("Zwischen 1/3 und 2/2 erneuert")
        NEW = "N", _("Mehr als 2/3 erneuert")

    class HandWingMoult(models.IntegerChoices):
        NONE = 0, _("Keine Handschwingen wachsen")
        NONE_OLD = 1, _("Alle sind unvermausert")
        AT_LEAST_ONE = 2, _("Mindestens eine mausert")
        ALL = 3, _("Alle vermausert")
        PART = 4, _("Ein Teil ist vermausert")

    class MuscleClass(models.IntegerChoices):
        NULL = 0, _("0")
        ONE = 1, _("1")
        TWO = 2, _("2")
        THREE = 3, _("3")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    species = models.ForeignKey(Species, on_delete=models.PROTECT, verbose_name=_("Art"))
    ring = models.ForeignKey(Ring, on_delete=models.PROTECT, verbose_name=_("Ringnummer"))
    staff = models.ForeignKey(
        Scientist, on_delete=models.SET(get_fallback_beringer), verbose_name=_("Beringer")
    )
    ringing_station = models.ForeignKey(
        RingingStation, on_delete=models.PROTECT, verbose_name=_("Station")
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.PROTECT,
        related_name="data_entries",
        verbose_name=_("Projekt"),
        null=True,
        blank=True,
    )
    # The owning Organisation — the tenant boundary (ADR 0005). The capture
    # endpoint attaches it to the requester's active Organisation; ``save()``
    # falls back to the Station's Organisation when it is left unset (admin/ORM
    # paths), so every capture is org-owned. Nullable only as a migration safety
    # net for legacy rows that predate the field.
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name="data_entries",
        null=True,
        blank=True,
        verbose_name=_("Organisation"),
    )
    net_location = models.PositiveIntegerField(verbose_name=_("Netznr."), null=True, blank=True)
    net_height = models.PositiveIntegerField(verbose_name=_("Netzfach"), null=True, blank=True)
    net_direction = models.CharField(
        max_length=1,
        choices=Direction.choices,
        verbose_name=_("Flugrichtung"),
        null=True,
        blank=True,
    )
    feather_span = models.DecimalField(
        max_digits=6, decimal_places=2, verbose_name=_("Federl. (mm)"), null=True, blank=True
    )
    wing_span = models.DecimalField(
        max_digits=6, decimal_places=2, verbose_name=_("Flügell. (mm)"), null=True, blank=True
    )
    tarsus = models.DecimalField(
        max_digits=6, decimal_places=2, verbose_name=_("Tarsus. (mm)"), null=True, blank=True
    )
    notch_f2 = models.DecimalField(
        max_digits=6, decimal_places=2, verbose_name=_("Kerbe F2 (mm)"), null=True, blank=True
    )
    inner_foot = models.DecimalField(
        max_digits=6, decimal_places=2, verbose_name=_("Innenfuß (mm)"), null=True, blank=True
    )
    weight_gram = models.DecimalField(
        max_digits=7, decimal_places=2, verbose_name=_("Gewicht (g)"), null=True, blank=True
    )
    bird_status = models.CharField(
        max_length=1,
        choices=BirdStatus.choices,
        default=BirdStatus.FIRST_CATCH,
        verbose_name=_("Status"),
        null=True,
        blank=True,
    )
    fat_deposit = models.PositiveSmallIntegerField(null=True, blank=True)
    muscle_class = models.PositiveSmallIntegerField(
        choices=MuscleClass.choices,
        default=None,
        verbose_name=_("Muskelklasse"),
        null=True,
        blank=True,
    )
    age_class = models.PositiveSmallIntegerField(
        choices=AgeClass.choices,
        default=AgeClass.UNKNOWN,
        verbose_name=_("Alter"),
        null=True,
        blank=True,
    )
    sex = models.PositiveSmallIntegerField(
        choices=Sex.choices,
        default=Sex.UNKNOWN,
        verbose_name=_("Geschlecht"),
        null=True,
        blank=True,
    )
    small_feather_int = models.PositiveSmallIntegerField(
        choices=SmallFeatherIntMoult.choices,
        default=None,
        verbose_name=_("Kleingef. Int"),
        null=True,
        blank=True,
    )
    small_feather_app = models.CharField(
        max_length=1,
        choices=SmallFeatherAppMoult.choices,
        default=None,
        verbose_name=_("Kleingef. Forts."),
        null=True,
        blank=True,
    )
    hand_wing = models.PositiveSmallIntegerField(
        choices=HandWingMoult.choices,
        default=None,
        verbose_name=_("Handschwinge"),
        null=True,
        blank=True,
    )
    has_mites = models.BooleanField(default=False, verbose_name=_("Milben"))
    has_hunger_stripes = models.BooleanField(default=False, verbose_name=_("Hungerstreifen"))
    has_brood_patch = models.BooleanField(default=False, verbose_name=_("Brutfleck"))
    has_cpl_plus = models.BooleanField(default=False, verbose_name=_("CPL+"))
    # Fangmarker (ADR 0026): two independent booleans that flag a special capture
    # situation WITHOUT replacing the real Art or Ring — the opposite of a
    # Sonderart. Orthogonal: both may be true at once, and either may sit on an
    # Aves-ignota capture. Forced off for a Ring-vernichtet capture (there is no
    # bird to mark). Both make the Bemerkung mandatory (serializer/capture-service);
    # neither alters the dashboard counts today (deferred, see ADR 0026).
    is_dead_recovery = models.BooleanField(default=False, verbose_name=_("Tot-Fund"))
    is_non_standard = models.BooleanField(default=False, verbose_name=_("Nicht-Standard-Fang"))
    date_time = models.DateTimeField(verbose_name=_("Datum"))
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)
    comment = models.CharField(
        max_length=2048, verbose_name=_("Bemerkungen"), null=True, blank=True
    )
    # #155 (PRD #152 — offline outbox sync): a client-generated UUID that
    # identifies one capture-create attempt end-to-end. A create carrying an
    # already-known key returns the existing record instead of minting a
    # duplicate (see capture_service.create_capture) — the keystone that lets
    # an offline device safely retry/replay a queued create. Scoped to the
    # recording Organisation (Meta.constraints below), mirroring Ring (ADR
    # 0006): two Organisations independently generating offline captures must
    # never have one's key collide with the other's, and a freak/malicious
    # cross-tenant collision must never resolve to another Organisation's row.
    # Nullable because only an idempotency-aware client (the capture form, the
    # future offline outbox) sends one; admin edits, the IWM importer and
    # legacy rows leave it unset.
    idempotency_key = models.UUIDField(null=True, blank=True, verbose_name=_("Idempotenzschlüssel"))

    class Meta:
        # NULL is never compared equal to NULL in a SQL unique index, so any
        # number of key-less captures coexist per Organisation — only two
        # captures of the *same* Organisation sharing an actual key collide.
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "idempotency_key"],
                name="unique_idempotency_key_per_organization",
            ),
            # A physical ring is applied to a bird exactly once, so at most one
            # Erstfang (first catch) may reference any Ring row (ADR 0006). The
            # Ring is itself org-scoped, so this is per-Organisation. A partial
            # index over ``bird_status='e'`` only: a ring may still carry any
            # number of Wiederfänge, and a 'ring_destroyed' record (bird_status
            # forced null) is outside the index. This is the DB backstop behind
            # ``create_capture``'s check-then-insert — two offline devices that
            # race a second Erstfang onto one ring both pass the pre-check SELECT,
            # but the losing INSERT hits this constraint and is deterministically
            # flagged (issue #164, PRD #152) instead of silently double-filing.
            models.UniqueConstraint(
                fields=["ring"],
                condition=models.Q(bird_status="e"),
                name="unique_erstfang_per_ring",
            ),
        ]

    def save(self, *args, **kwargs):
        # Keep every capture org-owned: when the Organisation is not set
        # explicitly (admin or ORM paths), inherit it from the Station, which is
        # itself org-owned. The capture endpoint sets it to the active
        # Organisation before saving, so this never overrides an explicit value.
        if self.organization_id is None and self.ringing_station_id is not None:
            self.organization_id = self.ringing_station.organization_id
        super().save(*args, **kwargs)


class SpeciesList(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, verbose_name=_("List Name"))
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="species_lists")
    species = models.ManyToManyField(Species, blank=True, related_name="lists")
    is_active = models.BooleanField(default=False, verbose_name=_("Active for Autocomplete"))
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        # Ensure a user cannot have two lists with the same name
        unique_together = ("user", "name")

    def __str__(self):
        return f"{self.name} ({self.user.username})"

    def save(self, *args, **kwargs):
        """
        Overrides the save method to ensure only one list can be active
        per user at any given time.
        """
        if self.is_active:
            # Set all other lists for this user to inactive
            SpeciesList.objects.filter(user=self.user).exclude(pk=self.pk).update(is_active=False)
        super().save(*args, **kwargs)


class SpeciesNorm(models.Model):
    """Per-species measurement norms driving the Plausibilitätsprüfung — the
    domain **Artennorm** (PRD #245, ADR 0021).

    Two-layer ownership: a row with ``organization IS NULL`` is the **globale
    Standard-Artennorm** (seeded once, shared like ``Species`` reference data); a
    row with an ``organization`` is that Organisation's **override**. The
    effective norm for a species in an Organisation is the override row if one
    exists, else the global default — resolved **whole-row**, never a per-column
    merge (ADR 0021), so clearing a column in an override switches *that* check
    off for the org.

    Every rule column is nullable: a null Ø/SD pair (or a null flag) means that
    particular Ausreißertest is simply off. The client runs the check
    (``computePlausibilityWarnings``); the server never enforces or blocks on
    plausibility.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    species = models.ForeignKey(
        Species,
        on_delete=models.CASCADE,
        related_name="norms",
        verbose_name=_("Art"),
    )
    # NULL = the globale Standard-Artennorm; a value = that Organisation's
    # override. Nullable by design (the global default targets every tenant,
    # including ones that do not exist yet).
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="species_norms",
        null=True,
        blank=True,
        verbose_name=_("Organisation"),
    )

    # The six paired Ø/SD numeric bands (Ø ± sd_factor·SD). All nullable — a
    # null pair turns that measurement's Ausreißertest off.
    weight_mean = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Gewicht Ø (g)")
    )
    weight_sd = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Gewicht SD (g)")
    )
    feather_mean = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Federl. Ø (mm)")
    )
    feather_sd = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Federl. SD (mm)")
    )
    wing_mean = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Flügell. Ø (mm)")
    )
    wing_sd = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Flügell. SD (mm)")
    )
    tarsus_mean = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Tarsus Ø (mm)")
    )
    tarsus_sd = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Tarsus SD (mm)")
    )
    notch_f2_mean = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Kerbe F2 Ø (mm)")
    )
    notch_f2_sd = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Kerbe F2 SD (mm)")
    )
    inner_foot_mean = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Innenfuß Ø (mm)")
    )
    inner_foot_sd = models.DecimalField(
        max_digits=8, decimal_places=3, null=True, blank=True, verbose_name=_("Innenfuß SD (mm)")
    )

    # The Quotient Federl./Flügell. uses a relative band (Ø ± Toleranz-%), not
    # an Ø/SD band. Both nullable (null = the quotient check is off).
    quotient_mean = models.DecimalField(
        max_digits=8, decimal_places=4, null=True, blank=True, verbose_name=_("Quotient Ø")
    )
    quotient_tolerance_pct = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True, verbose_name=_("Quotient Toleranz %")
    )

    # k for every Ø ± k·SD band. Defaults to 1.96 (the xlsx's "±SD"); nullable so
    # a row can be seeded without one (the client falls back to 1.96).
    sd_factor = models.DecimalField(
        max_digits=5,
        decimal_places=3,
        default=Decimal("1.96"),
        null=True,
        blank=True,
        verbose_name=_("SD-Faktor"),
    )

    # Categorical flags. Nullable tri-state: null = the flag check is off; False
    # = a determined value is implausible; True = it is fine.
    geschlechtsbestimmung_moeglich = models.BooleanField(
        null=True, blank=True, verbose_name=_("Geschlechtsbestimmung möglich")
    )
    dj_grossgefiedermauser_moeglich = models.BooleanField(
        null=True, blank=True, verbose_name=_("bei dj. Großgefiedermauser möglich")
    )

    class Meta:
        constraints = [
            # Exactly one globale Standard-Artennorm per species. A partial
            # index because NULL is never compared equal to NULL in a SQL unique
            # index, so a plain unique on (species, organization) would let two
            # NULL-org defaults coexist for one species.
            models.UniqueConstraint(
                fields=["species"],
                condition=models.Q(organization__isnull=True),
                name="unique_global_default_species_norm",
            ),
            # At most one override per (species, Organisation).
            models.UniqueConstraint(
                fields=["species", "organization"],
                name="unique_species_norm_per_org",
            ),
        ]

    def __str__(self):
        scope = self.organization_id or "Standard"
        return f"Artennorm {self.species_id} ({scope})"
