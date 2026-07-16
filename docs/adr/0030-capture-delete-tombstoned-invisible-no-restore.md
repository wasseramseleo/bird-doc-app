---
status: accepted
---

# A deleted capture is tombstoned, invisible to every query, and has no restore surface

## Context

A capture recorded in error had no delete path. `DataEntryViewSet` is a plain
`ModelViewSet`, so `DELETE /api/birds/data-entries/{id}/` has always existed and
is tenant-scoped — but the app offered no affordance for a **synchronisiert**
capture. Only a *nicht synchronisiert* one could be dropped, from the Heute-Seite
(`today-session.ts:181`, modal „Eintrag löschen?"). Beta feedback asks for a
delete in the capture form's edit mode.

Every other delete in this model refuses to lose capture data: deleting a Beringer
reassigns its captures to the **Gelöschter Nutzer** (ADR 0003), and a Station that
owns captures is **archived**, never deleted (ADR 0011) — both justified as "that
would orphan the captures". The capture itself is the one row where that argument
does not apply: nothing hangs off it. But a Fangdatensatz is still the crown jewel
of this app, and dropping one on a click sits badly beside those two ADRs.

## Decision

A Mitglied may delete any capture of its Organisation from the capture form's edit
mode, behind a confirm modal **and** a short „Rückgängig" snackbar. The row is
**retained** in the database behind a flag. Specifically:

- **„Löschen" is the only user-facing word.** No „Storno"/„storniert" appears in
  the UI, and the term is deliberately **absent from CONTEXT.md**: the retention is
  invisible to the user, so it is an implementation decision, not domain language —
  and the glossary stays free of implementation. The Heute-Seite's existing
  „Eintrag löschen?" wording is the precedent and is left alone. One word covers
  both acts, because the user's intent ("ich habe mich vertippt, weg damit") is
  identical and the storage difference is one they cannot see.

- **A deleted capture is invisible to every query — as if never recorded.** One
  rule, no carve-outs: dashboard aggregates (`project_stats.py:164` — the single
  root feeding every figure), the IWM export (`views.py:655`), „Letzte Fänge"
  (`views.py:163`), the Wiederfang-Historie (`views.py:200`), the Ringserie
  next-number helper (`views.py:113`, feeding both the live suggestion and the
  offline bundle) and the Erstfang-uniqueness check (`capture_service.py:253,302`)
  all skip it. The **one** deliberate exception is the **idempotency replay**
  lookup (`capture_service.py:180,296`), which must still resolve a deleted row —
  otherwise a replayed offline entry would be silently re-created after its
  deletion.

- **The ring number returns to the rope.** Deleting an Erstfang frees its number:
  the suggestion offers it again and a new Erstfang on it is accepted. The
  justification is that Löschen is for a **mis-entry** — a ring that genuinely left
  the rope without ending up on a bird already has its own record, **Ring
  vernichtet**. Using Löschen for that case is using the wrong tool.

- **No restore surface beyond the undo window.** A „Rückgängig" snackbar (~10s)
  covers the real risk, a mis-click. There is no Papierkorb, because a restore is
  **not always possible**: once the freed number has been re-issued to a new
  Erstfang, restoring the old one would put two live Erstfänge on one ring and
  violate ADR 0019. The undo window is short enough that this cannot realistically
  have happened; any longer-lived restore surface would have to resolve that
  collision. Retention therefore exists for exactly one purpose — so the Betreiber
  can recover a row from the Django admin if someone asks.

- **No deletion offline.** The button is disabled while offline. CONTEXT.md's rule
  that a synchronisiert entry is read-only offline is currently enforced in only
  one place (`today-session.ts:169`) and is bypassable via `data-entry-list.ts:114`;
  rather than lean on an invariant that is not real, the button gates itself. Making
  that invariant structural is tracked separately.

- **No new permission.** Any Mitglied may delete, matching `Rolle` ("records and
  edits captures across the whole Organisation") and the ungated Heute-Seite delete.
  A Mitglied who can already edit any capture into garbage gains no new power.

## Considered options

- **Hard delete.** Rejected — cheapest and arguably consistent (nothing hangs off a
  capture), but it forecloses recovery entirely, which sits badly beside ADR 0003
  and ADR 0011.
- **Admin-only deletion.** Rejected — a Beringer who mistypes in the field has no
  Admin at hand, and deleting is a form of editing, which a Mitglied already may do.
- **Number stays consumed after deletion.** Rejected — it would burn a real ring
  number on every typo, and it splits the rule (invisible to stats, visible to the
  rope). Ring vernichtet already covers the case where the ring truly is gone.
- **Ask at delete time ("Ist der Ring noch verwendbar?").** Rejected — most honest
  to reality, but it adds a decision to every deletion and a second deleted-flavour
  to model, query and test, for a case Ring vernichtet already serves.
- **Admin-only Papierkorb / restore view.** Rejected — makes „storniert" real domain
  language and must answer what happens when the freed number was already re-issued.
- **Queueing the deletion offline.** Rejected — contradicts the read-only-offline
  rule and raises conflict questions nobody asked for.

## Consequences

- **`unique_erstfang_per_ring` must widen.** The partial unique index at
  `models.py:862-866` is conditioned on `Q(bird_status="e")`. A deleted Erstfang
  would keep occupying that slot and permanently block re-ringing the physical ring,
  so the condition must become `Q(bird_status="e") & Q(is_cancelled=False)`, with a
  migration. Without it, `capture_service.py:253/302` reject a legitimate re-use with
  `RING_ALREADY_FIRST_CAUGHT` — the exact case this decision means to allow.
- The undo snackbar needs `.onAction()`, which has exactly one precedent in the
  codebase (`stationen.ts:129`) and no undo semantics to copy.
- The orphaned `Ring` row survives a deletion (`DataEntry.ring` is `on_delete=PROTECT`).
  It blocks nothing — Erstfang-uniqueness counts capture rows, not Rings, and
  `get_or_create_ring` reuses the row — so it is left alone.
- See the **Ringserie**, **Ring vernichtet**, **Erstfang / Wiederfang** and
  **nicht synchronisiert** entries in CONTEXT.md, sharpened by this decision.
