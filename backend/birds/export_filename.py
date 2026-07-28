"""The IWM export's *file name* — packaging, not payload (issue #429).

ADR 0023 keeps the Projekttyp out of the exported **data**: the Fangdaten sheet has
no column for it and the Meldestelle finds no trace of it. Its amendment carves out
the *packaging*: the download is **named** after the programme the Projekt runs, so
somebody running several programmes can tell their exports apart in the Downloads
folder. ``Sonstiges`` — and an unset Projekttyp, which reads as Sonstiges — gets no
prefix at all rather than the old unconditional ``IWM_``, which mislabelled every
non-IWM project. The rest of the name (``_<YYYY-MM-DD>.xlsx``) is untouched so
existing folders keep sorting.

The name is built twice: once in the Projekt's real, UTF-8 title and once folded to
pure ASCII. ``Content-Disposition`` carries both — the quoted ASCII form as the
fallback, the RFC 5987 ``filename*=UTF-8''…`` form with the real title — because a
raw umlaut in the quoted form arrives mangled („FÃ¤nge Illmitz").
"""

import datetime
import re
import unicodedata
from urllib.parse import quote

from .models import Project

# Which prefix each programme claims. A Projekttyp that is unset, blank or unknown
# is absent from this table and therefore claims nothing — the file name must not
# assert a programme the Projekt does not name.
PROJEKTTYP_PREFIXES = {
    Project.Projekttyp.IWM: "IWM_",
    Project.Projekttyp.IMS: "IMS_",
    Project.Projekttyp.ZUGVOGELMONITORING: "ZUG_",
    Project.Projekttyp.NESTLINGSBERINGUNG: "NEST_",
    Project.Projekttyp.SONSTIGES: "",
}

# What is left when a title sanitises down to nothing — never an empty name.
FALLBACK_TITLE = "Projekt"
# Long enough for any real Projekttitel, short enough to keep the whole name inside
# the ~255-byte limit common filesystems impose. Counted in characters, not bytes:
# a German title stays far below the limit, and the multi-byte scripts that could
# approach it do not occur in a Projekttitel here.
MAX_TITLE_LENGTH = 80

# Illegal on Windows and/or hostile in a shell or a header; replaced, not dropped,
# so two distinct titles stay distinguishable.
_ILLEGAL_CHARS = re.compile(r'[<>:"/\\|?*]')
_WHITESPACE_RUN = re.compile(r"\s+")
_DASH_RUN = re.compile(r"-{2,}")
# Separators that must not open or close a name (a leading dot would hide the file).
_EDGE_CHARS = " .-_"

# German letters have an established ASCII spelling; everything else falls back to
# Unicode decomposition (é → e) and, failing that, is dropped.
_ASCII_FOLDING = str.maketrans(
    {
        "ä": "ae",
        "ö": "oe",
        "ü": "ue",
        "Ä": "Ae",
        "Ö": "Oe",
        "Ü": "Ue",
        "ß": "ss",
    }
)


def _tidy(text):
    """Collapse the separator runs a substitution leaves behind, cap the length and
    trim the edges. Returns "" when nothing usable is left."""
    text = _WHITESPACE_RUN.sub(" ", text)
    text = _DASH_RUN.sub("-", text)
    return text[:MAX_TITLE_LENGTH].strip(_EDGE_CHARS)


def _strip_forbidden(text):
    """The single place that says what a file name may not carry: control
    characters and line breaks out, filesystem-illegal characters replaced. Every
    path that produces a name runs through here — including the ASCII folding,
    which would otherwise hand back what an earlier pass had already removed."""
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")
    return _ILLEGAL_CHARS.sub("-", text)


def sanitize_title(title):
    """A Projekttitel made fit for a file name: line breaks and control characters
    out, filesystem-illegal characters replaced, whitespace runs collapsed, length
    capped. A title of which nothing survives falls back to a neutral name."""
    text = _WHITESPACE_RUN.sub(" ", title or "")
    return _tidy(_strip_forbidden(text)) or FALLBACK_TITLE


def _to_ascii(text):
    """The pure-ASCII twin of an already-sanitised name, for the header's fallback
    form (which cannot carry non-ASCII).

    The folding is sanitised **again**, because decomposition re-creates the very
    characters ``sanitize_title`` took out: the fullwidth twins fold back to their
    ASCII originals (``＂`` → ``"``, ``／`` → ``/``, ``＼`` → ``\\``) and some
    abbreviation glyphs expand into them (``℅`` → ``c/o``). A quote smuggled in this
    way would close the header's quoted string early, leaving a conformant client
    with a truncated file name and a tail of garbage."""
    folded = unicodedata.normalize("NFKD", text.translate(_ASCII_FOLDING))
    folded = folded.encode("ascii", "ignore").decode("ascii")
    return _tidy(_strip_forbidden(folded)) or FALLBACK_TITLE


def _build(project, day, ascii_only):
    prefix = PROJEKTTYP_PREFIXES.get(project.projekttyp, "")
    title = sanitize_title(project.title)
    if ascii_only:
        title = _to_ascii(title)
    return f"{prefix}{title}_{day:%Y-%m-%d}.xlsx"


def iwm_export_filename(project, today=None):
    """``<Präfix><Titel>_<YYYY-MM-DD>.xlsx`` — the download's real, UTF-8 name."""
    return _build(project, today or datetime.date.today(), ascii_only=False)


def iwm_export_content_disposition(project, today=None):
    """The export's ``Content-Disposition``, carrying both name forms: the quoted
    ASCII fallback for clients that read only it, and the RFC 5987 form with the
    real title. Both are built from a sanitised name, so no title — however many
    quotes, slashes or line breaks it holds — can break the header apart. Both
    names are stamped with one and the same day, even across midnight."""
    day = today or datetime.date.today()
    fallback = _build(project, day, ascii_only=True)
    encoded = quote(_build(project, day, ascii_only=False), safe="")
    return f'attachment; filename="{fallback}"; ' + f"filename*=UTF-8''{encoded}"
