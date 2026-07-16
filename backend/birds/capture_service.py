"""Shared capture-creation service (issue #119).

The capture invariants — org-scoped Ring get-or-create (ADR 0006), the
*Ring Vernichtet* Sonderart bird-data null-out and the *Aves ignota* mandatory
Bemerkung (ADR 0004) — used to live only inside ``DataEntrySerializer``. The IWM
importer (issue #113) must create captures obeying exactly the same invariants
but it is not a DRF serializer and cannot reach that logic. It lives here as one
plain callable that both the serializer and the importer share, so there is a
single code path for capture creation. "Make the change easy, then make the easy
change."
"""

from django.db import IntegrityError, transaction
from django.utils.translation import gettext_lazy as _

from .models import AUW_SCHEME_CODE, DataEntry, Ring, Species, get_auw_central


class CaptureValidationError(Exception):
    """A resolved capture violates a creation invariant.

    Carries the offending ``field`` and a human, German ``message`` so a DRF
    caller can re-raise it as a field error (HTTP 400) and the IWM importer can
    report it against the offending row.
    """

    def __init__(self, field, message):
        self.field = field
        self.message = message
        super().__init__(message)


# Fields that describe a bird. A destroyed ring carries none of them, so they are
# forced null for a 'ring_destroyed' Sonderart regardless of caller input.
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

AVES_IGNOTA_COMMENT_REQUIRED = _(
    "Für eine unbekannte Art (Aves ignota) ist eine Bemerkung erforderlich."
)

# Fangmarker (ADR 0026): a Tot-Fund or Nicht-Standard-Fang must always be
# described, so a blank Bemerkung is refused when either marker is set — the same
# spirit as the Aves-ignota rule above.
MARKER_COMMENT_REQUIRED = _(
    "Bei einem Tot-Fund oder Nicht-Standard-Fang ist eine Bemerkung erforderlich."
)

# The Fangmarker (ADR 0026): capture-level booleans that flag a situation without
# replacing the Art. A Ring-vernichtet capture carries no bird to mark, so they
# are forced off for it, alongside the bird-data null-out.
FANGMARKER_FIELDS = ("is_dead_recovery", "is_non_standard")

RING_ALREADY_FIRST_CAUGHT = _(
    "Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang."
)

# The maximum length of a free-text foreign Ringgröße (ADR 0019). AUW keeps its
# short Austrian scheme codes; any other Zentrale records free text capped here.
# Must not exceed the ``Ring.size`` column width (migration 0058).
FOREIGN_RING_SIZE_MAX_LENGTH = 10

# An Erstfang or a 'Ring vernichtet' record consumes a fresh number from the
# Projekt's own rope, so it may only be issued under the Projekt-Zentrale; a
# central differing from it on those statuses is refused (ADR 0019).
STATUS_REQUIRES_PROJEKT_ZENTRALE = _(
    "Erstfänge und vernichtete Ringe müssen unter der Projekt-Zentrale erfasst werden."
)

# An AUW Größe outside the strict Austrian choice list is refused.
INVALID_AUSTRIAN_RING_SIZE = _("Keine gültige österreichische Ringgröße.")

# A foreign Größe is free text but never empty.
FOREIGN_RING_SIZE_REQUIRED = _("Für eine ausländische Zentrale ist eine Ringgröße erforderlich.")


def normalize_ring_size(size, central):
    """Validate and normalise a Ringgröße against its Zentrale (ADR 0019).

    This rule is backend-owned — it lives here, not in a UI gesture, so the DRF
    write path, an offline outbox replay and the IWM import all enforce it
    identically. Under the Austrian Vogelwarte (``AUW``) the strict Austrian
    choice list governs: a Größe outside the 28 codes is refused. Under any other
    Zentrale the Größe is free text — trimmed, uppercased and length-capped to
    ``FOREIGN_RING_SIZE_MAX_LENGTH`` — and never empty (a blank/whitespace-only
    value is refused). The single ``size`` column carries both. Raises
    ``CaptureValidationError`` (field ``ring_size``) on violation.
    """
    if central is not None and central.scheme_code == AUW_SCHEME_CODE:
        if size not in Ring.RingSizes.values:
            raise CaptureValidationError("ring_size", INVALID_AUSTRIAN_RING_SIZE)
        return size
    normalized = (size or "").strip().upper()[:FOREIGN_RING_SIZE_MAX_LENGTH]
    if not normalized:
        raise CaptureValidationError("ring_size", FOREIGN_RING_SIZE_REQUIRED)
    return normalized


