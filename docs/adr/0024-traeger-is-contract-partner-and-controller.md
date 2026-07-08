---
status: accepted
---

# The Träger is the contract partner and DSGVO controller; the Betreiber is processor

## Context

The AGB drafts said the contract is "zwischen dem Betreiber und der nutzenden
Organisation", and the DPA said "die Organisation ist Verantwortliche". But an
Organisation (CONTEXT.md) is a product tenant — "a local ringing body/group" —
and not necessarily a legal person. A loose group of hobby ringers can neither
be a contract partner nor bear DSGVO controller duties; only a natural person,
a Verein, or another Rechtsträger can. The beta audience is mixed by design:
founders may be private individuals, Vereine, or institutions, and both a
private person and a non-commercial Verein count as Verbraucher under the
KSchG.

Two structural alternatives existed for the capture data:

- **Betreiber as controller of everything** — one party (Alpine Coders e.U.)
  carries all DSGVO duties, no DPA needed; but the operator would then own the
  legal relationship to every Beringer whose name appears in another group's
  field records, and Organisationen would lose formal control over their own
  scientific data.
- **Organisation-side controllership** — the party behind each Organisation
  controls its Beringungsdaten; the Betreiber processes them strictly on
  instruction (Art. 28 DSGVO). Matches the tenant model (ADR 0005): the
  Organisation owns its data, the operator is infrastructure.

## Decision

The **Träger** of an Organisation — the founding natural person or the
Rechtsträger (Verein, institute, company) she acts for — is the AGB contract
partner and the datenschutzrechtliche **Verantwortliche** for the
Organisation's Beringungsdaten. The **Betreiber** (Alpine Coders e.U.) is the
**Auftragsverarbeiter** for those data, and itself Verantwortlicher only for
the service's own account, Warteliste/lead and technical data. The AGB define
the Träger once in the preamble and then say "die Organisation" for
readability.

Because a Träger may be a Verbraucher, all AGB clauses are drafted
**KSchG-safe** rather than B2B-only: the liability limitation keeps unlimited
liability for Vorsatz/grobe Fahrlässigkeit and Personenschäden (§ 6 Abs 1 Z 9
KSchG), and the AGB-Änderungsklausel pairs the Zustimmungsfiktion with an
explicit notice and a no-notice Kündigungsrecht.

## Consequences

- The DPA (AGB Anhang) is a real Art.-28 agreement between Träger and
  Betreiber, accepted at org founding (`accept_agb` + `agb_accepted_at`).
  Changing the role split later means renegotiating it with every existing
  Organisation — this is the hard-to-reverse part.
- The registration flow's founding person warrants that she may act for the
  Träger (AGB § 2); no schema change models the Träger — it is a legal
  construct, not a table.
- Betroffene (e.g. a no-account Beringer wanting their name removed from
  capture records) are directed to their Organisation's Träger first; the
  Betreiber acts on the Träger's instruction.
- Future B2B-only clauses (broader liability exclusions, Erfüllungsort- or
  Gerichtsstandsklauseln) must not be added casually — the consumer-safe
  posture is deliberate, not an oversight.
