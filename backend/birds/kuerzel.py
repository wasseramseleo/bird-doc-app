"""Derivation of a Beringer's Kürzel (the short handle in records and exports).

Austrian standard: first letter of the first name + first two letters of the
surname (Filip Reiter → FRE). This is the single source of truth for the
derivation, reused by the inline-creation flow and the handle-regeneration
migration.
"""

import unicodedata


def _fold_to_ascii(value: str) -> str:
    """Fold accented letters to their base ASCII form (Müller → Muller)."""
    value = value.replace("ß", "ss").replace("ẞ", "SS")
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def derive_handle(first_name: str, last_name: str) -> str:
    first = _fold_to_ascii(first_name.strip())
    last = _fold_to_ascii(last_name.strip())
    return (first[:1] + last[:2]).upper()
