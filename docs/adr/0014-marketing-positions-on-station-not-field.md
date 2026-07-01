---
status: accepted
---

# Marketing copy positions on the ringing Station, not the field

## Context

The marketing home built on the shared brand layer ([ADR 0009](0009-landing-server-rendered-over-shared-brand-layer.md))
adopted a **"Feld"** framing throughout: the eyebrow *Feldjournal · Beringung*,
the lead *Feld-Dokumentation für die Beringung*, the org trust beat *Im Feld
bewährt* / *im täglichen Feldeinsatz erprobt*, the footer tagline *Feldjournal für
die Vogelberingung*, and the Open-Graph/meta title *Feldjournal für die
Vogelberingung*. The pain copy reinforced it — *"auf Papier fest und überträgst
ihn später mühsam in Excel"* — a log-on-paper-in-the-field-then-transcribe
narrative.

That picture is inaccurate. Beringer do not document out in the field beside the
Japannetz. Birds are ringed and measured **at a workstation inside the ringing
Station** — a desk with a PC/laptop — and the record is entered **live, while the
bird is in hand**. "Feld" fed exactly the misconception the operator wanted to
kill, and it undersold the product: BirdDoc replaces the whole paper-notes-plus-
later-Excel step with direct entry at the Ringtisch.

## Decision

Reposition the marketing copy off "Feld" and onto the ringing **Station** /
Ringtisch. This is deliberate and deeper than fixing one sentence:

- Rename the *Feldjournal* / *Feld-Dokumentation* framing to a station framing —
  working replacement noun **"Stationsjournal"**, exact wording finalised at
  drafting.
- Rewrite the scene: BirdDoc is used at the ringing table, live entry while the
  bird is in hand, replacing paper notes and the error-prone later transcription
  into Excel.
- Sweep every "Feld" surface: eyebrow, lead, the *Im Feld bewährt* trust beat,
  the shared footer tagline, and the OG/meta title.
- Because these are translatable strings, mirror the change in the English `.po`
  catalog and recompile/commit the `.mo`.

## Considered options

- **Keep "Feld", fix only the scene copy.** Rejected: the word "Feld" itself
  carries the bush/Japannetz connotation, so leaving *Feldjournal* / *Im Feld
  bewährt* in place would keep feeding the very misconception we set out to
  remove. (In field ornithology "Feld" does not literally mean "in a bush", but
  to a lay reader of the landing page it reads that way.)
- **Reposition fully on the Station.** Chosen: it is accurate to how Beringer
  actually work and sets up the strongest Excel-alternative argument — direct
  entry eliminates the transcription step.

## Consequences

- A brand term ("Feldjournal") introduced during the brand-layer work is
  deliberately retired. A future contributor might read "field journal for bird
  ringing" as the obvious tagline and try to restore it — this ADR records that
  its removal was intentional, not an oversight.
- The reframe reinforces the Excel-alternative USP: the station-desk scene makes
  "no transcription step" a natural, concrete error-reduction claim.
- Only the marketing/positioning copy is affected. The domain term Station is
  unchanged (see `CONTEXT.md`); this is a copy decision, not a model change.
