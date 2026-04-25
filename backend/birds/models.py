import uuid

from django.contrib.auth.models import User
from django.db import models
from django.utils.translation import gettext_lazy as _


class Ring(models.Model):
    class RingSizes(models.TextChoices):
        V = "V", _("V")
        T = "T", _("T")
        S = "S", _("S")
        X = "X", _("X")
        P = "P", _("P")

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

    def __str__(self):
        return f"{self.common_name_de} ({self.scientific_name})"


class Scientist(models.Model):
    user = models.OneToOneField(User, on_delete=models.PROTECT, verbose_name=_("Beringer"))
    handle = models.CharField(unique=True, max_length=11, verbose_name=_("Kürzel"))

    def __str__(self):
        return f"{self.handle}"


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

    def __str__(self):
        return f"{self.handle}"


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255, verbose_name=_("Titel"))
    description = models.TextField(blank=True, verbose_name=_("Beschreibung"))
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name="projects",
        verbose_name=_("Organisation"),
    )
    scientists = models.ManyToManyField(
        Scientist,
        related_name="projects",
        blank=True,
        verbose_name=_("Beringer"),
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
    staff = models.ForeignKey(Scientist, on_delete=models.PROTECT, verbose_name=_("Beringer"))
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
        choices=AgeClass.choices, default=AgeClass.UNKNOWN, verbose_name=_("Alter")
    )
    sex = models.PositiveSmallIntegerField(
        choices=Sex.choices, default=Sex.UNKNOWN, verbose_name=_("Geschlecht")
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
