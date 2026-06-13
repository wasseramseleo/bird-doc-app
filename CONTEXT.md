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
