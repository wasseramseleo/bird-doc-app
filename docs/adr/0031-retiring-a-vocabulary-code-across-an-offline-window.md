---
status: accepted
---

# Retiring a vocabulary code across an offline window: migrate at rest, accept and rewrite in motion

## Context

Issue #406 retires the Parasit code `mites` in favour of `red_mites`. Rewriting
the stored rows is the obvious half. The other half is what makes it a field
problem rather than a data problem: **a client can keep sending the retired code
long after the release that retired it**, and this repeats for every future code
we rename, split or drop.

The app is an offline-first PWA used in the field, and three properties compose
into a trap:

1. **A device can be offline ~30 days.** The outbox retains queued captures that
   long (`sync.service.ts:200-201`, issue #165). The CSRF note at `:51-52` says two
   weeks; 30 days is the defensible upper bound.
2. **An old bundle runs indefinitely.** `SwUpdate` is injected nowhere, so an open
   PWA tab never learns a new bundle exists. Payloads are not versioned, so
   nothing detects the drift either.
3. **A 4xx on replay is skip-and-flag, not a retry.** A rejected capture stays in
   IndexedDB and is *skipped by every later replay* (`sync.service.ts:257-276`,
   `:132-134`) until the ringer re-saves it by hand — which he does from the **old**
   form, which still offers the retired option, which is rejected again. A loop
   only a full tab reload breaks, and nothing triggers one.

So a validation rule that rejects the retired code does not protect the data — it
strands a real capture that a ringer already recorded in the field, and blames him
for running the bundle we shipped him. Validation (ADR 0027) is still worth having;
it just cannot be the whole story.

## Decision

Retiring a vocabulary code is **three coordinated moves, not one**:

1. **At rest — migrate.** A reversible data migration rewrites every stored
   occurrence of the retired code to its successor, in place, leaving other codes
   on the same record untouched and in position (`0070_parasit_mites_to_red_mites`).
   Reversible so a rollback of the release is not a one-way door for the data.
2. **In motion — accept and rewrite.** The retired code stays a **valid input** and
   is rewritten to its successor on write, by the *same rule* as the migration.
   It lives in a **separate alias map, never as an enum member**:

   ```python
   PARASIT_ALIASES = {"mites": Parasit.RED_MITES.value}   # remove after the offline window
   ```

   Off the enum, it cannot leak into `_PARASIT_LABELS`, the UI options, or the
   export — the code is writable but never offered, never rendered, never a type.
3. **Later — remove the alias.** In a **separate release, no earlier than ~30 days**
   after the retiring one. Removing it sooner hits exactly the devices it exists
   for.

The vocabulary migration is pinned to **literal code strings, not the enum**: a
migration must reflect the vocabulary as it was at that point in history, or a
later enum edit silently changes what an old migration did.

## Consequences

- Retiring a code is cheap and safe, but it is **not done when the PR merges** — it
  carries a dated follow-up (drop the alias) that must actually happen, or the
  aliases accrete.
- For the length of the window the system accepts a code it does not offer. That
  asymmetry is deliberate: **the write path is lenient, the read/label path is
  strict.** Anything the field already recorded gets in; only the vocabulary the
  UI hands out stays clean.
- The alias makes the serializer's ChoiceField (ADR 0027) safe to add at all —
  without it, closing validation *is* the field bug described above.
- Reversibility means a bad release can be rolled back with the data intact.
- Shrinking the window (versioned payloads, or injecting `SwUpdate` so an open tab
  learns about a new bundle) would make this pattern cheaper. Neither exists today;
  until they do, ~30 days is the number.

## Considered options

- **Reject the retired code outright** — rejected: this is the trap above. It
  converts an old bundle's capture into a stranded row and a loop the ringer
  cannot escape.
- **Keep the retired code as a deprecated enum member** — rejected: everything that
  iterates the enum (`_PARASIT_LABELS`, the UI options, the export) would have to
  remember to filter it out, and each new consumer is a fresh chance to forget. The
  alias map cannot be iterated into a dropdown by accident.
- **Accept it and store it unchanged, translating on read** — rejected: the retired
  code would live in the data forever, every reader would need the mapping, and the
  migration's work would be undone by the next replay.
- **Never retire codes; only add** — rejected: the vocabulary would accumulate the
  user's superseded terms, and „Milben" alongside „Rote Milben" is precisely the
  ambiguity #406 set out to remove.

## See also

- **ADR 0027** — the Parasit field's shape and the ChoiceField this pattern makes safe.
- The **Parasit** entry in CONTEXT.md.
