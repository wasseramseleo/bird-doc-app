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

from .models import DataEntry, Ring, Species


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

RING_ALREADY_FIRST_CAUGHT = _(
    "Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang."
)


def get_or_create_ring(*, number, size, organization):
    """Find or create the Ring *within the recording Organisation*.

    Ring uniqueness is scoped to the Organisation (ADR 0006), so the lookup is
    org-scoped too: recording a number another Organisation owns creates a new
    Ring in the recording Organisation rather than reusing the other's.
    """
    ring, _created = Ring.objects.get_or_create(number=number, size=size, organization=organization)
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

    validate_capture(species, comment)

    fields = dict(bird_data)
    if species is not None and species.special_kind == Species.SpecialKind.RING_DESTROYED:
        for field in BIRD_DATA_FIELDS:
            fields[field] = None

    ring = get_or_create_ring(number=ring_number, size=ring_size, organization=organization)

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
    stored_bird_status = fields.get("bird_status", DataEntry.BirdStatus.FIRST_CATCH)
    if stored_bird_status == DataEntry.BirdStatus.FIRST_CATCH:
        rival_erstfaenge = DataEntry.objects.filter(
            ring=ring, bird_status=DataEntry.BirdStatus.FIRST_CATCH
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
        # Lost the race: a concurrent request carrying the same idempotency_key
        # committed its INSERT first, so ours hit
        # ``unique_idempotency_key_per_organization``. The atomic() block above
        # already rolled back to the savepoint, leaving the connection usable, so
        # re-run the lookup and hand back the winner's row — the promised
        # idempotent behaviour, not a 500. A genuinely unrelated IntegrityError
        # (or a key-less create, which cannot hit this constraint) still has no
        # matching row here and is re-raised unchanged.
        if idempotency_key is not None:
            existing = DataEntry.objects.filter(
                idempotency_key=idempotency_key, organization=organization
            ).first()
            if existing is not None:
                return existing
        raise


def validate_capture(species, comment):
    """Check a resolved capture's creation invariants without writing anything.

    Shared by ``create_capture`` (run before the write) and the IWM importer's
    dry-run, so a preview predicts exactly the ``CaptureValidationError`` a commit
    would raise. Raises ``CaptureValidationError`` on the first violation.
    """
    _validate_aves_ignota(species, comment)


def _validate_aves_ignota(species, comment):
    """Reject an *Aves ignota* (unknown_species) capture without a Bemerkung.

    The unusual catch must always be described (ADR 0004), so a blank comment is
    refused before anything is written."""
    if species is not None and species.special_kind == Species.SpecialKind.UNKNOWN_SPECIES:
        if not (comment and comment.strip()):
            raise CaptureValidationError("comment", AVES_IGNOTA_COMMENT_REQUIRED)
