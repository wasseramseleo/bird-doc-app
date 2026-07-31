"""Die Domänencodes — every rejection this backend writes by hand, named once.

The Fehlervertrag has two halves. ``birds/errors.py`` builds the ``errors``
envelope and carries DRF's own generic codes along for free (``required``,
``blank``, ``invalid_choice``, ``max_length``, ``unique``, ``not_found``, …).
Those name the *condition* that tripped, never the *rule* — a Ringnummer already
first-caught and a mistyped decimal both arrived as ``invalid``. This module is
the other half: the catalogue of causes, so a client can offer an Abhilfe
(„Als Wiederfang", „freie Nummer übernehmen") off the code instead of comparing
German sentences (ADR 0038).

**A published code is a contract.** Renaming one is a break and needs the same
offline-window thinking ADR 0031 applied to a retired vocabulary: a device may be
offline ~30 days, so a bundle that learned a code a month ago is still out there
acting on it. Add codes freely; retire one only the way a vocabulary is retired.

**A code names a cause, not a call site.** Where one rule is enforced twice — the
Erstfang collision has a sequential pre-check *and* a branch that re-reads after
losing the unique-index race — both raises carry the same code.

**An unknown code degrades to the sentence.** A client that does not know a code
shows ``detail`` and offers no Abhilfe (ADR 0038), so adding one here is never a
breaking change for a client that has not learned it yet.

What is deliberately **not** here: rejections whose condition really is the
generic one DRF already names. A required field is ``required``, a taken Kürzel
is ``unique`` — the sentence may be hand-written but the cause is the condition,
and a Domänencode would only make the client's handling of it non-uniform. The
five ``error_messages`` dictionaries are the exception: each replaces the prose
*and* names a rule of this domain (a Station needs an Ortskodierung; ``ZZZ`` is
not a Zentrale), so each carries its own code.

**Two entries do not reach a client as written, both noted at their entry below.**
``last_admin`` is published on the demote path but not on the **removal** one,
whose body is a JSON list with no sibling key to hang the envelope on: reshaping
it would break the ADR 0033 byte identity a month-old bundle replays into, and
the German sentence still travels, which is ADR 0038's own fallback.
``ring_size_required_foreign`` reaches **no** wire at all — every caller is
stopped before it (the DRF field refuses a blank Größe as ``blank``; the IWM
importer's split cannot produce one), so it guards the *service seam* rather than
the client contract. Everything else here is a client-facing contract.
"""

from rest_framework.exceptions import ErrorDetail

# --- Capture-Pfad (ADR 0004, 0006, 0019, 0026) -------------------------------

# A physical ring is applied to a bird exactly once, so at most one Erstfang may
# reference a ring within the Organisation. Carries the richest Abhilfe of all:
# „Als Wiederfang erfassen" or „freie Nummer übernehmen".
RING_ALREADY_FIRST_CAUGHT = "ring_already_first_caught"

# Under the Austrian Vogelwarte the strict 28-code choice list governs the Größe.
RING_SIZE_INVALID_AUSTRIAN = "ring_size_invalid_austrian"

# Under any other Zentrale the Größe is free text — but never empty.
#
# **Reaches no client, by construction** (the second of the two exceptions named
# in the module docstring). ``DataEntrySerializer.ring_size`` is a plain
# ``CharField``: a blank Größe is DRF's own ``blank`` — the correct *condition* —
# long before ``normalize_ring_size`` runs, and the IWM importer's
# ``^([A-Za-z]+)(\d+)$`` split refuses an unsplittable Ringnummer one step earlier
# rather than handing an empty Größe on. So this code guards the **service seam**
# — ``normalize_ring_size`` is shared and public, and the next caller may well
# reach it — not the client contract, and it is asserted at that seam
# (``test_error_codes.py``) with the reason pinned through the API beside it.
RING_SIZE_REQUIRED_FOREIGN = "ring_size_required_foreign"

# An Erstfang or a 'Ring vernichtet' record draws a fresh number from the
# Projekt's own rope, so it may only be issued under the Projekt-Zentrale.
STATUS_REQUIRES_PROJEKT_ZENTRALE = "status_requires_projekt_zentrale"

# The unusual catch must always be described (Aves ignota, ADR 0004).
AVES_IGNOTA_COMMENT_REQUIRED = "aves_ignota_comment_required"

# So must a Tot-Fund or a Nicht-Standard-Fang (Fangmarker, ADR 0026) — the same
# field as above, a different rule, therefore a different code.
MARKER_COMMENT_REQUIRED = "marker_comment_required"

# The Zentrale named by the payload's EURING scheme code is unknown.
CENTRAL_UNKNOWN = "central_unknown"


# --- Stations-Stammdaten (issue #117) ----------------------------------------
# The four fields a Station cannot be created without. Their sentences are
# hand-written, so their codes are too — see the module docstring on why these
# five ``error_messages`` entries do not stay on DRF's ``required``/``blank``.

