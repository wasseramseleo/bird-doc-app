from django.contrib import admin

from .models import Warteliste


@admin.register(Warteliste)
class WartelisteAdmin(admin.ModelAdmin):
    """Where the operator reviews access-request leads and (composing with the
    Zugangscode slice) issues a Zugangscode (issue #80)."""

    list_display = ("email", "organisation_name", "created")
    search_fields = ("email", "organisation_name", "message")
    readonly_fields = ("created",)
    ordering = ("-created",)