def get_or_create_ring(*, number, size, organization, central=None):
    """Find or create the Ring *within the recording Organisation and Zentrale*.

    Ring uniqueness is scoped to the Organisation (ADR 0006) and, since ADR 0019,
    the Zentrale too, so the lookup is scoped by both: recording a number another
    Organisation owns creates a new Ring in the recording Organisation, and the
    same Größe+Nummer under a different Zentrale is a distinct Ring. ``central``
    is the Projekt's Zentrale on the write path (today always AUW); when it is
    left unset it resolves to the default AUW Zentrale, so every Ring carries one.
    """
    if central is None:
        central = get_auw_central()
    ring, _created = Ring.objects.get_or_create(
        number=number, size=size, organization=organization, central=central
    )
    return ring


def create_capture(
    *,
    species,
    ring_size,
    ring_number,
    staff,
    ringing_station,
    date_time,
    organization=None,
    project=None,
    central=None,
    comment=None,
    idempotency_key=None,
    **bird_data,
):
    """Create a ``DataEntry`` from resolved inputs, applying every capture
    invariant, and return it.

    The single code path for capture creation shared by ``DataEntrySerializer``
    and the IWM importer. Callers pass already-resolved objects (``species``,
    ``staff`` Beringer, ``ringing_station`` Station, owning ``organization``) plus
    the ring size + number, the ``date_time`` and any bird-data fields. The
    ``organization`` owns the capture and scopes its Ring (ADR 0006); when it is
    left unset ``DataEntry.save()`` falls back to the Station's Organisation, so
    every capture stays org-owned. In order:

    * a known ``idempotency_key`` (issue #155, PRD #152) short-circuits the
      whole call — the existing ``DataEntry`` is returned unchanged, minting no
      new Ring and running no validation, so a retried/replayed offline-outbox
      create is always safe. The key is unique per ``organization`` (mirroring
      Ring, ADR 0006), and the lookup itself is scoped the same way, so a
      freak/malicious cross-tenant key collision can never hand one
      Organisation's capture back to another's request (ADR 0005). This initial
      check is a fast path, not the safety net — two requests carrying the same
      key can both race past it before either commits (the flaky-connectivity
      retry PRD #152 exists for), so the DB's ``unique_idempotency_key_per_organization``
      constraint (migration 0053) is the actual backstop: the insert below is
      wrapped so a losing, concurrent insert catches the resulting
      ``IntegrityError`` and returns the winner's row instead of raising;
    * the mandatory-Bemerkung rule for *Aves ignota* is enforced (nothing is
      written on failure — a ``CaptureValidationError`` is raised);
    * the Ring is get-or-created scoped to ``organization`` (ADR 0006);
    * for a *Ring Vernichtet* Sonderart every bird-data field is forced null,
      whatever the caller sent (ADR 0004).
    """
    if idempotency_key is not None:
        existing = DataEntry.objects.filter(
            idempotency_key=idempotency_key, organization=organization
        ).first()
        if existing is not None:
            return existing

    # Fangmarker (ADR 0026): a Ring-vernichtet capture has no bird to mark, so
    # both markers are forced off regardless of caller input — resolved before
    # the mandatory-comment check so a marker can never demand a comment there.
    is_ring_destroyed = (
        species is not None and species.special_kind == Species.SpecialKind.RING_DESTROYED
    )
    if is_ring_destroyed:
        for field in FANGMARKER_FIELDS:
            bird_data[field] = False

    validate_capture(
        species,
        comment,
        is_dead_recovery=bool(bird_data.get("is_dead_recovery")),
        is_non_standard=bool(bird_data.get("is_non_standard")),
    )

    # Resolve the Ring's Zentrale (ADR 0019). An omitted ``central`` defaults to
    # the Projekt-Zentrale — today always AUW — so a pre-feature payload (no
    # central) behaves exactly as before: the load-bearing offline-replay
    # invariant. A capture with no Projekt falls back to the default AUW Zentrale.
    projekt_zentrale = project.central if project is not None else get_auw_central()
    if central is None:
        central = projekt_zentrale

    # Status gating (ADR 0019): an Erstfang or a 'Ring vernichtet' record draws a
    # fresh number from the Projekt's own rope, so it must be issued under the
    # Projekt-Zentrale; only a Wiederfang (recapture) may reference a foreign
    # Zentrale. A mismatch on those statuses is refused before anything is written.
    requested_bird_status = bird_data.get("bird_status", DataEntry.BirdStatus.FIRST_CATCH)
    is_erstfang = requested_bird_status == DataEntry.BirdStatus.FIRST_CATCH
    if (is_erstfang or is_ring_destroyed) and central != projekt_zentrale:
        raise CaptureValidationError("central", STATUS_REQUIRES_PROJEKT_ZENTRALE)

    # Conditional Ringgröße validation keyed to the resolved Zentrale: strict
    # Austrian choices under AUW, free text (trimmed/uppercased/capped/non-empty)
    # otherwise. Shared so offline replay and the IWM import enforce it identically.
    ring_size = normalize_ring_size(ring_size, central)

    fields = dict(bird_data)
    if is_ring_destroyed:
        for field in BIRD_DATA_FIELDS:
            fields[field] = None

    ring = get_or_create_ring(
        number=ring_number, size=ring_size, organization=organization, central=central
    )

    # A physical ring is applied to a bird exactly once, so at most one Erstfang
    # (first catch) may reference a ring within the Organisation — ring
    # uniqueness (ADR 0006). Two offline devices that each independently record
    # an Erstfang on the same number (both suggested the same "last consumed
    # + 1" while offline) converge here after the idempotency short-circuit
    # above has already let a genuine *replay* (same key) through untouched: the
    # first genuine create wins, and the second — a different device, a
    # different key — is refused so the losing device surfaces exactly one
    # flagged sync error (issue #164, PRD #152) instead of silently filing a
    # second Erstfang on one physical ring. A Wiederfang (recapture) of the ring
    # is expected and never blocked; a 'ring_destroyed' Sonderart has its
    # bird_status forced null above, so it is not an Erstfang here either.
    #
    # A row carrying *this same* idempotency_key is excluded: it is a genuine
    # replay of this very capture (a retry that slipped past the short-circuit
    # in the #155 TOCTOU race), which the DB's key-uniqueness constraint below
    # already resolves to the existing row — never a rival Erstfang.
    #
    # A **deleted** Erstfang is no rival either (ADR 0030): its number has
    # returned to the rope, so re-issuing the physical ring is exactly the case
    # Löschen exists to allow. This mirrors the widened ``unique_erstfang_per_ring``
    # index, which is the backstop behind this check-then-insert.
    stored_bird_status = fields.get("bird_status", DataEntry.BirdStatus.FIRST_CATCH)
    if stored_bird_status == DataEntry.BirdStatus.FIRST_CATCH:
        rival_erstfaenge = DataEntry.objects.filter(
            ring=ring, bird_status=DataEntry.BirdStatus.FIRST_CATCH, is_cancelled=False
        )
        if idempotency_key is not None:
            rival_erstfaenge = rival_erstfaenge.exclude(idempotency_key=idempotency_key)
        if rival_erstfaenge.exists():
            raise CaptureValidationError("ring_number", RING_ALREADY_FIRST_CAUGHT)

    try:
        with transaction.atomic():
            return DataEntry.objects.create(
                species=species,
                ring=ring,
                staff=staff,
                ringing_station=ringing_station,
                organization=organization,
                project=project,
                date_time=date_time,
                comment=comment,
                idempotency_key=idempotency_key,
                **fields,
            )
    except IntegrityError:
        # Lost a race: our INSERT hit a unique constraint a concurrent request
        # committed first past our pre-checks. The atomic() block above already
        # rolled back to the savepoint, leaving the connection usable, so we can
        # re-read to tell *which* race it was. Two are possible:
        #
        # 1. ``unique_idempotency_key_per_organization`` — a concurrent request
        #    carrying *this same* idempotency_key committed first (the #155
        #    TOCTOU replay). Re-run the lookup and hand back the winner's row —
        #    the promised idempotent behaviour, not a 500. Checked first so a
        #    genuine replay is never mis-flagged as a rival Erstfang below.
        # 2. ``unique_erstfang_per_ring`` — a *different* device raced a second
        #    Erstfang onto the same ring (AC3, issue #164): both passed the
        #    check-then-insert pre-check before either committed. Deterministically
        #    flag the loser with the same ``CaptureValidationError`` the sequential
        #    pre-check raises, so the concurrent duplicate surfaces as one sync
        #    error instead of silently double-filing one physical ring.
        #
        # A genuinely unrelated IntegrityError matches neither re-read and is
        # re-raised unchanged.
        if idempotency_key is not None:
            existing = DataEntry.objects.filter(
                idempotency_key=idempotency_key, organization=organization
            ).first()
            if existing is not None:
                return existing
        if stored_bird_status == DataEntry.BirdStatus.FIRST_CATCH:
            # ``is_cancelled=False`` mirrors the pre-check and the widened index
            # (ADR 0030): a deleted Erstfang has handed its number back, so it can
            # never be the rival that lost us this race.
            rival_erstfaenge = DataEntry.objects.filter(
                ring=ring, bird_status=DataEntry.BirdStatus.FIRST_CATCH, is_cancelled=False
            )
            if idempotency_key is not None:
                rival_erstfaenge = rival_erstfaenge.exclude(idempotency_key=idempotency_key)
            if rival_erstfaenge.exists():
                raise CaptureValidationError("ring_number", RING_ALREADY_FIRST_CAUGHT) from None
        raise


