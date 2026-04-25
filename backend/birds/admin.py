import csv
import datetime

from django.contrib import admin
from django.http import HttpResponse

from .models import Species, Ring, DataEntry, Scientist, RingingStation, SpeciesList


def export_as_csv(modeladmin, request, queryset):
    """
    Admin action to export the selected (and filtered) DataEntry objects as a CSV file.
    """

    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = f'attachment; filename=Beringungsdaten-{datetime.date.today()}.csv'
    writer = csv.writer(response)
    header_row = [
        'Art', 'Ring', 'Beringer(in)',
        'Station', 'Zeitpunkt', 'Status', 'Alter', 'Geschlecht',
        'Fettkl.', 'Muskelkl.', 'Gewicht', 'Flügell.', 'Federl.', 'Handschwinge',
        'Kleingef. Int', 'Kleingef. Forts.', 'Tarsus', 'Netz', 'Fach', 'Richtung', 'Bemerkung'
    ]
    writer.writerow(header_row)

    for obj in queryset:
        comment = obj.comment if obj.comment else ''
        comment += f' Milben' if obj.has_mites else ''
        comment += f' Hungerstreifen' if obj.has_hunger_stripes else ''
        comment += f' Brutfleck' if obj.has_brood_patch else ''
        comment += f' CPL+' if obj.has_cpl_plus else ''
        writer.writerow([
            obj.species.common_name_de,
            obj.ring.size + obj.ring.number,
            obj.staff.handle,
            obj.ringing_station.name if obj.ringing_station else '',
            obj.date_time.strftime('%Y-%m-%d %H:%M:%S'),
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
            comment
        ])

    return response


export_as_csv.short_description = "Als CSV exportieren"


@admin.register(RingingStation)
class RingingStationAdmin(admin.ModelAdmin):
    search_fields = ('handle',)
    ordering = ('handle',)


@admin.register(Scientist)
class ScientistAdmin(admin.ModelAdmin):
    list_display = ('handle',)
    search_fields = ('handle',)
    ordering = ('handle',)


@admin.register(Species)
class SpeciesAdmin(admin.ModelAdmin):
    list_display = ('scientific_name', 'common_name_de', 'ring_size', 'family_name', 'order_name')
    search_fields = ('common_name_de', 'common_name_en', 'scientific_name')
    ordering = ('scientific_name',)
    list_filter = ('ring_size',)


@admin.register(Ring)
class RingAdmin(admin.ModelAdmin):
    list_display = ('size', 'number')
    search_fields = ('number',)
    list_filter = ('size',)
    ordering = ('size', 'number',)


@admin.register(DataEntry)
class DataEntryAdmin(admin.ModelAdmin):
    list_display = ('species',
                    'ring',
                    'staff',
                    'date_time',
                    'ringing_station',
                    'bird_status',
                    'net_location',
                    'age_class',
                    'sex',
                    'fat_deposit',
                    'muscle_class',
                    'small_feather_int',
                    'small_feather_app',
                    'hand_wing',
                    'tarsus',
                    'feather_span',
                    'wing_span')
    list_filter = ('ringing_station', 'staff', 'species', 'date_time')
    search_fields = ('ring__number', 'species__scientific_name', 'species__common_name_de')
    date_hierarchy = 'date_time'
    ordering = ('-created',)
    autocomplete_fields = ['species', 'ring', 'staff']
    fieldsets = (
        ('Core Information', {
            'fields': ('species', 'ring', 'staff', 'date_time', 'bird_status')
        }),
        ('Capture Location', {
            'fields': ('ringing_station', 'net_location', 'net_height', 'net_direction')
        }),
        ('Biometrics', {
            'fields': ('weight_gram', 'wing_span', 'feather_span', 'tarsus', 'notch_f2', 'inner_foot')
        }),
        ('Condition & Moult', {
            'fields': ('fat_deposit', 'muscle_class', 'age_class', 'sex', 'small_feather_int', 'small_feather_app',
                       'hand_wing', 'has_mites', 'has_hunger_stripes', 'has_brood_patch', 'has_cpl_plus')
        }),
        ('Additional Notes', {
            'classes': ('collapse',),
            'fields': ('comment',),
        }),
    )
    readonly_fields = ('created', 'updated')
    actions = [export_as_csv]


@admin.register(SpeciesList)
class SpeciesListAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'is_active', 'updated')
    list_filter = ('user', 'is_active')
    search_fields = ('name', 'user__username')
    ordering = ('-updated',)

    # Provides a much better UI for ManyToMany fields with many options
    filter_horizontal = ('species',)