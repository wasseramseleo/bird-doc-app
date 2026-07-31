"""The Fehlervertrag: a machine-readable ``errors`` list beside the DRF body.

The wire carries German prose and nothing else today, so a client can only tell
one rejection from another by comparing sentences — and then every text
correction silently breaks every Abhilfe with no test firing. The information
already exists and is merely thrown away: DRF's ``ErrorDetail`` is a ``str``
subclass carrying a ``.code`` (``required``, ``blank``, ``invalid_choice``,
``max_length``, ``unique``, …), and the shipped ``EXCEPTION_HANDLER`` serialises
only the string.

One global ``EXCEPTION_HANDLER`` (``birddoc/settings.py``) gives every endpoint
those codes at once — no line of code per view. It adds the **sibling key**
``errors``: a list of ``{field, code, detail}``. ``errors`` is thereby a reserved
top-level key of a rejection body; a serializer field of that name would collide
with the envelope.

The handler carries whatever code the rejection was raised with. Where that is a
hand-written rejection of ours, the code is an explicit Domänencode from
``birds/error_codes.py`` — the catalogue a client author reads; everywhere else
it is DRF's own generic one. A rejection a view builds by hand as a plain
``Response`` never reaches an exception handler at all, so it hangs its own entry
through ``error_entry`` below.

Where a client's Abhilfe needs **data**, an optional ``context`` rides in the
entry beside the code — the colliding Erstfang travelling with
``ring_already_first_caught``. It is raised through
``ContextualValidationError`` below; every other entry has no ``context`` key at
all rather than a null one.

**Additive, never replacing** (ADR 0038). The body DRF has always sent stays byte
identical — both ``{field: [string]}`` and ``{"detail": …}``. That is the hard
constraint from ADR 0033: a device may be offline for ~30 days, so the bundle
replaying a month-old payload *is* the old bundle, and it reads exactly those two
shapes. A rejection body that is not a mapping at all (a ``ValidationError``
raised with a bare sentence outside ``is_valid`` renders as a JSON list) is left
untouched for the same reason — there is no sibling key to add to a list, and an
unknown or absent code degrades to the prose, which is the fallback ADR 0038
specifies anyway.
"""

from collections.abc import Mapping

from rest_framework.exceptions import ValidationError
from rest_framework.settings import api_settings
from rest_framework.views import exception_handler as drf_exception_handler

# Body keys that carry a rejection of the record as a whole rather than of one
# field: DRF's own ``detail`` (a ``PermissionDenied``, a ``NotFound``, a 409) and
# its non-field validation bucket. They travel with no ``field`` — ADR 0037's
# "eine Zurückweisung ohne einzelnes Feld rendert nur das Banner".
FIELDLESS_KEYS = ("detail", api_settings.NON_FIELD_ERRORS_KEY)


class ContextualValidationError(ValidationError):
    """A rejection that carries the data its Abhilfe needs (ADR 0038).

    „Ein Fehler trägt seinen Kontext selbst": where the way out needs more than a
    sentence — the colliding Erstfang behind ``ring_already_first_caught`` — it
    travels *in* the entry instead of being fetched afterwards. A second round
    trip can fail on its own, and an error about the error is the worst reachable
    outcome. Self-carrying also means fully persistable: the whole envelope is
    written onto the flagged ``OutboxEntry``, so an entry reopened days later
    shows the same complete banner with no network at all.

    DRF's ``ErrorDetail`` cannot carry it. ``exceptions._get_error_details``
    rebuilds every leaf of a detail as a plain ``ErrorDetail(text, code)``, so an
    attribute hung on a subclass of it would be dropped long before the handler
    sees it. The context therefore travels on the **exception**, keyed by the code
    it belongs to — keyed rather than positional because one ``ValidationError``
    may render several sentences, and a context belongs to a *cause*, not to a
    body.

    Only a rejection raised **outside** ``is_valid`` arrives here intact: a
    ``ValidationError`` raised inside ``run_validation`` is re-wrapped by DRF into
    a plain one. That is where the collision is raised from — ``create``/``update``
    on the capture serializer, after the field validation has passed.
    """

    def __init__(self, detail=None, code=None, context=None):
        super().__init__(detail, code)
        self.error_contexts = {} if context is None else {code: context}


def exception_handler(exc, context):
    """DRF's own handler, plus the ``errors`` envelope beside its untouched body."""
    response = drf_exception_handler(exc, context)
    if response is None or not isinstance(response.data, Mapping):
        return response
    # A fresh mapping rather than a mutation: ``response.data`` *is* the
    # exception's own ``detail``. Insertion order keeps the existing keys first
    # and ``errors`` last.
    response.data = {
        **response.data,
        "errors": _entries(response.data, getattr(exc, "error_contexts", None)),
    }
    return response


def error_entry(code, detail, field=None):
    """One ``errors`` entry, for a rejection the handler never gets to see.

    A view that answers with a hand-built ``Response`` — the IWM row cap, the
    login refusals — passes through no exception handler at all, so it hangs its
    own envelope. Going through this rather than writing the dict inline keeps the
    entry shape defined once, right beside the walker that produces every other
    one (``birds/error_codes.py`` holds the codes themselves).
    """
    return {"field": field, "code": code, "detail": str(detail)}


def _entries(body, contexts=None):
    """Flatten a DRF error body into one ``{field, code, detail}`` entry per sentence.

    ``contexts`` maps a code to the context the raise hung on it (see
    ``ContextualValidationError``); it is empty for every rejection that needs no
    data beyond its sentence.
    """
    entries = []
    _collect(body, "", entries, contexts or {})
    return entries


def _collect(value, path, entries, contexts):
    """Walk a DRF error body, appending one entry per sentence found.

    A nested serializer and a list field nest their errors — a mapping under the
    field key, or a mapping keyed by the offending *item index* (that is how
    ``ListField`` reports, e.g. ``{"parasites": {1: […]}}``). They are flattened to
    a stable path (``parasites[1]``, ``items[0].name``) rather than dropped, so an
    entry is always the flat ``{field, code, detail}`` the envelope promises.
    """
    if isinstance(value, str):
        # ``ErrorDetail`` is a ``str`` subclass carrying the code we are after.
        code = getattr(value, "code", None)
        entry = {"field": path or None, "code": code, "detail": str(value)}
        if code in contexts:
            # Absent rather than null where there is nothing to carry: a client
            # reads „kein Kontext" off the missing key, never off a ``None``.
            entry["context"] = contexts[code]
        entries.append(entry)
    elif isinstance(value, Mapping):
        for key, child in value.items():
            _collect(child, _child_path(path, key), entries, contexts)
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            # Several sentences on one field stay on that field; only a nested
            # container deepens the path with its index.
            deeper = path if isinstance(child, str) else f"{path}[{index}]"
            _collect(child, deeper, entries, contexts)
    # Anything else (a number, a boolean, ``None``) is not a rejection sentence
    # and carries nothing to say — it is skipped rather than stringified.


def _child_path(path, key):
    if isinstance(key, int):
        return f"{path}[{key}]"
    if not path:
        return "" if key in FIELDLESS_KEYS else str(key)
    return f"{path}.{key}"