STATION_NAME_REQUIRED = "station_name_required"
STATION_PLACE_CODE_REQUIRED = "station_place_code_required"
STATION_LATITUDE_REQUIRED = "station_latitude_required"
STATION_LONGITUDE_REQUIRED = "station_longitude_required"


# --- Rechte und Tenant (ADR 0005) --------------------------------------------
# Three 403s that DRF renders identically and that ADR 0037 must tell apart: the
# way out differs, so the code has to.

# The action is Admin-only. The way out is a **named** person in the same
# Organisation — the „Freigeben lassen" Fehlerklasse.
ADMIN_ONLY = "admin_only"

# The row belongs to another Organisation. Nobody can grant a way out of this one
# (ADR 0005) — the tenant boundary is not a permission.
NOT_OWN_ORGANISATION = "not_own_organisation"

# The account has no resolvable active Organisation, so a row has no tenant to
# belong to. Distinct from ``admin_only``: it is a Mitgliedschaft that has to be
# granted, not this one action approved.
NO_ACTIVE_ORGANISATION = "no_active_organisation"

# A CSRF refusal — the same 403 with the opposite way out: press again. It is
# born inside DRF's ``SessionAuthentication``, so it is coded there
# (``birds/authentication.py``) rather than recognised from its prose here.
CSRF_FAILED = "csrf_failed"


# --- Mitgliedschaft und Einladung (issue #83) --------------------------------

# The Organisation would be left without an Admin. Published on the Rolle-Wechsel
# (``PATCH``); the **removal** path raises the same rule with a bare sentence,
# which DRF renders as a JSON *list* — a body with no sibling key to hang the
# envelope on — so there the code is set but never reaches the wire. Reshaping
# that body would break the ADR 0033 byte identity a month-old bundle replays
# into, and the German sentence still travels, which is ADR 0038's own fallback.
LAST_ADMIN = "last_admin"

# The invited email already holds a Mitgliedschaft in this Organisation.
ALREADY_MEMBER = "already_member"

# An un-accepted Einladung for this email is already reserving a Mitgliedsplatz.
INVITATION_ALREADY_PENDING = "invitation_already_pending"

# The Seat-Limit is reached (ADR 0005) — a 409. Declared as the ``default_code``
# of ``views.SeatLimitReached``; named here so the catalogue is complete.
SEAT_LIMIT_REACHED = "seat_limit_reached"


# --- Beringer und Station (PRD #205, issue #117, #208) -----------------------

# Freeze-once-captures: a linked Beringer that owns Fänge may be neither detached
# nor re-pointed, so a capture history stays attributable to a stable identity.
BERINGER_FROZEN_BY_CAPTURES = "beringer_frozen_by_captures"

# The seat named by ``mitgliedschaft_id`` belongs to another Organisation.
MITGLIEDSCHAFT_OTHER_ORGANISATION = "mitgliedschaft_other_organisation"

# The seat's account is already a Beringer — the OneToOne is taken.
ACCOUNT_ALREADY_BERINGER = "account_already_beringer"

# A Beringer linked to an account (a Mitglied) is not deleted from the Beringer
# screen — the way out is member management, so the code names the link.
BERINGER_HAS_ACCOUNT = "beringer_has_account"

# Captures reference the Station, so it is archived rather than deleted.
STATION_HAS_CAPTURES = "station_has_captures"


# --- Projekt (issue #74, #389) ------------------------------------------------

# Ein Projekt braucht mindestens eine:n Beringer:in.
PROJECT_REQUIRES_SCIENTIST = "project_requires_scientist"

# The Standard-Station belongs to another Organisation than the Projekt.
STATION_OTHER_ORGANISATION = "station_other_organisation"


# --- IWM-Import (ADR 0013, issue #125) ----------------------------------------
# Two kinds of rejection live here. The three below are **whole-file**: the
# upload never becomes a report, so they travel as an ordinary 400 with the
# ``errors`` envelope. The rest are **per-row** — the ones an Admin actually acts
# on, one per bad row — and they travel inside the report's own ``errors`` list as
# ``{row, reason, code}`` (the ``code`` additive; the Import-Dialog reads
# ``row``/``reason``). A row rejection is a rejection: leaving that list uncoded
# while every other surface names its cause is precisely the half-coded API ADR
# 0038 rules out. The report's ``warnings`` list is deliberately **not** coded —
# a Projekt-Methode divergence blocks nothing and is not a rejection.
#
# A row that fails inside the shared capture service publishes *that* service's
# code (``aves_ignota_comment_required``, ``ring_already_first_caught``, … — it
# rides on ``CaptureValidationError.code``), and an unknown Zentralen-Code in the
# „Ring" column publishes ``central_unknown``, exactly as the write path does: a
# code names a cause, not a call site. Only the causes the importer alone can
# have are named below.

