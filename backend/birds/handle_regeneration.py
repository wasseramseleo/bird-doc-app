"""One-off regeneration of existing Beringer handles to the Austrian-standard Kürzel.

Reuses the single derivation in :mod:`birds.kuerzel` so the rule lives in one
place. Called from the data migration; testable in isolation by passing the
``Scientist`` model class.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass

from .kuerzel import derive_handle


@dataclass
class HandleCollision:
    """A derived Kürzel that could not be assigned safely, left for manual fix."""

    handle: str
    beringer: list


def regenerate_handles(scientist_model):
    """Regenerate Beringer handles to the Austrian standard where collision-free.

    A handle is only updated when its derived Kürzel is claimed by no other
    Beringer — neither as another Beringer's current handle nor as another
    Beringer's derived handle. Anything else is left untouched and returned as a
    :class:`HandleCollision` for deliberate manual resolution.
    """
    beringer = list(scientist_model.objects.all())
    desired = {b.pk: derive_handle(b.first_name, b.last_name) for b in beringer}
    held = {b.handle for b in beringer}
    derive_counts = Counter(handle for handle in desired.values() if handle)

    collisions = defaultdict(list)
    for b in beringer:
        target = desired[b.pk]
        if not target:
            continue  # no derivable name — leave the existing handle untouched
        if b.handle == target:
            continue  # already conforms to the standard
        if target in held or derive_counts[target] > 1:
            collisions[target].append(b)
            continue
        b.handle = target
        b.save(update_fields=["handle"])

    return [HandleCollision(handle=handle, beringer=group) for handle, group in collisions.items()]