def validate_capture(species, comment, *, is_dead_recovery=False, is_non_standard=False):
    """Check a resolved capture's creation invariants without writing anything.

    Shared by ``create_capture`` (run before the write) and the IWM importer's
    dry-run, so a preview predicts exactly the ``CaptureValidationError`` a commit
    would raise. Raises ``CaptureValidationError`` on the first violation.
    """
    _validate_aves_ignota(species, comment)
    _validate_fangmarker(comment, is_dead_recovery, is_non_standard)


def _validate_aves_ignota(species, comment):
    """Reject an *Aves ignota* (unknown_species) capture without a Bemerkung.

    The unusual catch must always be described (ADR 0004), so a blank comment is
    refused before anything is written."""
    if species is not None and species.special_kind == Species.SpecialKind.UNKNOWN_SPECIES:
        if not (comment and comment.strip()):
            raise CaptureValidationError("comment", AVES_IGNOTA_COMMENT_REQUIRED)


def _validate_fangmarker(comment, is_dead_recovery, is_non_standard):
    """Reject a Tot-Fund or Nicht-Standard-Fang without a Bemerkung (ADR 0026).

    Either Fangmarker makes the Bemerkung mandatory — the special situation must
    always be described — so a blank comment is refused before anything is
    written. The caller forces the markers off for a Ring-vernichtet capture, so
    this never fires there."""
    if (is_dead_recovery or is_non_standard) and not (comment and comment.strip()):
        raise CaptureValidationError("comment", MARKER_COMMENT_REQUIRED)
