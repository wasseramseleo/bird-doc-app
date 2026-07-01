from django.db import transaction
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .models import (
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
)
from .station_handle import derive_station_handle
from .tenancy import active_organization


class SpeciesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Species
        fields = [
            "id",
            "common_name_de",
            "common_name_en",
            "scientific_name",
            "ring_size",
            "special_kind",
        ]


class RingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ring
        fields = ["id", "number", "size"]


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "handle", "name", "country"]


class RingingStationSerializer(serializers.ModelSerializer):
    # The handle is server-owned (issue #118): derived on create from the
    # Organisation + name and returned as the record id, but never settable.
    handle = serializers.CharField(read_only=True)
    organization = OrganizationSerializer(read_only=True)
    # Client-supplied ``organization_id`` is optional and, on create, overridden
    # by the actor's active Organisation in ``perform_create`` (issue #117).
    organization_id = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.all(),
        source="organization",
        write_only=True,
        required=False,
    )
    # Required at the serializer layer with clear German messages, even though the
    # model keeps these blank-able for admin/ORM paths.
    name = serializers.CharField(
        max_length=255,
        error_messages={
            "required": _("Ein Name ist erforderlich."),
            "blank": _("Ein Name ist erforderlich."),
        },
    )
    place_code = serializers.CharField(
        max_length=16,
        error_messages={
            "required": _("Eine Ortskodierung ist erforderlich."),
            "blank": _("Eine Ortskodierung ist erforderlich."),
        },
    )
    latitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        error_messages={"required": _("Ein Breitengrad ist erforderlich.")},
    )
    longitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        error_messages={"required": _("Ein Längengrad ist erforderlich.")},
    )
    region = serializers.CharField(max_length=128, required=False, allow_blank=True)
    # Optional in the payload; defaults to the creating Organisation's country
    # when omitted or blank (handled in ``create``).
    country = serializers.CharField(max_length=64, required=False, allow_blank=True)

    class Meta:
        model = RingingStation
        fields = [
            "handle",
            "name",
            "organization",
            "organization_id",
            "country",
            "region",
            "place_code",
            "latitude",
            "longitude",
            "is_active",
        ]

    def create(self, validated_data):
        organization = validated_data["organization"]
        if not validated_data.get("country"):
            validated_data["country"] = organization.country
        validated_data["handle"] = derive_station_handle(
            organization,
            validated_data["name"],
            taken=lambda handle: RingingStation.objects.filter(handle=handle).exists(),
        )
        return super().create(validated_data)


class ScientistSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = Scientist
        fields = ["id", "handle", "first_name", "last_name", "full_name"]


class ProjectSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer(read_only=True)
    scientists = ScientistSerializer(many=True, read_only=True)
    default_station = RingingStationSerializer(read_only=True)
    organization_id = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.all(),
        source="organization",
        write_only=True,
        required=False,
    )
    scientist_ids = serializers.PrimaryKeyRelatedField(
        queryset=Scientist.objects.all(),
        source="scientists",
        many=True,
        write_only=True,
        required=False,
    )
    default_station_id = serializers.PrimaryKeyRelatedField(
        queryset=RingingStation.objects.all(),
        source="default_station",
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Project
        fields = [
            "id",
            "title",
            "description",
            "show_optional_fields",
            "organization",
            "organization_id",
            "default_station",
            "default_station_id",
            "scientists",
            "scientist_ids",
            "created",
            "updated",
        ]
        read_only_fields = ["id", "created", "updated"]

    def _effective_organization(self, attrs):
        """The Projekt's owning Organisation, resolved server-authoritatively
        (issue #74). On create it is the requester's active Organisation — never a
        client-supplied ``organization_id``, which ``ProjectViewSet.perform_create``
        overrides — so the default-Station org-match is checked against the org the
        Projekt will actually belong to. On update it is the instance's existing
        Organisation."""
        if self.instance is not None:
            return self.instance.organization
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            active = active_organization(user)
            if active is not None:
                return active
        return attrs.get("organization")

    def validate(self, attrs):
        station = attrs.get("default_station")
        if station is not None:
            organization = self._effective_organization(attrs)
            if organization is not None and station.organization_id != organization.pk:
                raise serializers.ValidationError(
                    {
                        "default_station_id": _(
                            "Die Station muss zur Organisation des Projekts gehören."
                        )
                    }
                )
        return attrs

    def create(self, validated_data):
        scientists = validated_data.pop("scientists", [])
        request = self.context.get("request")
        creator_scientist = getattr(getattr(request, "user", None), "scientist", None)
        if creator_scientist is not None and creator_scientist not in scientists:
            scientists = list(scientists) + [creator_scientist]
        project = Project.objects.create(**validated_data)
        if scientists:
            project.scientists.set(scientists)
        return project


class DataEntrySerializer(serializers.ModelSerializer):
    species = SpeciesSerializer(read_only=True)
    ring = RingSerializer(read_only=True)
    staff = ScientistSerializer(read_only=True)
    ringing_station = RingingStationSerializer(read_only=True)
    project = ProjectSerializer(read_only=True)

    ring_number = serializers.CharField(write_only=True, max_length=64)
    ring_size = serializers.ChoiceField(choices=Ring.RingSizes.choices, write_only=True)

    species_id = serializers.PrimaryKeyRelatedField(
        queryset=Species.objects.all(), source="species", write_only=True
    )
    staff_id = serializers.PrimaryKeyRelatedField(
        queryset=Scientist.objects.all(), source="staff", write_only=True
    )
    ringing_station_id = serializers.PrimaryKeyRelatedField(
        queryset=RingingStation.objects.all(), source="ringing_station", write_only=True
    )
    project_id = serializers.PrimaryKeyRelatedField(
        queryset=Project.objects.all(),
        source="project",
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = DataEntry
        fields = [
            "id",
            "species_id",
            "species",
            "ring",
            "ring_number",
            "ring_size",
            "staff",
            "staff_id",
            "ringing_station",
            "ringing_station_id",
            "project",
            "project_id",
            "net_location",
            "net_height",
            "net_direction",
            "feather_span",
            "wing_span",
            "tarsus",
            "notch_f2",
            "inner_foot",
            "weight_gram",
            "bird_status",
            "fat_deposit",
            "muscle_class",
            "age_class",
            "sex",
            "small_feather_int",
            "small_feather_app",
            "hand_wing",
            "date_time",
            "comment",
            "created",
            "updated",
            "has_hunger_stripes",
            "has_brood_patch",
            "has_cpl_plus",
            "has_mites",
        ]
        read_only_fields = ["created", "updated"]

    # Fields that describe a bird. A destroyed ring carries none of them, so
    # they are forced null for a 'ring_destroyed' Sonderart regardless of client
    # input.
    BIRD_DATA_FIELDS = (
        "age_class",
        "sex",
        "bird_status",
        "net_location",
        "net_height",
        "net_direction",
        "feather_span",
        "wing_span",
        "tarsus",
        "notch_f2",
        "inner_foot",
        "weight_gram",
        "fat_deposit",
        "muscle_class",
        "small_feather_int",
        "small_feather_app",
        "hand_wing",
    )

    def _get_or_create_ring(self, validated_data, organization):
        """Find or create the Ring *within the recording Organisation*.

        Ring uniqueness is scoped to the Organisation (ADR 0006), so the lookup
        is org-scoped too: recording a number another Organisation owns creates a
        new Ring in the recording Organisation rather than reusing the other's.
        """
        ring_number = validated_data.pop("ring_number")
        ring_size = validated_data.pop("ring_size")
        ring, _ = Ring.objects.get_or_create(
            number=ring_number, size=ring_size, organization=organization
        )
        validated_data["ring"] = ring
        return ring

    def _null_bird_data_for_destroyed_ring(self, validated_data):
        """A 'ring_destroyed' Sonderart (the 'Ring Vernichtet' marker) has no
        bird, so the backend authoritatively blanks every bird-data field,
        whatever the client sent. Ring, Beringer, Station and Datum stay
        required."""
        species = validated_data.get("species")
        if species is not None and species.special_kind == Species.SpecialKind.RING_DESTROYED:
            for field in self.BIRD_DATA_FIELDS:
                validated_data[field] = None

    def validate(self, attrs):
        """Enforce the mandatory Bemerkung for an 'unknown_species' (Aves
        ignota) capture. The unusual catch must always be described, so a blank
        comment is rejected here at the serializer layer (the model/admin stay
        unconstrained for data repair). See ADR 0004."""
        species = attrs.get("species")
        if species is None and self.instance is not None:
            species = self.instance.species
        if species is not None and species.special_kind == Species.SpecialKind.UNKNOWN_SPECIES:
            if "comment" in attrs:
                comment = attrs["comment"]
            elif self.instance is not None:
                comment = self.instance.comment
            else:
                comment = None
            if not (comment and comment.strip()):
                raise serializers.ValidationError(
                    {
                        "comment": _(
                            "Für eine unbekannte Art (Aves ignota) ist eine Bemerkung erforderlich."
                        )
                    }
                )
        return attrs

    def create(self, validated_data):
        # ``perform_create`` injects the active Organisation; the Ring is scoped
        # to it (ADR 0006).
        self._get_or_create_ring(validated_data, validated_data.get("organization"))
        self._null_bird_data_for_destroyed_ring(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        with transaction.atomic():
            old_ring = instance.ring
            new_ring = self._get_or_create_ring(
                validated_data, validated_data.get("organization", instance.organization)
            )
            self._null_bird_data_for_destroyed_ring(validated_data)
            updated_instance = super().update(instance, validated_data)
            if old_ring and old_ring != new_ring:
                if not DataEntry.objects.filter(ring=old_ring).exists():
                    old_ring.delete()

            return updated_instance


class SpeciesListSerializer(serializers.ModelSerializer):
    # Use the existing SpeciesSerializer to nest the species details
    species = SpeciesSerializer(many=True, read_only=True)

    # Use a simple PrimaryKeyRelatedField for writing/updating the species
    species_ids = serializers.PrimaryKeyRelatedField(
        queryset=Species.objects.all(), source="species", many=True, write_only=True
    )

    class Meta:
        model = SpeciesList
        fields = ["id", "name", "is_active", "species", "species_ids", "updated"]
        read_only_fields = ["id", "updated"]


class OrgEinladungSerializer(serializers.ModelSerializer):
    """An Org-Einladung as seen by the inviting Admin (issue #83).

    The Admin supplies only ``email`` and an optional ``rolle``; the Organisation,
    inviter and secret token are set server-side. The token is **never** returned —
    it is the accept-link secret and is mailed to the invitee alone.
    """

    class Meta:
        model = OrgEinladung
        fields = ["id", "email", "rolle", "accepted_at", "created"]
        read_only_fields = ["id", "accepted_at", "created"]


class MitgliedschaftSerializer(serializers.ModelSerializer):
    """A Mitgliedschaft as managed by the Organisation's Admin (issue #83).

    Only the ``rolle`` is writable (Admin ↔ Mitglied); the account it belongs to
    is fixed. The account's identifying fields are surfaced read-only so the Admin
    can recognise who they are removing or re-roling.
    """

    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    handle = serializers.SerializerMethodField()

    class Meta:
        model = Mitgliedschaft
        fields = ["id", "username", "email", "handle", "rolle", "created"]
        read_only_fields = ["id", "username", "email", "handle", "created"]

    def get_handle(self, obj):
        scientist = getattr(obj.user, "scientist", None)
        return scientist.handle if scientist is not None else None
