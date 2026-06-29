from django.contrib import admin

from .models import Warteliste


@admin.register(Warteliste)
class WartelisteAdmin(admin.ModelAdmin):
    """Where the operator works both lead funnels from one queue (issues #80, #103).

    A type filter splits the individual Beringer's Warteliste entries from the
    central bodies' Gespräch requests, while (composing with the Zugangscode
    slice) a Beringer lead is where a Zugangscode gets issued."""

    list_display = ("email", "lead_type", "organisation_name", "created")
    list_filter = ("lead_type",)
    search_fields = ("email", "organisation_name", "contact_role", "message")
    readonly_fields = ("created",)
    ordering = ("-created",)
