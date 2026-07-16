"""The payload schema stamp and its server-side migration (ADR 0033, issue #408).

An offline capture's payload is frozen **at queue time** and lives in IndexedDB,
which outlives any bundle swap — a device can be offline ~30 days and an open PWA
tab runs an old bundle indefinitely. So a payload replayed today may speak a
contract from a month ago, and until #408 nothing detected the drift: it was
simply POSTed and either recorded (possibly misinterpreted) or 4xx'd into a
skip-and-flag loop.

What is stamped is a **payload schema version, not a build version**: a build
version churns on every release and would make every payload look drifted, so it
could only answer "has this payload drifted?" via a lookup table of which builds
changed the contract — the schema version wearing a disguise. This one rises
**only** on a contract change, which is what makes ``version ==
PAYLOAD_SCHEMA_VERSION`` a meaningful all-clear.

Migration is **server-side**, and that is not a preference: the client cannot do
it at all. The bundle replaying a June payload *is* the June bundle — it predates
July and has never heard of it, so only the server knows what the contract became.

A payload this module cannot bring onto the current contract is **never
rejected** — see ``DataEntryViewSet.create``, which holds it and alerts the
operator instead. Rejecting would strand a real capture (a 4xx is skip-and-flag);
recording would put a measurement the server admits it cannot interpret into the
Fangdaten, on its way to the Zentrale and indistinguishable from a good row.
"""

import logging
from collections.abc import Mapping

from django.conf import settings
from django.core.mail import EmailMessage

from .models import UnmigratablePayload

logger = logging.getLogger(__name__)

# The contract the current bundle speaks. Rises ONLY when the payload contract
# changes — never per release. When it does rise, the step that brings the
# previous version onto the new one belongs in ``migrate_payload`` below.
PAYLOAD_SCHEMA_VERSION = 1

# An absent stamp means the contract as it stood before stamping existed.
# Stamping is itself a contract change, so it has to tolerate its own absence
# from day one: entries queued by an already-shipped bundle carry no stamp and
# must not strand. It is deliberately the lowest version, never a sentinel, so
# the ordinary floor/ceiling check below covers it with no special case.
PRE_VERSIONING_PAYLOAD_SCHEMA_VERSION = 0

# The oldest contract still migratable. ADR 0031's invariant governs it exactly
# as it governs a vocabulary alias: it must never rise above a version the outbox
# could still be holding, or a real capture from a device left in a drawer stops
# being migratable — which is precisely the alarm ``UnmigratablePayload`` raises.
MIN_MIGRATABLE_PAYLOAD_SCHEMA_VERSION = PRE_VERSIONING_PAYLOAD_SCHEMA_VERSION

# The bounds of ``UnmigratablePayload.schema_version``, the column the holding
# area files a stamp into: a signed 32-bit ``IntegerField``. Spelled out here
# rather than read from the field, because Django derives that range from the
# *database* — Postgres reports the real 32-bit limits while SQLite reports
# 64-bit ones, and a boundary that shifts under the test suite is no boundary.
MIN_FILEABLE_PAYLOAD_SCHEMA_VERSION = -(2**31)
MAX_FILEABLE_PAYLOAD_SCHEMA_VERSION = 2**31 - 1

# The wire name of the stamp. Flat and snake_case like the rest of the write
# payload (``ring_number``, ``staff_id``, ``idempotency_key``).
SCHEMA_VERSION_FIELD = "schema_version"


class UnmigratablePayloadError(Exception):
    """A payload cannot be brought onto the current contract.

    Carries the stamp verbatim — whatever arrived, including a value that is not
    a version at all — so the holding area can record what was actually claimed
    rather than a guess.
    """

    def __init__(self, schema_version):
        self.schema_version = schema_version
        super().__init__(f"Unmigratable payload schema version: {schema_version!r}")


def read_stamp(payload):
    """The payload's claimed schema version, as it arrived.

    An absent stamp reads as the pre-versioning contract. Anything else is
    returned untouched — including a value that is not a version at all — because
    judging it is ``migrate_payload``'s job, and a malformed stamp must reach the
    holding area rather than crash the replay.

    A body that is not a mapping at all reads as unstamped: it cannot carry a
    stamp, so there is nothing to claim. Membership alone would not be enough to
    establish that — ``"schema_version" in ["schema_version"]`` is ``True``, and
    subscripting it then raises — so the shape is checked, not just the key.
    """
    if not isinstance(payload, Mapping) or SCHEMA_VERSION_FIELD not in payload:
        return PRE_VERSIONING_PAYLOAD_SCHEMA_VERSION
    return payload[SCHEMA_VERSION_FIELD]


def readable_version(stamp):
    """The stamp as a version number, or ``None`` when it is not one at all.

    The single definition of "is this a version?", shared by the migration check
    and the holding area so the two can never disagree about what a stamp says.

    ``bool`` is an ``int`` subclass, so it is excluded explicitly: without that,
    a ``True`` stamp would read as version 1 and let a nonsense claim pass for
    the current contract — the one value that must mean "all clear".

    An integer outside the fileable bounds is likewise **not** a version: no
    server ever issued one, so it is the same face as ``"banana"`` and takes the
    same exit. This is the boundary — reading it as a number here is what would
    otherwise carry it into a column that cannot hold it, and the resulting 500
    is the one answer this path may never give: ``SyncService.isRejection``
    matches 4xx only, so a 5xx reads as transient and the device replays the
    same payload forever (ADR 0033 (3): "nothing strands, nothing loops"). The
    bounds are the column's, not the contract's — widening the column would only
    move the same cliff to 2**63.
    """
    if not isinstance(stamp, int) or isinstance(stamp, bool):
        return None
    if not (MIN_FILEABLE_PAYLOAD_SCHEMA_VERSION <= stamp <= MAX_FILEABLE_PAYLOAD_SCHEMA_VERSION):
        return None
    return stamp


