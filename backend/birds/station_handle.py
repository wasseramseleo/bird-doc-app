"""Server-owned derivation of a RingingStation handle (issue #118).

The handle is the Station's primary key and appears in URLs, so it is derived by
the backend from the owning Organisation + the Station name rather than supplied
by the client. Mirrors the Kürzel approach (:mod:`birds.kuerzel`): fold the name
to an ASCII slug, prefix it with the Organisation handle, and deduplicate on
collision by appending a numeric suffix — so two Stationen with the same name in
the same Organisation still get distinct handles — always respecting the field's
``max_length``.
"""

import re

from .kuerzel import _fold_to_ascii

MAX_HANDLE_LENGTH = 124


def _slugify_name(name: str) -> str:
    """Fold ``name`` to an uppercase ASCII slug (Auwald-Süd → AUWALD-SUD)."""
    folded = _fold_to_ascii(name).upper()
    return re.sub(r"[^A-Z0-9]+", "-", folded).strip("-")


def derive_station_handle(organization, name: str, *, taken) -> str:
    """Derive a unique handle for a Station from its Organisation + name.

    ``taken`` is a ``callable(handle) -> bool`` reporting whether a candidate
    handle is already used (the caller wires it to the DB). The first free
    candidate wins; on collision a ``-2``, ``-3`` … suffix is appended, and the
    base is trimmed so the suffixed handle never exceeds ``MAX_HANDLE_LENGTH``.
    """
    slug = _slugify_name(name) or "STATION"
    base = f"{organization.handle}-{slug}"[:MAX_HANDLE_LENGTH]
    if not taken(base):
        return base
    counter = 2
    while True:
        suffix = f"-{counter}"
        candidate = f"{base[: MAX_HANDLE_LENGTH - len(suffix)]}{suffix}"
        if not taken(candidate):
            return candidate
        counter += 1
