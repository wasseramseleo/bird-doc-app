import uuid

from django.contrib.auth.models import User
from django.db import models
from django.db.models import ProtectedError
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.utils.translation import gettext_lazy as _

from .kuerzel import derive_handle


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
    size = models.CharField(
        max_length=3, choices=RingSizes.choices, default=RingSizes.V, verbose_name=_("Ringgröße")
    )

    class Meta:
        unique_together = ("size", "number")

    def __str__(self):
        return f"{self.size} {self.number}"


class Species(models.Model):
    class SpecialKind(models.TextChoices):
        # A Sonderart discriminator: a non-empty value marks a non-taxon Species
        # row that is always selectable (it bypasses the active Artenliste). Each
        # kind derives its own behaviour — see the Sonderart entry in CONTEXT.md
        # and ADR 0003.
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
    id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    name = models.CharField(max_length=255, verbose_name=_("Name"))
    handle = models.CharField(
        primary_key=True, max_length=64, unique=True, verbose_name=_("Kürzel")
    )
    country = models.CharField(max_length=8, blank=True, verbose_name=_("Land"))

    def __str__(self):
        return f"{self.handle}"


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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255, verbose_name=_("Titel"))
    description = models.TextField(blank=True, verbose_name=_("Beschreibung"))
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name="projects",
        verbose_name=_("Organisation"),
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
    date_time = models.DateTimeField(verbose_name=_("Datum"))
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)
    comment = models.CharField(
        max_length=2048, verbose_name=_("Bemerkungen"), null=True, blank=True
    )


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
