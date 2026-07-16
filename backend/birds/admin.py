import csv
import datetime

from django.contrib import admin
from django.http import HttpResponse
from django.utils.timezone import localtime
from django.utils.translation import gettext_lazy as _

from .models import (
    Central,
    DataEntry,
    Mitgliedschaft,
    Organization,
    OrgEinladung,
    Project,
    Ring,
    RingingStation,
    Scientist,
    Species,
    SpeciesList,
    SpeciesNorm,
    SpeciesRingSizeOverride,
    Zugangscode,
)

# Parasit (ADR 0027): code → label for the fixed, app-wide vocabulary, used to
# render the multi-valued selection as text in the CSV export.
_PARASIT_LABELS = {code.value: str(code.label) for code in DataEntry.Parasit}


def export_as_csv(modeladmin, request, queryset):
    """
    Admin action to export the selected (and filtered) DataEntry objects as a CSV file.
    """

    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = (
        f"attachment; filename=Beringungsdaten-{datetime.date.today()}.csv"
    )
    writer = csv.writer(response)
    header_row = [
        "Art",
        "Ring",
        "Beringer(in)",
        "Station",
        "Zeitpunkt",
        "Status",
        "Alter",
        "Geschlecht",
        "Fettkl.",
        "Muskelkl.",
        "Gewicht",
        "Flügell.",
        "Federl.",
        "Handschwinge",
        "Kleingef. Int",
        "Kleingef. Forts.",
        "Tarsus",
        "Netz",
        "Fach",
        "Richtung",
        "Bemerkung",
    ]
    writer.writerow(header_row)

    for obj in queryset:
        comment = obj.comment if obj.comment else ""
        # Parasit (ADR 0027): each selected type's label is appended as text,
        # exactly as the single "Milben" token was before it generalised.
        for code in obj.parasites or []:
            comment += f" {_PARASIT_LABELS.get(code, code)}"
        comment += " Hungerstreifen" if obj.has_hunger_stripes else ""
        comment += " Brutfleck" if obj.has_brood_patch else ""
        comment += " CPL+" if obj.has_cpl_plus else ""
        writer.writerow(
            [
                obj.species.common_name_de,
                obj.ring.size + obj.ring.number,
                obj.staff.handle,
                obj.ringing_station.name if obj.ringing_station else "",
                localtime(obj.date_time).strftime("%Y-%m-%d %H:%M:%S"),
                obj.get_bird_status_display(),
                obj.get_age_class_display(),
                obj.get_sex_display(),
                obj.fat_deposit,
                obj.muscle_class,
                obj.weight_gram,
                obj.wing_span,
                obj.feather_span,
                obj.hand_wing,
                obj.small_feather_int,
                obj.small_feather_app,
                obj.tarsus,
                obj.net_location,
                obj.net_height,
                obj.net_direction,
                comment,
            ]
        )

    return response


export_as_csv.short_description = "Als CSV exportieren"


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = (
        "handle",
        "name",
        "country",
        "plan",
        "seat_limit",
        "beta_cohort",
        "agb_accepted_at",
    )
    list_editable = ("plan", "seat_limit", "beta_cohort")
    list_filter = ("plan", "beta_cohort")
    search_fields = ("handle", "name")
    # Recorded automatically at founding (issue #78) — shown but not editable.
    readonly_fields = ("agb_accepted_at",)
    ordering = ("handle",)


@admin.register(RingingStation)
class RingingStationAdmin(admin.ModelAdmin):
    list_display = (
        "handle",
        "name",
        "organization",
        "country",
        "region",
        "place_code",
        "latitude",
        "longitude",
    )
    list_filter = ("organization", "country", "region")
    search_fields = ("handle", "name")
    ordering = ("handle",)


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "organization",
        "circumstance",
        "capture_method",
        "lure",
        "updated",
    )
    list_filter = ("organization", "capture_method", "lure")
    search_fields = ("title",)
    ordering = ("-updated",)
    filter_horizontal = ("scientists",)


@admin.register(SpeciesNorm)
class SpeciesNormAdmin(admin.ModelAdmin):
    """Where the operator edits the globale Standard-Artennormen (ADR 0021).

    The in-app editor exposes only org overrides; the shared global defaults
    (``organization IS NULL``) are edited here (or via seed migrations)."""

    list_display = ("species", "organization", "weight_mean", "weight_sd", "sd_factor")
    list_filter = ("organization",)
    search_fields = ("species__common_name_de", "species__scientific_name")
    autocomplete_fields = ("species",)


@admin.register(SpeciesRingSizeOverride)
class SpeciesRingSizeOverrideAdmin(admin.ModelAdmin):
    """Per-Organisation Empfohlene-Ringgröße overrides (ADR 0028).

    A standalone value, its own table — independent of the whole-row Artennorm.
    The global default lives on ``Species.ring_size``; the in-app editor writes
    these per-org overrides."""

    list_display = ("species", "organization", "ring_size")
    list_filter = ("organization", "ring_size")
    search_fields = ("species__common_name_de", "species__scientific_name")
    autocomplete_fields = ("species",)


