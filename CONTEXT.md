# Bird Ringing Documentation

The domain language for the bird-ringing (Beringung) field-data-entry application. One record is captured per bird caught and ringed.

## Language

**Beringer**:
A person who rings birds and is recorded as responsible for a capture. May or may not have a login account — experienced helpers ring birds too and are recorded without one.
_Avoid_: Scientist, Staff, Ringer (English)
_Code note_: the model and the `/scientists/` endpoint are historically named `Scientist` (and the form field `staff`); the domain term is **Beringer**. Renaming the code to match is a tracked follow-up.

**Kürzel**:
The short handle identifying a Beringer in records and exports. Austrian standard: first letter of the first name + first two letters of the surname (Filip Reiter → FRE).
_Avoid_: Handle, abbreviation, initials

**Gelöschter Nutzer**:
The reserved fallback Beringer (Kürzel `GELÖSCHT`) that adopts a deleted Beringer's captures so no capture data is ever lost — deleting a Beringer reassigns rather than blocks or cascades. It is hidden from the Beringer autocomplete, so it only ever receives reassigned captures and is never newly selected, and it is itself protected from deletion (deleting the sink would orphan the captures it adopted). Deletion of a Beringer is admin-only; the app offers no delete affordance. See ADR 0003.
_Avoid_: Deleted user (English), anonymous Beringer, null Beringer

**Station**:
The ringing site where a capture happens (e.g. "Linz, Botanischer Garten"). Belongs to one Organisation.
_Avoid_: Location, site

**Organisation**:
The ringing scheme / body a Station and Project belong to (e.g. IWM Linz).
_Avoid_: Org, institution

**Projekt**:
A named campaign that groups captures, scoped to one Organisation and a set of Beringer.
_Avoid_: Campaign

**Erstfang / Wiederfang**:
First capture of a bird (new ring applied) vs. a later recapture of an already-ringed bird.
_Avoid_: First catch / recatch (English), recapture

**Diesjährig**:
A bird hatched in the current calendar year (age class 3). Only diesjährige birds undergo post-juvenile Kleingefieder (small-feather) moult, so those moult fields are recorded for them alone.
_Avoid_: Juvenile, first-year

**Empfohlene Ringgröße**:
The ring size suggested by default for a species. May be absent — e.g. for species whose sexes take different sizes — and may be overridden for an individual bird when its leg dictates otherwise.
_Avoid_: Required size, fixed size, locked size

**Ringserie**:
A rope/string of sequentially-numbered rings of one Ringgröße, sliced up for use in the field. Slices are not necessarily used in number order, so a Projekt's ring numbers do **not** increase monotonically over time — a newer capture can carry a lower number than an older one. Consequently the suggested number for a new Erstfang is _last consumed + 1_: take the Projekt's most recent capture of that size that **drew a fresh number from the rope** — an Erstfang or a **Ring vernichtet** sentinel (see below) — regardless of Beringer, and add one. A Wiederfang consumes no rope number and is ignored, as is _max + 1_ (an old, higher-numbered slice must not pull the suggestion forward).
_Avoid_: Ring batch, ring series (English), rope

**Ring vernichtet**:
A destroyed-ring sentinel: a placeholder "species" recorded when a ring is taken out of service (e.g. lost, damaged, or cut off) so its number is never reused. Like an Erstfang it **draws a fresh number from the Ringserie rope**, so it counts as a consumed number when suggesting the next one; unlike a real capture it carries no bird data — the backend blanks every biometric field, keeping only Ring, Beringer, Station and Datum. Modelled as a Species flagged `is_sentinel`.
_Avoid_: Destroyed ring (English), placeholder species, dummy entry

**Fangmethode**:
How a bird was caught, recorded as an IWM code (e.g. M = Japannetz). A property of the Projekt, constant across its captures.
_Avoid_: Trap type, method (English)

**Lockmittel**:
Any lure used to attract the bird, recorded as an IWM code (e.g. N = no lure). A property of the Projekt.
_Avoid_: Bait, decoy

**Umstand**:
The circumstance under which a bird was caught, recorded as an IWM code (e.g. 25 = caught by humans for a scientific project). A property of the Projekt. Distinct from _Zustand_ (the bird's condition, a separate IWM field).
_Avoid_: Reason, condition
