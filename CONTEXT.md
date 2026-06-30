# Bird Ringing Documentation

The domain language for the bird-ringing (Beringung) field-data-entry application. One record is captured per bird caught and ringed.

## Language

**Beringer**:
A person who rings birds and is recorded as responsible for a capture. Belongs to exactly one Organisation, which owns the record. May or may not have a login account — experienced helpers ring birds too and are recorded without one. A Beringer **with** an account and a Mitgliedschaft is a **Mitglied**; one **without** an account is just an org-owned selectable name (no Mitgliedschaft, no Rolle, never an actor). Any Mitglied may quick-add a no-account Beringer mid-session (ADR 0001); deletion stays admin-only (ADR 0003).
_Avoid_: Scientist, Staff, Ringer (English)
_Code note_: the model and the `/scientists/` endpoint are historically named `Scientist` (and the form field `staff`); the domain term is **Beringer**. Renaming the code to match is a tracked follow-up.

**Mitglied**:
A Beringer who has a login account and a Mitgliedschaft in an Organisation — i.e. an *actor* who logs in, as opposed to a no-account Beringer (a mere selectable name). Every Mitglied is a Beringer; not every Beringer is a Mitglied.
_Avoid_: Member (English), user, account-Beringer

**Mitgliedschaft**:
The link between a Mitglied's account and an Organisation, carrying a Rolle. One account can hold several Mitgliedschaften (a Beringer may ring for more than one Organisation), so the Rolle is **per Organisation** — Admin in one, plain Mitglied in another.
_Avoid_: Membership (English), affiliation

**Rolle**:
A Mitgliedschaft's permission level within its Organisation. **Admin** manages the Organisation (invite/remove Mitglieder, manage Stationen, create/edit/delete Projekte, manage Beringer, edit the Organisation, pull the IWM export); **Mitglied** records and edits captures across the whole Organisation but cannot manage its structure. No-account Beringer have no Rolle.
_Avoid_: Role (English), permission, Berechtigung

**Zugangscode**:
The invite code that gates **org creation** — the only door through which a newcomer founds a new Organisation (and becomes its Admin) during the beta. Issued by the operator. Without a valid code there is no new Organisation. The public **Warteliste** ("Zugang anfragen" on the landing page) collects demand for codes but grants nothing by itself.
_Avoid_: Invite code (English), registration key, license key

**Org-Einladung**:
An existing Admin inviting someone into their **already-admitted** Organisation as a Mitglied. Distinct from a Zugangscode: it grows a team inside one Organisation and is **not** gated by the operator. Do not conflate the two — the operator controls Organisations, not headcount. Blocked once the Organisation's Seat-Limit is reached.
_Avoid_: Invite (unqualified), Beitritt

**Plan**:
An Organisation's licensing phase/tier and the unit of monetisation (pricing is **per Organisation**, never per head). During the public beta every Organisation is on the free `beta` plan, which carries a Seat-Limit. Organisations founded during the beta also carry a **durable beta-cohort marker** — separate from the mutable plan — that entitles them to a permanent preferential price at 1.0, honoured even after the plan later changes.
_Avoid_: Tarif, Lizenztyp, subscription

**Mitgliedsplatz**:
One member-account slot in an Organisation's Plan. Each Mitgliedschaft consumes exactly one Mitgliedsplatz; **no-account Beringer consume none** (they are mere selectable names, not actors). The Seat-Limit caps the number of Mitgliedschaften, not the number of Beringer — so an Organisation can record unlimited helpers while paying only for its login accounts.
_Avoid_: Seat (English), Lizenzplatz, Sitzplatz

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
A **local** ringing body/group — the level that owns data (e.g. IWM Linz). Also the **tenant** — the unit of data ownership and isolation: members of one Organisation see each other's captures; members of different Organisations never see each other's data. Every capture, Station and Projekt belongs to exactly one Organisation. A **national ringing authority** (e.g. the Österreichische Vogelwarte) is **not** an Organisation: it sits *above* the tenant layer as an external scheme/endorser, and the model holds **no** parent-of-Organisations entity — addressing such a body is a positioning/sales concern, not a modelled tier.
_Avoid_: Org, institution, Mandant (German for tenant — say Organisation), Tenant (English), Vogelwarte/Beringungszentrale (the national authority — not an Organisation)