@admin.register(Zugangscode)
class ZugangscodeAdmin(admin.ModelAdmin):
    """Where the operator issues single-use codes that gate org founding (#79)."""

    list_display = ("code", "note", "is_used", "used_at", "founded_organization", "created")
    list_filter = ("used_at",)
    search_fields = ("code", "note")
    ordering = ("-created",)
    readonly_fields = ("created", "used_at", "founded_organization")

    @admin.display(boolean=True, description=_("Eingelöst"))
    def is_used(self, obj):
        return obj.is_used


@admin.register(Mitgliedschaft)
class MitgliedschaftAdmin(admin.ModelAdmin):
    list_display = ("user", "organization", "rolle", "updated")
    list_filter = ("organization", "rolle")
    search_fields = ("user__username", "organization__handle", "organization__name")
    ordering = ("organization", "user__username")
    autocomplete_fields = ("user",)


@admin.register(OrgEinladung)
class OrgEinladungAdmin(admin.ModelAdmin):
    list_display = ("email", "organization", "rolle", "invited_by", "accepted_at", "created")
    list_filter = ("organization", "rolle")
    search_fields = ("email", "organization__handle", "organization__name")
    ordering = ("-created",)
    readonly_fields = ("token", "accepted_at", "created", "updated")
    autocomplete_fields = ("invited_by",)


@admin.register(Scientist)
class ScientistAdmin(admin.ModelAdmin):
    list_display = ("handle", "first_name", "last_name", "organization")
    list_filter = ("organization",)
    search_fields = ("handle",)
    ordering = ("handle",)


@admin.register(Species)
class SpeciesAdmin(admin.ModelAdmin):
    list_display = (
        "scientific_name",
        "common_name_de",
        "ring_size",
        "special_kind",
        "family_name",
        "order_name",
    )
    search_fields = ("common_name_de", "common_name_en", "scientific_name")
    ordering = ("scientific_name",)
    list_filter = ("ring_size", "special_kind")


@admin.register(Central)
class CentralAdmin(admin.ModelAdmin):
    list_display = ("scheme_code", "name", "country")
    search_fields = ("scheme_code", "name", "country")
    ordering = ("scheme_code",)


@admin.register(Ring)
class RingAdmin(admin.ModelAdmin):
    list_display = ("size", "number", "organization", "central")
    search_fields = ("number",)
    list_filter = ("size", "organization", "central")
    ordering = (
        "size",
        "number",
    )


@admin.register(DataEntry)
class DataEntryAdmin(admin.ModelAdmin):
    list_display = (
        "species",
        "ring",
        "staff",
        "date_time",
        "ringing_station",
        "project",
        "bird_status",
        "net_location",
        "age_class",
        "sex",
        "fat_deposit",
        "muscle_class",
        "small_feather_int",
        "small_feather_app",
        "hand_wing",
        "tarsus",
        "feather_span",
        "wing_span",
    )
    list_filter = ("ringing_station", "project", "staff", "species", "date_time")
    search_fields = ("ring__number", "species__scientific_name", "species__common_name_de")
    date_hierarchy = "date_time"
    ordering = ("-created",)
    autocomplete_fields = ["species", "ring", "staff"]
    fieldsets = (
        (
            "Core Information",
            {"fields": ("species", "ring", "staff", "project", "date_time", "bird_status")},
        ),
        (
            "Capture Location",
            {"fields": ("ringing_station", "net_location", "net_height", "net_direction")},
        ),
        (
            "Biometrics",
            {
                "fields": (
                    "weight_gram",
                    "wing_span",
                    "feather_span",
                    "tarsus",
                    "notch_f2",
                    "inner_foot",
                )
            },
        ),
        (
            "Condition & Moult",
            {
                "fields": (
                    "fat_deposit",
                    "muscle_class",
                    "age_class",
                    "sex",
                    "small_feather_int",
                    "small_feather_app",
                    "hand_wing",
                    "parasites",
                    "has_hunger_stripes",
                    "has_brood_patch",
                    "has_cpl_plus",
                )
            },
        ),
        (
            "Additional Notes",
            {
                "classes": ("collapse",),
                "fields": ("comment",),
            },
        ),
    )
    readonly_fields = ("created", "updated")
    actions = [export_as_csv]


@admin.register(SpeciesList)
class SpeciesListAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "is_active", "updated")
    list_filter = ("user", "is_active")
    search_fields = ("name", "user__username")
    ordering = ("-updated",)

    # Provides a much better UI for ManyToMany fields with many options
    filter_horizontal = ("species",)
