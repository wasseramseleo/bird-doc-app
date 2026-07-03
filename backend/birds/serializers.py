from django.db import transaction
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from .capture_service import (
    BIRD_DATA_FIELDS,
    CaptureValidationError,
    create_capture,
    get_or_create_ring,
    normalize_ring_size,
)
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
    get_auw_central,
)
from .permissions import is_org_admin
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


class OfflineSpeciesSerializer(SpeciesSerializer):
    """A Species row in the offline reference bundle (issue #157), carrying its
    per-Organisation usage count so the offline picker can approximate the
    most-used-first ordering ``SpeciesViewSet._order_by_usage`` gives online."""

    usage_count = serializers.IntegerField(read_only=True)

    class Meta(SpeciesSerializer.Meta):
        fields = [*SpeciesSerializer.Meta.fields, "usage_count"]


class SpeciesNormSerializer(serializers.ModelSerializer):
    """One *effective* Artennorm (PRD #245, ADR 0021), keyed by ``species_id``.

    Read-only projection of a resolved ``SpeciesNorm`` (override ?? default) for
    the per-org norms API and the offline bundle. Carries the species' common
    name so the client can name the Art in the Plausibilitätswarnung. The client
    looks up ``norms[species_id]`` on species selection, identically online and
    offline.
    """

    species_id = serializers.CharField(read_only=True)
    species_name = serializers.CharField(source="species.common_name_de", read_only=True)

    class Meta:
        model = SpeciesNorm
        fields = [
            "species_id",
            "species_name",
            "weight_mean",
            "weight_sd",
            "feather_mean",
            "feather_sd",
            "wing_mean",
            "wing_sd",
            "tarsus_mean",
            "tarsus_sd",
            "notch_f2_mean",
            "notch_f2_sd",
            "inner_foot_mean",
            "inner_foot_sd",
            "quotient_mean",
            "quotient_tolerance_pct",
            "sd_factor",
            "geschlechtsbestimmung_moeglich",
            "dj_grossgefiedermauser_moeglich",
        ]


# The tunable rule columns of an Artennorm, shared by the read projection and the
# override read/write serializer so the two never drift (PRD #245).
SPECIES_NORM_RULE_FIELDS = [
    "weight_mean",
    "weight_sd",
    "feather_mean",
    "feather_sd",
    "wing_mean",
    "wing_sd",
    "tarsus_mean",
    "tarsus_sd",
    "notch_f2_mean",
    "notch_f2_sd",
    "inner_foot_mean",
    "inner_foot_sd",
    "quotient_mean",
    "quotient_tolerance_pct",
    "sd_factor",
    "geschlechtsbestimmung_moeglich",
    "dj_grossgefiedermauser_moeglich",
]


class SpeciesNormOverrideSerializer(serializers.ModelSerializer):
    """Read/write projection of an Organisation's SpeciesNorm **override** (PRD
    #245, issue #251, ADR 0016 + ADR 0021).

    Backs the Org-Admin Artennorm editor's create/update/delete. ``organization``
    is deliberately **not** a field — the ViewSet server-sets it to the actor's
    active Organisation, so a client can neither write another tenant's override
    nor plant a globale Standard-Artennorm (``organization IS NULL``) through this
    resource. ``species_id`` addresses the Art (writable on create); every rule
    column is optional and nullable, so clearing one switches *that* check off for
    the Organisation (whole-row semantics, ADR 0021). Carries ``id`` (for the
    "Auf Standard zurücksetzen" delete) and the species common name for the list.
    """

    species_id = serializers.PrimaryKeyRelatedField(
        queryset=Species.objects.all(), source="species"
    )
    species_name = serializers.CharField(source="species.common_name_de", read_only=True)

    class Meta:
        model = SpeciesNorm
        fields = ["id", "species_id", "species_name", *SPECIES_NORM_RULE_FIELDS]


class CentralSerializer(serializers.ModelSerializer):
    """A Zentrale (EURING ringing scheme), read-only reference data (ADR 0019).

    Backs the ``/centrals/`` lookup and is nested inside a Ring on a capture GET
    so entry details can show the issuing scheme (scheme_code + name)."""

    class Meta:
        model = Central
        fields = ["id", "scheme_code", "name", "country"]