**Projekt**:
A named campaign that groups captures, scoped to one Organisation and a set of Beringer.
_Avoid_: Campaign

**Erstfang / Wiederfang**:
First capture of a bird (new ring applied) vs. a later recapture of an already-ringed bird.
_Avoid_: First catch / recatch (English), recapture

**Diesjährig**:
A bird hatched in the current calendar year (age class 3). Diesjährig gates a single field — the Kleingefieder *Fortschritt* (post-juvenile small-feather moult progress, J/U/M/N), recorded for diesjährige birds alone because only a this-year bird undergoes its first post-juvenile moult. The Kleingefieder *Intensität* and the Handschwingenmauser are recorded for **all** age classes.
_Avoid_: Juvenile, first-year

**Empfohlene Ringgröße**:
The ring size suggested by default for a species. May be absent — e.g. for species whose sexes take different sizes — and may be overridden for an individual bird when its leg dictates otherwise.
_Avoid_: Required size, fixed size, locked size

**Ringserie**:
A rope/string of sequentially-numbered rings of one Ringgröße, sliced up for use in the field. Slices are not necessarily used in number order, so a Projekt's ring numbers do **not** increase monotonically over time — a newer capture can carry a lower number than an older one. Consequently the suggested number for a new Erstfang is _last consumed + 1_: take the Projekt's most recent capture of that size that **drew a fresh number from the rope** — an Erstfang or a **Ring vernichtet** sentinel (see below) — regardless of Beringer, and add one. A Wiederfang consumes no rope number and is ignored, as is _max + 1_ (an old, higher-numbered slice must not pull the suggestion forward).
_Avoid_: Ring batch, ring series (English), rope

**Sonderart**:
The umbrella term for the non-taxon `Species` rows that stand in for something other than an identified bird. Each is marked by a non-empty `special_kind` discriminator and is **always selectable**, bypassing the active Artenliste, so a rarity or a ruined ring never blocks data entry. Two kinds exist — **Ring vernichtet** (`special_kind = "ring_destroyed"`) and **Unbekannte Art / Aves ignota** (`special_kind = "unknown_species"`). The discriminator drives three behaviours independently: visibility (any Sonderart), form-collapse + server-side bird-data null-out (Ring vernichtet only), and a mandatory Bemerkung (Aves ignota only). `special_kind` supersedes the former conflated `is_sentinel` boolean — see ADR 0004.
_Avoid_: Special species, sentinel (English), pseudo-species

**Ring vernichtet**:
A destroyed-ring marker: a placeholder "species" recorded when a ring is taken out of service (e.g. lost, damaged, or cut off) so its number is never reused. Like an Erstfang it **draws a fresh number from the Ringserie rope**, so it counts as a consumed number when suggesting the next one; unlike a real capture it carries no bird data — the backend blanks every biometric field, keeping only Ring, Beringer, Station and Datum. The Sonderart with `special_kind = "ring_destroyed"`.
_Avoid_: Destroyed ring (English), placeholder species, dummy entry

**Unbekannte Art (Aves ignota)**:
A Sonderart for a **real captured bird** whose species is not on the active Artenliste (typically a rarity), so the catch can be recorded even when the list cannot name it. Unlike _Ring vernichtet_ it carries full bird data — the whole measurement form stays — and to guarantee the unusual catch is always described, the **Bemerkung is mandatory** (enforced in the form and again in `DataEntrySerializer.validate()`). The Sonderart with `special_kind = "unknown_species"`; `common_name_de = "Art nicht in der Liste (Aves ignota)"`, `scientific_name = "Aves ignota"`.
_Avoid_: Unknown bird, miscellaneous species, fremde Art

**Fangmethode**:
How a bird was caught, recorded as an IWM code (e.g. M = Japannetz). A property of the Projekt, constant across its captures.
_Avoid_: Trap type, method (English)

**Lockmittel**:
Any lure used to attract the bird, recorded as an IWM code (e.g. N = no lure). A property of the Projekt.
_Avoid_: Bait, decoy

**Umstand**:
The circumstance under which a bird was caught, recorded as an IWM code (e.g. 25 = caught by humans for a scientific project). A property of the Projekt. Distinct from _Zustand_ (the bird's condition, a separate IWM field).
_Avoid_: Reason, condition
