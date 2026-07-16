---
status: accepted
---

# Offline-Bereitschaft covers the Version, and the app never force-reloads

## Context

The service worker is registered (`app.config.ts:35-38`) but **`SwUpdate` is injected
nowhere** — no `versionUpdates`, no `checkForUpdate()`, no `activateUpdate()`, no
`unrecoverable` handler, and no `location.reload()` anywhere in `frontend/src`. ngsw
downloads a new Version in the background; an open tab keeps serving its cached
bundle until a full reload happens by chance. A PWA left open across a multi-day
ringing trip can run an arbitrarily old Version indefinitely (issue #407).

Two facts make the obvious fix — prompt and reload — the wrong shape.

**First, a reload is destructive here in a way it is not in most apps.** There is no
autosave and no drafts; the outbox queues *saved* captures only. A half-entered
Wiederfang lives in the reactive form and nowhere else, and the Beringer entering it
is holding a bird. A reload at the wrong moment is data loss with a live animal in
hand.

**Second, `Offline-Bereitschaft` already exists** — a shipped nav-bar indicator
(`nav-bar/offline-readiness/`) and a glossary term meaning "prepared to keep working
with no network". Its three clauses were all about *data*: cache fresh, identity
cached, storage protected. So it would render a green „Offline bereit" to a device
running a two-release-old Version. That is a false all-clear at the exact moment the
Beringer is asking the question it exists to answer: *am I good to leave for the
Station?*

## Decision

**Running the current Version is a fourth clause of Offline-Bereitschaft** — not a
new concept and not a new banner. A stale Version makes a device *not* offline bereit,
however fresh its cache.

1. **"Jetzt aktualisieren" is the single control.** It already means "make this device
   current"; it now also adopts a waiting Version. One concept, one control, one place
   to look before a trip. Its two jobs are **separable in one direction**: the
   reference-cache top-up always runs unconditionally, because it is safe and
   idempotent — declining a Version must never cost the Beringer his cache refresh.
2. **Nothing is ever force-reloaded.** The indicator surfaces; the Beringer decides.
   There is no automatic `activateUpdate()`, no timed nag, no reload-on-navigation.
3. **A dirty form is confirmed first**, in the established `onReset` idiom
   (`data-entry-form.ts:1392-1417`, issue #24): pristine form adopts immediately;
   dirty form gets a `ConfirmDialogComponent`. Declining leaves the Version waiting —
   it will still be waiting after the bird is released.
4. **`unrecoverable` is shown, never acted on.** It flips the indicator to not-ready
   with its own distinct reason, and the recovery reload is offered **only when
   online**.
5. **The server can flip the indicator too.** A 404 on replay means this bundle is
   POSTing to an endpoint the server no longer has — better evidence of staleness than
   ngsw's own check (ADR 0033).

Because the reload needs a global answer to "is anyone mid-capture?", this adds the
`CanDeactivate` guard the app has never had.

## Consequences

- **`n` gets fixed as a side effect.** `app.ts:27-36` currently navigates to a fresh
  capture form on a bare keypress, destroying in-progress work with no guard. The
  `CanDeactivate` guard this decision requires closes that too — it was a latent bug,
  not a precedent.
- **"Jetzt aktualisieren" stops being free.** Today it cannot lose data; now it can,
  behind a confirm. That is the price of one control instead of two, and the reason
  the top-up was kept unconditional.
- **A device can stay stale indefinitely and that is accepted.** Voluntary means
  refusable. We would rather ship a Beringer an old Version than take a bird's
  measurements out of his hands — the replay path is defended separately, and by
  design does not depend on this (ADR 0031, ADR 0033).
- **The `unrecoverable` path will ship essentially unexercised** outside a unit test
  with a faked `SwUpdate`. That is an argument for it doing as little as possible:
  showing a state cannot itself corrupt anything.
- The indicator now carries several distinct not-ready reasons (cache, storage, stale
  Version, unrecoverable, server-observed drift). It has to say *which*, or it becomes
  a light that means "something".

## Considered options

- **Force the reload once a new Version is ready** — rejected: this is the data-loss
  case above. A bird does not wait for a page load.
- **A separate „neue Version verfügbar" banner next to `<app-beta-banner/>`** —
  rejected: it splits one question ("is this device fit for the field?") across two
  widgets, and leaves Offline-Bereitschaft's false green standing next to it.
- **Follow Angular's guidance and reload immediately on `unrecoverable`** — rejected,
  and it is worth being explicit about why, because it means ignoring the framework's
  own advice. Offline with a corrupt cache, the SW cannot serve `index.html` and there
  is no network to fetch it from: **the app does not come back**. The queued captures
  survive in IndexedDB but are sealed behind an app that will not boot, and the one
  action that could save them — synchronisieren — needs the app. A degraded-but-working
  app becomes a dead one at the exact moment it cannot be fixed. Angular's advice
  assumes a desk and a network; Illmitz is neither.
- **Block the update while a form is dirty** — rejected: it strands the Version in
  precisely the situation it is needed and gives the Beringer no way to act.
- **A server-side minimum-Version gate on replays** — rejected: it rejects old
  replays, which is exactly what ADR 0033's "always accept" forbids. The two are the
  same decision pointing opposite ways.

## See also

- **ADR 0033** — the replay path's side of the same problem, and why this decision
  cannot substitute for it.
- **ADR 0031** — why an update prompt does *not* shrink the vocabulary alias window.
- **ADR 0015** — the related operational rule (sync before importing the same period).
- The **Offline-Bereitschaft** entry in CONTEXT.md.