class RingSerializer(serializers.ModelSerializer):
    central = CentralSerializer(read_only=True)

    class Meta:
        model = Ring
        fields = ["id", "number", "size", "central"]


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


# Shown when an Admin tries to detach or re-point a Beringer that already owns
# captures — the freeze-once-captures invariant keeps a capture history
# attributable to a stable Beringer identity (PRD #205, issue #209).
FROZEN_BERINGER_MESSAGE = _(
    "Dieser Beringer hat bereits Fänge erfasst und kann daher nicht mehr von "
    "seinem Konto getrennt oder einem anderen Konto zugeordnet werden."
)

# Shown when the seat named by ``mitgliedschaft_id`` belongs to another
# Organisation — linking never crosses the tenant boundary (ADR 0005).
CROSS_TENANT_SEAT_MESSAGE = _("Die Mitgliedschaft gehört nicht zu deiner Organisation.")

# Shown when the seat's account is already a Beringer — the OneToOne
# ``Scientist.user`` must be free to attach.
SEAT_ALREADY_LINKED_MESSAGE = _("Dieses Konto ist bereits mit einem Beringer verknüpft.")


class ScientistSerializer(serializers.ModelSerializer):
    """A Beringer, serialized Admin-aware (PRD #205, issue #206).

    The base shape is the lean, leak-free autocomplete shape every Mitglied may
    see. **Only** for an Admin request — the requester is an Admin of their
    active Organisation, resolved from ``self.context['request']`` — are the
    account fields added: an ``is_member`` flag and, for an account-linked
    Beringer, an ``account`` block with the linked account's display name, email
    and Rolle. Any non-Admin request, and crucially any use with **no request
    context at all** (the offline reference bundle and mid-session autocomplete
    both instantiate the serializer without a request), keeps the lean shape, so
    no member data ever leaks. The account block is null-safe when the Beringer
    has no account, and its Rolle is read in the actor's *active* Organisation so
    the derivation never queries — or leaks — another tenant's data (ADR 0005).
    """

    full_name = serializers.CharField(read_only=True)
    # The Kürzel is user-facing and editable (unlike the server-owned Station
    # handle) because it flows into the IWM export. It is globally ``unique``
    # (models.py), so a deliberate duplicate on edit — or a cross-tenant create —
    # must surface as a clean German 400, never an IntegrityError 500. Declaring
    # the field with an explicit ``UniqueValidator`` (which excludes the current
    # instance on update) gives that controlled message; ``required=False`` /
    # ``allow_blank=True`` mirror the blank-able model field, so an omitted Kürzel
    # on the quick-add create is still derived server-side (idempotency intact).
    handle = serializers.CharField(
        max_length=11,
        required=False,
        allow_blank=True,
        validators=[
            UniqueValidator(
                queryset=Scientist.objects.all(),
                message=_("Dieses Kürzel ist bereits vergeben. Bitte wähle ein anderes Kürzel."),
            )
        ],
    )

    # The seat link, addressed BY SEAT (PRD #205, issue #209): a Mitgliedschaft id
    # attaches this Beringer to that seat's account (``Scientist.user`` becomes
    # ``mitgliedschaft.user``), ``null`` detaches it. Write-only and Admin-only —
    # only the IsOrgAdmin-gated PATCH honours it; the open quick-add create drops
    # it (``create`` below), keeping the create endpoint link-free. Resolved and
    # validated in ``update`` (tenant boundary, a free OneToOne, and the
    # freeze-once-captures invariant), so the field itself carries no ``source``:
    # it never maps to a model attribute, it is popped and applied by hand.
    mitgliedschaft_id = serializers.PrimaryKeyRelatedField(
        queryset=Mitgliedschaft.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )

    # Sentinel telling "field omitted" (leave the link untouched) apart from an
    # explicit ``null`` (detach) after the field is popped from ``validated_data``.
    _SEAT_UNSET = object()

    class Meta:
        model = Scientist
        fields = ["id", "handle", "first_name", "last_name", "full_name", "mitgliedschaft_id"]

    def create(self, validated_data):
        # The quick-add create is link-free (ADR 0001): a seat is only ever
        # attached through the Admin PATCH, so a ``mitgliedschaft_id`` that rode in
        # on the create payload is dropped here, keeping the idempotent quick-add a
        # pure no-account Beringer create.
        validated_data.pop("mitgliedschaft_id", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Resolve+validate the seat link in one place (PRD #205, issue #209).
        seat = validated_data.pop("mitgliedschaft_id", self._SEAT_UNSET)
        if seat is not self._SEAT_UNSET:
            self._apply_seat_link(instance, seat)
        return super().update(instance, validated_data)

    def _apply_seat_link(self, instance, mitgliedschaft):
        """Attach (``mitgliedschaft`` given) or detach (``None``) the Beringer's
        account, enforcing the freeze-once-captures invariant and, on attach, the
        tenant boundary and a free OneToOne. Sets ``instance.user``; the caller's
        ``super().update`` persists it."""
        # Freeze-once-captures: an already-linked Beringer that owns captures may be
        # neither detached nor re-pointed. Attaching a currently-unlinked Beringer
        # is always allowed, even when it owns captures (the primary workflow), so
        # the freeze only guards a change to an *existing* link.
        if instance.user_id is not None and self._owns_captures(instance):
            raise serializers.ValidationError({"mitgliedschaft_id": FROZEN_BERINGER_MESSAGE})
        if mitgliedschaft is None:
            instance.user = None
            return
        self._reject_ineligible_seat(instance, mitgliedschaft)
        instance.user = mitgliedschaft.user

    def _reject_ineligible_seat(self, instance, mitgliedschaft):
        """Refuse a cross-tenant seat, or one whose account is already a Beringer."""
        request = self.context.get("request")
        organization = active_organization(request.user) if request is not None else None
        if organization is None or mitgliedschaft.organization_id != organization.pk:
            raise serializers.ValidationError({"mitgliedschaft_id": CROSS_TENANT_SEAT_MESSAGE})
        already_linked = (
            Scientist.objects.filter(user=mitgliedschaft.user).exclude(pk=instance.pk).exists()
        )
        if already_linked:
            raise serializers.ValidationError({"mitgliedschaft_id": SEAT_ALREADY_LINKED_MESSAGE})

    @staticmethod
    def _owns_captures(instance):
        return DataEntry.objects.filter(staff=instance).exists()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        organization = self._admin_organization()
        if organization is not None:
            data["is_member"] = instance.user_id is not None
            data["account"] = self._account_block(instance, organization)
            # The count of Fänge this Beringer owns, so the Admin's delete
            # confirmation can name how many captures a delete reassigns to the
            # reserved "Gelöschter Nutzer" (PRD #205, issue #208). Admin-only —
            # it rides the same block as ``is_member``/``account`` and so never
            # appears on the lean, context-free autocomplete shape.
            data["capture_count"] = DataEntry.objects.filter(staff=instance).count()
        return data

    def _admin_organization(self):
        """The actor's active Organisation when this is an Admin request, else
        ``None``. Memoised so a ``many=True`` list resolves it once, not per row.
        """
        if not hasattr(self, "_admin_org"):
            self._admin_org = self._resolve_admin_organization()
        return self._admin_org

    def _resolve_admin_organization(self):
        request = self.context.get("request")
        if request is None:
            return None
        user = getattr(request, "user", None)
        if user is None or not is_org_admin(user):
            return None
        return active_organization(user)

    def _account_block(self, instance, organization):
        """The linked account's display name / email / Rolle, or ``None`` when the
        Beringer has no account. The Rolle is scoped to ``organization`` (the
        actor's active Organisation) so no other tenant's Rolle is ever read."""
        user = instance.user
        if user is None:
            return None
        rolle = (
            Mitgliedschaft.objects.filter(user=user, organization=organization)
            .values_list("rolle", flat=True)
            .first()
        )
        return {
            "display_name": user.get_full_name() or user.username,
            "email": user.email,
            "rolle": rolle,
        }


class ProjectSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer(read_only=True)
    scientists = ScientistSerializer(many=True, read_only=True)
    default_station = RingingStationSerializer(read_only=True)
    # The Projekt's Zentrale (ADR 0019), nested read-only so the offline bundle's
    # bundled Projekte carry the Zentrale a domestic capture defaults to (#233).
    # There is no Zentrale write path yet — it is resolved server-side (AUW today).
    central = CentralSerializer(read_only=True)
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
            "central",
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
    # The Ringgröße is validated CONDITIONALLY against the resolved Zentrale by the
    # shared capture service (strict Austrian choices under AUW, free text
    # otherwise — ADR 0019, issue #229), not by a hard-coded choice list here, so
    # a foreign free-text Größe passes field validation and the offline replay /
    # IWM import enforce the same rule. Blank is still refused at the field level.
    ring_size = serializers.CharField(write_only=True, max_length=64)
    # The Ring's Zentrale, carried FLAT as the EURING scheme_code string — stable
    # and offline-friendly, never a UUID (GET returns it nested inside ``ring``).
    # Optional: an omitted central defaults to the Projekt-Zentrale in the capture
    # service, so a pre-feature offline-outbox payload replays unchanged. An
    # unknown code is a clean 400 (SlugRelatedField ``does_not_exist``), never a 500.
    central = serializers.SlugRelatedField(
        slug_field="scheme_code",
        queryset=Central.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
        error_messages={"does_not_exist": _("Unbekannter Zentralen-Code.")},
    )

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
    # #155: declared explicitly (rather than left to ModelSerializer's
    # auto-generation) so it carries no ``UniqueValidator`` — a replayed create
    # with a known key is a deliberate, expected case handled by
    # ``create_capture()`` returning the existing record, not a validation
    # error. The DB's unique constraint (see the migration) remains the
    # backstop against a genuine collision reaching this code path.
    idempotency_key = serializers.UUIDField(required=False, allow_null=True)

    class Meta:
        model = DataEntry
        fields = [
            "id",
            "species_id",
            "species",
            "ring",
            "ring_number",
            "ring_size",
            "central",
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
            "idempotency_key",
            "created",
            "updated",
            "has_hunger_stripes",
            "has_brood_patch",
            "has_cpl_plus",
            "has_mites",
        ]
        read_only_fields = ["created", "updated"]

    def _get_or_create_ring(self, validated_data, organization):
        """Pop the ring identity from the payload and resolve the org-scoped Ring
        (ADR 0006), storing it back on ``validated_data`` for the update path.

        Delegates the get-or-create itself to the shared capture service so the
        update path uses exactly the same org- and Zentrale-scoped lookup as
        ``create``. The Ring's Zentrale is the flat ``central`` from the payload
        when given, else the Projekt's Zentrale (ADR 0019); without a Projekt it
        falls back to the default AUW. The Größe is normalised against that
        Zentrale (strict Austrian choices under AUW, free text otherwise)."""
        project = validated_data.get("project", getattr(self.instance, "project", None))
        central = validated_data.pop("central", None)
        if central is None:
            central = project.central if project is not None else get_auw_central()
        ring = get_or_create_ring(
            number=validated_data.pop("ring_number"),
            size=normalize_ring_size(validated_data.pop("ring_size"), central),
            organization=organization,
            central=central,
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
            for field in BIRD_DATA_FIELDS:
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
        # One code path for capture creation: delegate to the shared service so a
        # capture entered through the form and one created by the IWM importer
        # obey exactly the same invariants — org-scoped Ring (ADR 0006), Sonderart
        # bird-data null-out and the Aves-ignota Bemerkung (ADR 0004). Issue #119.
        # ``perform_create`` has injected the active Organisation. The Aves-ignota
        # Bemerkung is normally rejected earlier in ``validate`` (an ``is_valid``
        # field error); translating the service's error here keeps a clean 400
        # contract for any create that reaches the service directly.
        try:
            return create_capture(**validated_data)
        except CaptureValidationError as exc:
            raise serializers.ValidationError({exc.field: exc.message}) from exc

    def update(self, instance, validated_data):
        # #155: the idempotency key identifies the create attempt, not the
        # record's current content — editing an existing capture must never
        # change it, however the payload was built.
        validated_data.pop("idempotency_key", None)
        # The conditional Ringgröße validation (ADR 0019) lives in the shared
        # service and raises ``CaptureValidationError``; translate it to a clean
        # 400 here just as ``create`` does, so an edit with an invalid Größe is
        # never a 500.
        try:
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
        except CaptureValidationError as exc:
            raise serializers.ValidationError({exc.field: exc.message}) from exc


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