# No file came with the multipart upload.
FILE_REQUIRED = "file_required"

# The upload is not a readable Datenmeldung — not a workbook, no ``Fangdaten``
# sheet, an empty sheet, or missing required columns. One cause, four sentences:
# whichever way the file is wrong, the way out is the same file, rebuilt.
IWM_FILE_UNREADABLE = "iwm_file_unreadable"

# More data rows than one import may carry. Split the file or ask an Operator:in
# for the bulk-load — nothing was written and nothing truncated.
IWM_ROW_CAP_EXCEEDED = "iwm_row_cap_exceeded"

# The row's „Ringnummer" cell is empty — nothing to identify the ring by.
IWM_ROW_RING_NUMBER_MISSING = "iwm_row_ring_number_missing"

# The Ringnummer is not a valid Austrian one: it does not split into letters +
# digits, or its leading letters are not an Austrian Ringgröße. A typo to fix.
IWM_ROW_RING_NUMBER_INVALID = "iwm_row_ring_number_invalid"

# A **foreign** Zentrale's Ringnummer in an exotic format the generic
# letters+digits split cannot take apart. A different way out from the code above:
# nothing in the file can be corrected, the entry is recorded by hand (US 23).
IWM_ROW_RING_NUMBER_UNSPLITTABLE = "iwm_row_ring_number_unsplittable"

# The row carries no Datum.
IWM_ROW_DATE_MISSING = "iwm_row_date_missing"

# Datum and/or Uhrzeit are present but not readable as a date/time — typically a
# text cell where the sheet wants a date.
IWM_ROW_DATE_INVALID = "iwm_row_date_invalid"

# The row carries no Art.
IWM_ROW_SPECIES_MISSING = "iwm_row_species_missing"

# The Art is not in the Artenliste. Distinct from the above: the cell is filled,
# the name is simply not one this backend knows.
IWM_ROW_SPECIES_UNKNOWN = "iwm_row_species_unknown"

# The row names no Beringer:in. (An *unfamiliar* Kürzel is auto-created, issue
# #121 — only an absent one is a refusal.)
IWM_ROW_BERINGER_MISSING = "iwm_row_beringer_missing"

# The row names neither Ort nor Ortskodierung, so no Station can be resolved or
# auto-created.
IWM_ROW_PLACE_MISSING = "iwm_row_place_missing"

# The unfamiliar Kürzel is already owned by a Beringer:in in another Organisation
# (``Scientist.handle`` is globally unique), so it cannot be auto-created here.
# One row is refused; the import is not aborted.
IWM_ROW_BERINGER_HANDLE_TAKEN = "iwm_row_beringer_handle_taken"


# --- Anmeldung und Sitzung (ADR 0008) -----------------------------------------

# Credentials missing or wrong — one cause, two doors.
LOGIN_FAILED = "login_failed"

# There is no session. „Neu anmelden", not „nochmal versuchen".
NOT_AUTHENTICATED = "not_authenticated"


# --- Übriges ------------------------------------------------------------------

# The Feedback-Dialog was submitted with nothing in it (issue #81).
FEEDBACK_MESSAGE_REQUIRED = "feedback_message_required"

# ``GET /rings/next-number`` was called without ``?size``. Its body is keyed
# ``error`` rather than ``detail`` — an old shape kept byte-identical.
RING_SIZE_PARAMETER_REQUIRED = "ring_size_parameter_required"

# A ``from``/``to`` query parameter is not an ISO date.
DATE_INVALID = "date_invalid"

# Not a refusal at all: a payload the server could not migrate onto today's
# contract is **accepted** (200) so the replaying device dequeues and nothing
# strands (ADR 0033). It is held raw and the operator alerted; the code names
# that outcome so the one 2xx that is not an ordinary success is machine-readable
# too, and no endpoint is left saying nothing.
UNMIGRATABLE_PAYLOAD = "unmigratable_payload"


class CodedMessage:
    """An ``error_messages`` entry that keeps its Domänencode through ``Field.fail``.

    ``fail`` looks the sentence up in ``error_messages``, interpolates it with
    ``str.format`` and raises it with the **dictionary key** as the code
    (``required``, ``blank``, ``does_not_exist``) — the generic condition, not the
    cause. Wrapping the sentence lets the Domänencode win instead: DRF reads
    ``getattr(detail, "code", default)`` immediately after ``force_str(detail)``,
    so a ``format`` that returns a coded ``ErrorDetail`` is the whole mechanism.

    The message stays lazy until it is actually rendered, so the catalog is
    resolved at raise time exactly as it is for a plain ``_()`` entry.
    """

    def __init__(self, message, code):
        self.message = message
        self.code = code

    def __str__(self):
        return str(self.message)

    def format(self, *args, **kwargs):
        return ErrorDetail(str(self.message).format(*args, **kwargs), self.code)
