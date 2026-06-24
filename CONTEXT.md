# Bird Ringing Documentation

The domain language for the bird-ringing (Beringung) field-data-entry application. One record is captured per bird caught and ringed.

## Language

**Beringer**:
A person who rings birds and is recorded as responsible for a capture. May or may not have a login account — experienced helpers ring birds too and are recorded without one.
_Avoid_: Scientist, Staff, Ringer (English)

**Kürzel**:
The short handle identifying a Beringer in records and exports. Austrian standard: first letter of the first name + first two letters of the surname (Filip Reiter → FRE).
_Avoid_: Handle, abbreviation, initials

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

**Fangmethode**:
How a bird was caught, recorded as an IWM code (e.g. M = Japannetz). A property of the Projekt, constant across its captures.
_Avoid_: Trap type, method (English)

**Lockmittel**:
Any lure used to attract the bird, recorded as an IWM code (e.g. N = no lure). A property of the Projekt.
_Avoid_: Bait, decoy

**Umstand**:
The circumstance under which a bird was caught, recorded as an IWM code (e.g. 25 = caught by humans for a scientific project). A property of the Projekt. Distinct from _Zustand_ (the bird's condition, a separate IWM field).
_Avoid_: Reason, condition
