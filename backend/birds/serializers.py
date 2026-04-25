from django.db import transaction
from rest_framework import serializers

from .models import (
    DataEntry,
    Organization,
    Project,
    Ring,
    RingingStation,
    Scientist,
    Species,
    SpeciesList,
)


class SpeciesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Species
        fields = ["id", "common_name_de", "common_name_en", "scientific_name", "ring_size"]


class RingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ring
        fields = ["id", "number", "size"]


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "handle", "name", "country"]


class RingingStationSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer(read_only=True)
    organization_id = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.all(), source="organization", write_only=True
    )

    class Meta:
        model = RingingStation
        fields = ["handle", "name", "organization", "organization_id"]


class ScientistSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="user.get_full_name", read_only=True)

    class Meta:
        model = Scientist
        fields = ["id", "handle", "full_name"]


class ProjectSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer(read_only=True)
    scientists = ScientistSerializer(many=True, read_only=True)
    organization_id = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.all(), source="organization", write_only=True
    )
    scientist_ids = serializers.PrimaryKeyRelatedField(
        queryset=Scientist.objects.all(),
        source="scientists",
        many=True,
        write_only=True,
        required=False,
    )

    class Meta:
        model = Project
        fields = [
            "id",
            "title",
            "description",
            "organization",
            "organization_id",
            "scientists",
            "scientist_ids",
            "created",
            "updated",
        ]
        read_only_fields = ["id", "created", "updated"]

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

    def _get_or_create_ring(self, validated_data):
        ring_number = validated_data.pop("ring_number")
        ring_size = validated_data.pop("ring_size")
        ring, _ = Ring.objects.get_or_create(number=ring_number, size=ring_size)
        validated_data["ring"] = ring
        return ring

    def create(self, validated_data):
        self._get_or_create_ring(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        with transaction.atomic():
            old_ring = instance.ring
            new_ring = self._get_or_create_ring(validated_data)
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
