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

## Austrian term swaps

Written German differs from Bundesdeutsch in specific words. Use the Austrian form.
This table is the validated list — extend it as the copy audit surfaces more, and
only add an entry the operator (a native Austrian speaker) has confirmed.

| Use (AT)            | not (DE)              | Note                                   |
| ------------------- | --------------------- | -------------------------------------- |
| Jänner / Feber      | Januar / Februar      | month names (rare — dates are numeric) |
| _to be validated_   | _…_                   | filled during the audit                |

> The audit covers marketing + auth/legal + in-app UI. Candidate swaps are proposed,
> then confirmed with the operator before landing, because the correct Austrian form
> is a native-speaker judgement, not a mechanical lookup.
