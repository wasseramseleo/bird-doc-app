"""Canonical + hreflang tags for the public landing (issue #279, ADR 0009).

Built at request time from ``build_absolute_uri()`` — "which domain is
canonical" lives in the host routing, never in the code (ADR 0010). The
canonical is the page's own absolute URL without the query string (the same
value the marketing home already feeds ``og:url``); the hreflang alternates
reuse ``translate_url`` — the exact language-switch logic the DE/EN toggle's
``switch_url`` tag uses (issue #107).
"""

from django import template
from django.urls import translate_url

register = template.Library()


@register.simple_tag(takes_context=True)
def canonical_url(context):
    """The current page's absolute, self-referential canonical URL.

    ``request.path`` (not the full path): a canonical never carries tracking
    query strings. Each language variant is self-canonical — ``/en/…`` pages
    canonicalise to themselves, not to the German apex."""
    request = context["request"]
    return request.build_absolute_uri(request.path)


@register.simple_tag(takes_context=True)
def alternate_url(context, language):
    """The current page's absolute URL in ``language`` — its hreflang alternate.

    ``translate_url`` maps ``/zugang-anfragen/`` to ``/en/zugang-anfragen/``
    and back (``prefix_default_language=False``: German at the apex, English
    under ``/en/``), so the alternate cluster can never drift from the DE/EN
    toggle's destinations."""
    request = context["request"]
    return request.build_absolute_uri(translate_url(request.path, language))
