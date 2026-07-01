# German copy style: Austrian standard German (Schuldeutsch)

BirdDoc's German is the **source** language (English is a translation catalog).
All German user-facing copy — marketing, auth, legal, and the in-app UI strings —
is written in **Austrian standard German** (Schuldeutsch), not Bundesdeutsch and
not dialect. This note records the conventions so Germanisms don't creep back into
new copy.

Scope: every German source string. The frontend already runs `LOCALE_ID = 'de-AT'`
(`frontend/src/app/app.config.ts`) and the backend is `de-AT`, so number/date
*formatting* is already Austrian (dates render numerically, `dd.MM.yyyy`); this
note is about **word and phrase choice** and **typography**, not locale config.

## Dashes (Gedankenstrich)

For a parenthetical break or an em-break in a sentence:

1. **Prefer restructuring.** A comma, parentheses, or a full stop is usually
   clearer than a dash. Reach for a dash only when a real break is wanted.
2. Where a break *is* wanted, use a **spaced en-dash** `–` (Halbgeviertstrich):
   `Wort – Wort`.
3. **Never** the em-dash `—` (an English convention, un-German).
4. **Never** a hyphen `-` standing in for a sentence dash (a hyphen joins words:
   `IWM-Export`, `DSGVO-konform` — that use stays).

```
today:    Vogelberingung — ein sauberer Datensatz …   ✗ em-dash
avoid:    Vogelberingung - ein sauberer Datensatz …   ✗ hyphen-as-dash
prefer:   Vogelberingung: ein sauberer Datensatz …    ✓ restructured
or:       Vogelberingung – ein sauberer Datensatz …   ✓ spaced en-dash
```

A render-seam guard enforces this on the German output: `landing/tests/
test_typography.py::test_no_em_dash_survives_in_rendered_german_pages` GETs every
German-rendered public page (home, legal, auth, lead forms) and asserts the
em-dash `—` never appears. HTML `<!-- -->` comments render into the page too, so
they are kept clear as well (the landing templates use Django `{% comment %}` /
`{# #}` blocks, which never render).

## Austrian term swaps

Written German differs from Bundesdeutsch in specific words. Use the Austrian form.
This table is the validated list — extend it as the copy audit surfaces more, and
only add an entry the operator (a native Austrian speaker) has confirmed.

| Use (AT)            | not (DE)              | Note                                   |
| ------------------- | --------------------- | -------------------------------------- |
| Jänner / Feber      | Januar / Februar      | month names (rare, dates are numeric)  |

> The audit covers marketing + auth/legal + in-app UI. Candidate swaps are proposed,
> then confirmed with the operator before landing, because the correct Austrian form
> is a native-speaker judgement, not a mechanical lookup.

## Audit log

### Landing copy sweep (issue #116)

Reviewed the whole German landing surface (marketing home, legal pages, auth and
lead-form templates, and the shared footer). Findings:

- **Typography — applied.** Every em-dash `—` in the rendered German output was
  removed: sentences were restructured to a colon, comma, or full stop, and a
  **spaced en-dash `–`** was used only where a real break was wanted (e.g.
  *Schemaweit einführen – jede Gruppe bleibt für sich*; *Kontinuität – ehrlich
  beantwortet*; *pro Organisation – nie pro Kopf*). Page-title separators were
  standardised on the middot `·` already used by the legal pages
  (*Impressum · BirdDoc*). Mirrored in the English catalog.
- **Lexis — no swaps applied.** The landing copy was already written in
  Austrian-neutral standard German; the classic Bundesdeutsch/Austrian lexical
  pairs (months, *Bub/Junge*, *Sessel/Stuhl*, *Stiege/Treppe*, …) do not occur,
  so **no word was swapped**. Conservative by design: only well-established, safe
  forms are applied without the operator, and none were both present and safe.
- **Candidate, not applied — the gender of *E-Mail*.** Austrian standard often
  treats *E-Mail* as neuter (*das E-Mail*, *ein E-Mail*), where the current copy
  uses the feminine (*eine E-Mail*). This is a genuine Austrian standard form but
  an article/gender change is exactly the native-speaker judgement this note
  reserves for the operator, so it is recorded here and **left unchanged** pending
  confirmation.
- **Positioning (not an Austrian-German matter).** The *Feld* → *Station*
  marketing reframe in the same change is a positioning decision recorded in
  ADR 0014, not a dialect swap.