def migrate_payload(payload):
    """Bring one replayed payload onto the current contract, stamp removed.

    Raises ``UnmigratablePayloadError`` when it cannot — the caller answers 200
    and holds it, never a rejection.

    Unmigratable is one condition with several faces, all of which mean the same
    thing (*the server cannot say what this payload means*) and all of which must
    therefore take the same lenient exit:

    - **too old**: below ``MIN_MIGRATABLE_PAYLOAD_SCHEMA_VERSION``, i.e. from a
      contract whose migration step has since been retired. This is the case ADR
      0033 names, and today it is unreachable by construction — the floor sits at
      the pre-versioning contract, so nothing real can be below it.
    - **too new**: above ``PAYLOAD_SCHEMA_VERSION``, i.e. a contract this server
      has never heard of. Reachable only by rolling the server back behind the
      bundle its devices are still running.
    - **not a version at all**: a malformed stamp — a string, a nested object,
      or an integer so large no server could have issued it (see
      ``readable_version``). Held rather than 400'd, for the same reason as the
      others, and rather than crashing on ``int()``.

    A body that is not a mapping is none of those: it is not a capture at all, so
    it passes through untouched for the serializer to refuse with the 400 it
    always did. It must *not* take the lenient exit — that one accepts (200) and
    pays with an operator alert and a held row, which would mint alarms out of
    garbage and tell a malformed request it was recorded.
    """
    if not isinstance(payload, Mapping):
        return payload

    stamp = read_stamp(payload)
    version = readable_version(stamp)
    if version is None or not (
        MIN_MIGRATABLE_PAYLOAD_SCHEMA_VERSION <= version <= PAYLOAD_SCHEMA_VERSION
    ):
        # The error carries the stamp exactly as it arrived, not the reading of
        # it, so the holding area records what was actually claimed.
        raise UnmigratablePayloadError(stamp)

    # No contract change has landed since stamping began, so every migratable
    # version already speaks the current contract and migration is the identity.
    # The first real change adds its step here; the floor rises only once the
    # outbox can no longer be holding a payload that old (ADR 0031's invariant).
    #
    # ``.copy()``, never ``dict(payload)``: DRF hands form-encoded requests a
    # ``QueryDict``, and ``dict()`` on one lifts every value into a *list*, which
    # would quietly corrupt a payload this function is only supposed to pass
    # through. ``QueryDict.copy()`` returns a mutable QueryDict and ``dict.copy()``
    # a dict, so each keeps the shape the serializer already knows how to read.
    migrated = payload.copy()
    migrated.pop(SCHEMA_VERSION_FIELD, None)
    return migrated


def hold_unmigratable_payload(*, payload, schema_version, submitted_by):
    """Park an unmigratable payload and alert the operator (ADR 0033).

    The lenient exit from ``migrate_payload``: the capture is accepted (its
    device dequeues) but kept out of the Fangdaten, held verbatim so a human can
    judge what the server could not.

    The alert rides the operator's existing transactional channel (the one
    ``feedback_view`` uses — issue #77/#81), because this is not news an
    Org-Admin can act on: reaching here means an alias was retired early or the
    migratable floor outran the outbox's retention (ADR 0031's invariant), which
    is a defect in what we shipped, not something at the ringing station.

    The mail is best-effort, and the row is written first so it is never the
    casualty. Letting a send failure escape would be worse than the outage it
    reports: the 500 reads as transient to the replay, so the device would retry
    the same payload forever and mint a fresh held row on every attempt —
    breaking the one promise ("nothing strands, nothing loops") this path exists
    to keep. So the failure is logged rather than raised, and never merely
    swallowed: the row alone is silent evidence in an area that by design has
    nothing watching it.
    """
    held = UnmigratablePayload.objects.create(
        payload=payload,
        # Null when what arrived was not a version at all; ``payload`` keeps the
        # raw claim either way, so nothing is lost by not being able to file it.
        schema_version=readable_version(schema_version),
        submitted_by=submitted_by if submitted_by and submitted_by.is_authenticated else None,
    )

    try:
        EmailMessage(
            subject=f"BirdDoc: nicht migrierbarer Fang-Payload (Schema {schema_version!r})",
            body=(
                "Ein Gerät hat einen Fang eingereicht, den der Server nicht auf den "
                "aktuellen Payload-Kontrakt bringen konnte.\n\n"
                f"Payload-Schema-Version: {schema_version!r}\n"
                f"Aktueller Kontrakt: {PAYLOAD_SCHEMA_VERSION}\n"
                f"Ältester migrierbarer Kontrakt: {MIN_MIGRATABLE_PAYLOAD_SCHEMA_VERSION}\n"
                f"Eingereicht von: {getattr(submitted_by, 'username', '—')}\n"
                f"Verwahrt als: {held.id}\n\n"
                "Der Fang wurde angenommen (das Gerät hat ihn ausgereiht), aber NICHT "
                "in die Fangdaten geschrieben. Er liegt roh in UnmigratablePayload.\n\n"
                "Das sollte per Konstruktion nicht vorkommen: entweder wurde ein Alias "
                "bzw. ein Migrationsschritt zu früh zurückgezogen, oder die Outbox hält "
                "Payloads länger, als der Server sie migrieren kann (ADR 0031/0033)."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[settings.OPERATOR_EMAIL],
        ).send()
    except Exception:
        logger.exception(
            "Could not alert the operator about unmigratable payload %s "
            "(schema %r); it is held but unannounced.",
            held.id,
            schema_version,
        )

    return held
