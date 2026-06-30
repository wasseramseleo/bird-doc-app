"""Template helpers for the bilingual marketing surface (issue #107, ADR 0009)."""

from django import template
from django.urls import translate_url

register = template.Library()


@register.simple_tag(takes_context=True)
def switch_url(context, language):
    """The current page's URL in ``language`` — its DE/EN counterpart.

    The DE/EN toggle links to the *same* page in the other language. Reversing
    the active URL match under the target language turns ``/zugang-anfragen/``
    into ``/en/zugang-anfragen/`` and ``/`` into ``/en/`` (and back), so the
    visitor stays where they are when they switch language — no geo-routing, no
    landing back on the home."""
    request = context["request"]
    return translate_url(request.get_full_path(), language)
