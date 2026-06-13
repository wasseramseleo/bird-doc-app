# Account-independent Beringer

## Context

A Beringer (the person recorded as responsible for a capture) was modelled as a
`Scientist` with a mandatory `OneToOne` link to a Django `User`, and the displayed
name came from `user.get_full_name()`. This meant every ringer needed a login
account. In practice, experienced helpers ring birds during a session and must be
recorded, but they have no account and won't get one.

## Decision

Decouple the Beringer from the user account:

- `Scientist.user` becomes nullable (`null=True, blank=True`) — accounts stay
  optional; logged-in ringers keep theirs.
- The name is stored directly on the Beringer as separate `first_name` +
  `last_name` fields. `full_name` resolves from these, falling back to a linked
  user when present.
- The name is split (not a single `full_name`) so the Kürzel can be derived as
  `F + first two of surname` (Filip Reiter → `FRE`) and so the inline-creation
  popup can collect name parts.
- `POST /api/birds/scientists/` is opened for **create by any authenticated user**
  (no linked account required for the *created* Beringer), so an unknown Kürzel typed
  mid-session prompts a "Neuer Beringer" dialog that creates the record. The whole API
  is `IsAuthenticated` by default, so this stays consistent with every other endpoint —
  data entry already happens logged in.

## Considered options

- **Keep accounts mandatory** — rejected: blocks recording helpers at all.
- **Free-text "ringed by" string on `DataEntry`** — rejected: helpers wouldn't be
  first-class, searchable, or reusable, and would have no stable Kürzel across
  records and exports.

## Consequences

- Beringer become first-class entities whether or not they have an account; the
  same person is reused across captures with one stable Kürzel.
- `/scientists/` gains an authenticated create endpoint (was read-only); permissions
  stay at the API-wide `IsAuthenticated` default.
- Existing handles are regenerated to the new standard via a one-off migration where
  derivable and collision-free; collisions are left for manual fix.
