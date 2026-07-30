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
with the envelope. (An optional ``context``, and the explicit Domänencodes at the
hand-written rejection sites, are the next slice — the handler only carries what
DRF already knows, and only for what it is actually asked to render: a rejection
a view builds by hand as a plain ``Response`` never reaches an exception handler.)

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

from rest_framework.settings import api_settings
from rest_framework.views import exception_handler as drf_exception_handler

# Body keys that carry a rejection of the record as a whole rather than of one
# field: DRF's own ``detail`` (a ``PermissionDenied``, a ``NotFound``, a 409) and
# its non-field validation bucket. They travel with no ``field`` — ADR 0037's
# "eine Zurückweisung ohne einzelnes Feld rendert nur das Banner".
FIELDLESS_KEYS = ("detail", api_settings.NON_FIELD_ERRORS_KEY)


def exception_handler(exc, context):
    """DRF's own handler, plus the ``errors`` envelope beside its untouched body."""
    response = drf_exception_handler(exc, context)
    if response is None or not isinstance(response.data, Mapping):
        return response
    # A fresh mapping rather than a mutation: ``response.data`` *is* the
    # exception's own ``detail``. Insertion order keeps the existing keys first
    # and ``errors`` last.
    response.data = {**response.data, "errors": _entries(response.data)}
    return response


def _entries(body):
    """Flatten a DRF error body into one ``{field, code, detail}`` entry per sentence."""
    entries = []
    _collect(body, "", entries)
    return entries


def _collect(value, path, entries):
    """Walk a DRF error body, appending one entry per sentence found.

    A nested serializer and a list field nest their errors — a mapping under the
    field key, or a mapping keyed by the offending *item index* (that is how
    ``ListField`` reports, e.g. ``{"parasites": {1: […]}}``). They are flattened to
    a stable path (``parasites[1]``, ``items[0].name``) rather than dropped, so an
    entry is always the flat ``{field, code, detail}`` the envelope promises.
    """
    if isinstance(value, str):
        # ``ErrorDetail`` is a ``str`` subclass carrying the code we are after.
        entries.append(
            {
                "field": path or None,
                "code": getattr(value, "code", None),
                "detail": str(value),
            }
        )
    elif isinstance(value, Mapping):
        for key, child in value.items():
            _collect(child, _child_path(path, key), entries)
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            # Several sentences on one field stay on that field; only a nested
            # container deepens the path with its index.
            deeper = path if isinstance(child, str) else f"{path}[{index}]"
            _collect(child, deeper, entries)
    # Anything else (a number, a boolean, ``None``) is not a rejection sentence
    # and carries nothing to say — it is skipped rather than stringified.


def _child_path(path, key):
    if isinstance(key, int):
        return f"{path}[{key}]"
    if not path:
        return "" if key in FIELDLESS_KEYS else str(key)
    return f"{path}.{key}"
