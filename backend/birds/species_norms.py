"""Effective-Artennorm resolution (PRD #245, ADR 0021).

The effective norm for a species in an Organisation is the Organisation's
**override** row if one exists, else the **globale Standard-Artennorm**
(``organization IS NULL``) — resolved **whole-row**, never a per-column merge.
Shared by the per-org norms read API and the offline bundle so the client's
``norms[species_id]`` lookup is identical online and offline.
"""

from django.db.models import Q

from .models import SpeciesNorm


def effective_norms_for_organization(organization):
    """Return the resolved effective ``SpeciesNorm`` per species for one
    Organisation — the override where present, otherwise the global default.

    Species that have neither an override nor a default are absent. With no
    Organisation (no resolvable active tenant) the list is empty, mirroring the
    other org-scoped resources.
    """
    if organization is None:
        return []
    candidates = SpeciesNorm.objects.filter(
        Q(organization__isnull=True) | Q(organization=organization)
    ).select_related("species")
    by_species = {}
    for norm in candidates:
        existing = by_species.get(norm.species_id)
        # Prefer the override (organization set) as a whole row; a global default
        # only fills a species that has no override yet. Order-independent.
        if existing is None or norm.organization_id is not None:
            by_species[norm.species_id] = norm
    return list(by_species.values())
