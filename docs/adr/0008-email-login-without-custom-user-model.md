---
status: accepted
---

# Email as login identifier without a custom user model

## Context

Login is `username` + password (`authenticate(username=…)` in `auth_views.py`);
the stock Django `User.email` field is unused, and there is no registration,
email verification or password reset. Public signup needs **email-based
identity** — it is the natural identifier and is required for verification,
password reset and Org-Einladungen.

The clean way to make email the credential is a custom user model with
`USERNAME_FIELD = "email"`. But swapping the user model on an existing project
with live data and a `OneToOne` `Scientist.user` link is a costly, error-prone
migration.

## Decision

Use email as the login identifier **without** a custom user model: store the
email on the stock `User` and set `username = email` for new public accounts,
authenticating by email. **Existing accounts keep their current username login**
— no break for current users; emails are backfilled where known.

## Considered options

- **Custom user model with `USERNAME_FIELD = "email"`.** Rejected for now: the
  migration cost on live data and the `Scientist.user` link outweighs the
  benefit. The stock-User approach can still be moved toward this later.
- **Keep username-only login, email as a side field.** Rejected: not the modern
  expectation and leaves no natural identifier for verification/reset/invites.

## Consequences

- An email normalisation + uniqueness rule (lowercased, unique) is required so
  `username = email` stays collision-free.
- A later move to a custom user model remains possible but will still be a
  migration; this ADR records the deliberate deviation so the `username = email`
  arrangement is not "fixed" prematurely without weighing that cost.
