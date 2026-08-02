# Bird Ringing Documentation

The domain language for the bird-ringing (Beringung) field-data-entry application. One record is captured per bird caught and ringed.

## Language

**Beringer**:
A person who rings birds and is recorded as responsible for a capture. Belongs to exactly one Organisation, which owns the record. May or may not have a login account — experienced helpers ring birds too and are recorded without one. A Beringer **with** an account and a Mitgliedschaft is a **Mitglied**; one **without** an account is just an org-owned selectable name (no Mitgliedschaft, no Rolle, never an actor). Any Mitglied may quick-add a no-account Beringer mid-session (ADR 0001); an Organisation's Admin otherwise manages Beringer in-app — add, edit, delete (which reassigns captures to the Gelöschter Nutzer rather than losing them, ADR 0003) and link/unlink a Beringer to a Mitgliedschaft — not only in the Django admin (ADR 0016). Deleting a Beringer that is a Mitglied goes through Mitgliedschaft (seat) management, not the Beringer surface.
_Avoid_: Scientist, Staff, Ringer (English), Wissenschaftler:in (the German form of the same slip — it reached the Projekt-Dialoge as a field label)
_Code note_: the model and the `/scientists/` endpoint are historically named `Scientist` (and the form field `staff`); the domain term is **Beringer**. Renaming the code to match is a tracked follow-up.
_Oberfläche_: the app addresses this person as **Beringer:in / Beringer:innen**. The domain term, the model and this documentation stay **Beringer**; public prose keeps its paired form (*Beringerinnen und Beringer*); the IWM file keeps its own column heading `BeringerIn`. Four spellings, one person, each with a reason — ADR 0040.

**Mitglied**:
An account that holds a Mitgliedschaft in an Organisation — i.e. an *actor* who logs in, as opposed to a no-account Beringer (a mere selectable name). Not every Beringer is a Mitglied — and a Mitgliedschaft does not by itself confer a Beringer identity: an account can hold a Mitgliedsplatz, an Organisation and a full Rolle while having no Beringer at all, and then carries no Kürzel and sees no Projekte. Two paths lead there (ADR 0016): accepting an Org-Einladung creates the Mitgliedschaft only, never a Beringer; and an Admin unlinking a capture-free Beringer from its seat leaves the account its login and Rolle but takes its Beringer identity. That state is **pending work, not an account category** — this domain has no administration-only account — and an Admin sees it listed as "Mitglieder ohne Beringer-Eintrag". Only an explicit Admin act ends it: linking an existing no-account Beringer to the seat promotes it to a Mitglied, or the Admin creates one and links it. Linking is deliberately never automatic, so the helper who has been ringing all season is reconciled with the account they were later given rather than shadowed by an auto-created duplicate. Unlinking demotes back to a no-account Beringer, and only while the Beringer owns no captures, so a recorded identity is never stripped from its account (ADR 0016).
_Avoid_: Member (English), user, account-Beringer

**Mitgliedschaft**:
The link between a Mitglied's account and an Organisation, carrying a Rolle. One account can hold several Mitgliedschaften (a Beringer may ring for more than one Organisation), so the Rolle is **per Organisation** — Admin in one, plain Mitglied in another.
_Avoid_: Membership (English), affiliation

**Rolle**:
A Mitgliedschaft's permission level within its Organisation. **Admin** manages the Organisation (invite/remove Mitglieder, manage Stationen, create/edit/delete Projekte, manage Beringer, edit the Organisation, pull the IWM export); **Mitglied** records and edits captures across the whole Organisation but cannot manage its structure. No-account Beringer have no Rolle.
_Avoid_: Role (English), permission, Berechtigung

**Betreiber**:
The party operating BirdDoc as a service — currently **Alpine Coders e.U.**, Korneuburg (Inhaber: Dipl.-Ing. Leonard Guelmino; FN 662283x). The Betreiber issues Zugangscodes, admits Organisationen and is every Träger's AGB contract partner. Under the DSGVO the Betreiber is **Auftragsverarbeiter** for an Organisation's Beringungsdaten (its Träger is the Verantwortliche) and itself **Verantwortlicher** for the service's own account, Warteliste/lead and technical data.
_Avoid_: Operator (English — prose only), Anbieter, Hersteller; "BirdDoc" as a party (the product name, not a legal person)

**Träger**:
The natural person or Rechtsträger (Verein, institute, company) legally behind an Organisation — the AGB contract partner and the datenschutzrechtliche **Verantwortliche** for the Organisation's Beringungsdaten. An Organisation is a product tenant, not necessarily a legal person: a loose group of hobby ringers can neither contract nor bear DSGVO duties, so the founding person either is the Träger herself or acts for one. The audience is mixed by design — a Träger may be a Verbraucher (a private person, or a non-commercial Verein), so AGB clauses are drafted KSchG-safe rather than B2B-only.
_Avoid_: Owner, Inhaber (that's the e.U. proprietor), "die Organisation" as a contract party

**Zugangscode**:
The invite code that gates **org creation** — the only door through which a newcomer founds a new Organisation (and becomes its Admin) during the beta. Issued by the operator. Without a valid code there is no new Organisation. The public **Warteliste** ("Zugang anfragen" on the landing page) collects demand for codes but grants nothing by itself.
_Avoid_: Invite code (English), registration key, license key

**Org-Einladung**:
An existing Admin inviting someone into their **already-admitted** Organisation as a Mitglied. Distinct from a Zugangscode: it grows a team inside one Organisation and is **not** gated by the operator. Do not conflate the two — the operator controls Organisations, not headcount. Blocked once the Organisation's Seat-Limit is reached. Accepting one yields a **Mitgliedschaft — a seat, not a Beringer**: the invitee's Beringer identity is reconciled separately, by an explicit Admin act (ADR 0016).
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
The ringing site where a capture happens (e.g. "Linz, Botanischer Garten"). Belongs to one Organisation and is managed by that Organisation's Admin (in-app, not only in the Django admin). Carries the geographic data the IWM export reads off each capture — **Ortskodierung**, Land, Region and coordinates — held on the Station, not the capture, so every capture at a site inherits one consistent location. Its identifying handle is internal and machine-derived — never the Ortskodierung, never shown to users. A Station is either **aktiv** or **archiviert**.
_Avoid_: Location, site

**Ortskodierung**:
The ringing authority's official place code for a Station (e.g. "AU03"), emitted in the IWM export. A domain-facing property of the Station, distinct from the Station's internal handle — which is machine-derived and never exported.
_Avoid_: Place code (English), Station-ID, handle

**Archivierte Station**:
A Station retired from use but preserved. Archiving hides it from the capture picker so no new capture can be filed there, while keeping it attached to its historical captures and their IWM export. Distinct from deletion: a Station that owns captures is never deleted — that would orphan them, the same principle as the Gelöschter Nutzer fallback for Beringer — it is archived instead. A Station with **no** captures may be hard-deleted outright. See ADR 0011.
_Avoid_: Deleted station, inactive site, disabled station

**Organisation**:
A **local** ringing body/group — the level that owns data (e.g. IWM Linz). Also the **tenant** — the unit of data ownership and isolation: members of one Organisation see each other's captures; members of different Organisations never see each other's data. Every capture, Station and Projekt belongs to exactly one Organisation, and the Organisation stays the **tenant-isolation boundary** for Ring uniqueness (ADR 0006, extended additively by ADR 0019). A **national ringing authority** (e.g. the Österreichische Vogelwarte) is still **not** an Organisation and sits above no tenant tier — the model holds **no** parent-of-Organisations entity. It **is**, however, now modelled additively as a **Zentrale** (the EURING scheme a Ring or Projekt was issued under) — global reference data a Ring points at, not a parent of Organisations. An earlier version of this entry claimed the Beringungszentrale was deliberately unmodelled; the Zentrale feature reverses that, without turning it into a tenant tier.
_Avoid_: Org, institution, Mandant (German for tenant — say Organisation), Tenant (English); the Vogelwarte/Beringungszentrale is a **Zentrale** (reference data), still not an Organisation

**Zentrale**:
Exactly **one EURING ringing scheme**, identified by its **EURING scheme code** (AUW = Österreichische Vogelwarte; Germany has three schemata). It names the authority under whose convention a ring was issued: foreign Wiederfänge carry rings from other countries' Zentralen, whose size-letter codes differ per scheme (an Austrian "V" is a Slovak "S"), and the IWM export's Ring column names the Zentrale of the ring's original Beringung. The full published EURING scheme list is seeded once as **global reference data like Species — never tenant-scoped**; an Organisation does not own its Zentralen. **"Scheme unknown" is not a modelled state**: a Beringer can always identify the Zentrale (searchable by name, country or code — foreign rings are inscribed with the central's address, not its code). Today every Ring and Projekt carries AUW.
_Avoid_: Central (English — the code name only), Vogelwarte/Beringungszentrale (say Zentrale), Ringzentrale, EURING-Schema (say Zentrale in prose)
_Code note_: the model is code-named `Central`; the domain term in all German prose is **Zentrale**.

**Projekt**:
A named campaign that groups captures, scoped to one Organisation and a **non-empty** set of Beringer — a Projekt is never without one, so the Beringer creating it is its first by default. Its Organisation is fixed at creation and is always the creator's active one; it is never chosen and never changes. Carries its **Zentrale** — the EURING scheme its Erstfänge are ringed under — **today always AUW** (Österreichische Vogelwarte) and backfilled for every existing Projekt. There is **no selector in project settings yet**: exposing a non-AUW Projekt-Zentrale would silently turn all of a Projekt's Erstfänge to free-text Ringgrößen, so the knob stays hidden until a second real Zentrale user exists — a one-line UI change at that point.
_Avoid_: Campaign

**Projekttyp**:
The ringing programme a Projekt runs under, chosen from a fixed single-valued list — **IWM, IMS, Zugvogelmonitoring, Nestlingsberingung, Sonstiges**. A **descriptive, internal** organising label. It **never appears in the exported data** — the Meldestelle sees no trace of it, the Fangdaten sheet has no column for it — and it **gates no capture field**. It **may, however, label the export *file***: the workbook is named `IWM_ / IMS_ / ZUG_ / NEST_` after the type, and a **Sonstiges or untyped** Projekt gets **no prefix at all** rather than an invented one (ADR 0023). An earlier version of this entry said "never exported / drives no behaviour" flatly; the rule is about the *data*, not the packaging. Optional; a Projekt with none set reads as Sonstiges.
Deliberately **decoupled from field visibility**: although Nestlingsberingung inherently uses no mist-nets, which fields a Projekt shows is the separate, manually-set **Optionale Felder** selection, never derived from the type. ADR 0023 permits the type to *seed* that selection's default at creation; that permission is deliberately **left unused** (ADR 0035), so two Projekte created the same way never differ silently — the same ruling ADR 0029 made for the Saison.
_Avoid_: Project type (English), Programm, Projektkategorie, Kategorie

**Optionale Felder**:
The capture-form fields a Projekt may switch **off**, chosen individually per Projekt from a fixed vocabulary of seven: **Brutfleck, CPL+, Hungerstreifen, Parasit, Kerbe F2, Innenfuß** and the **Netz-Block** (Netznr., Netzfach, Flugrichtung — one item, since they are only ever wanted together). Everything else the form asks for is **not** optional: the Spine (Station, Beringer, Datum, Art, Ringstatus, Zentrale, Ringgröße, Ringnummer, Bemerkung) identifies the record, and the Kern (Alter, Geschlecht, Fettvorrat, Muskel, Kleingefieder, Handschwingen, Tarsus, Teilfederlänge, Flügellänge, Gewicht) feeds the Datenmeldung and the Artennorm checks — a Projekt cannot switch those off and quietly ship an empty column (ADR 0035).
Modelled as an **opt-out**: a Projekt records only what it has switched *off*, so nothing configured means every optional field is shown, and an optional field added later appears everywhere without touching a single Projekt. **Display-only** — values already stored on historical captures are untouched and still export, exactly as the retired Netzfelder toggle behaved. Admin-only, like the rest of Projektverwaltung.
_Avoid_: Feldkonfiguration, Formularprofil, Zusatzfelder; "optionale Felder" as an all-or-nothing switch (the single toggle it replaced)

**Erstfang / Wiederfang**:
First capture of a bird (new ring applied) vs. a later recapture of an already-ringed bird. A physical ring is applied to a bird exactly once, so within an Organisation a given ring — now keyed by **(Organisation, Zentrale, Ringgröße, Nummer)** (ADR 0019, extending ADR 0006) — may be the subject of **at most one Erstfang** — a second Erstfang on the same ring is a genuine ring-uniqueness collision and is refused (`capture_service.create_capture`), while any number of Wiederfänge of that ring are expected. A **gelöschter** Erstfang does not count against this: deleting it frees the ring for a new one (ADR 0030). This is what turns two concurrent offline devices that record the same Erstfang into exactly one flagged sync error on the losing device, never a silent duplicate (issue #164). An **Erstfang** — and a **Ring vernichtet** — always carries the **Projekt-Zentrale** (AUW today), so a free-form, non-Austrian Ringgröße can only appear on a **Wiederfang** of a foreign ring; the next-number rope suggestion counts only Erstfang/Ring-vernichtet entries and so never sees a foreign size.
The pair is **not exhaustive**: a **Ring vernichtet** is neither. Its Ringstatus is one of the Vogeldaten the backend blanks, so it is **absent** — and a surface that lists captures shows that absence as such rather than defaulting to Wiederfang, which is what a two-branch Erstfang-or-else reading of the field silently does.
_Avoid_: First catch / recatch (English), recapture; "Wiederfang" as the default reading of a missing Ringstatus

**Erstnachweis**:
The **first record of an Art within a selected range** — the per-species arrival, the unit the dashboard's Ankunfts-Feed lists newest-first (capped at five). Deliberately **not an Erstfang**: an Erstfang is the first capture of an *individual bird* (a new ring), whereas an Erstnachweis is the first time a *species* shows up in the range, regardless of whether that record is itself an Erstfang or a Wiederfang. A **Sonderart is not an Art record**: Aves ignota is excluded from Erstnachweise (Ring vernichtet is excluded everywhere), so only real, identified Arten form arrivals. Each Erstnachweis carries the Art (with wissenschaftlichem Namen), the Europe/Vienna date of its first in-range record, and that record's Beringer; the dashboard badges those from the last seven days „NEU".
_Avoid_: First record (English), Erstfang (a different concept — the first capture of an individual bird), Saison-Erstfang

**Fangtag**:
A single calendar day (Europe/Vienna) on which a Projekt recorded at least one capture — the unit the dashboard groups daily figures by. A day with no capture is not a Fangtag: the daily series is sparse (only days that happened), never a padded continuous calendar. It stays a **calendar** day even where the Projekt's **Wochengrenze** falls mid-day: the Saturday a Sa-12:00 week turns on is one Fangtag, but it appears in two consecutive weekly views as two partial bars, its morning in the one and its afternoon in the other. A Fangwoche is therefore not "seven Fangtage" and the two units are deliberately not aligned.
_Avoid_: Catch day (English), Session, Fangsession

**Fänge / Individuenzahl**:
The count of captures in a set of records — every Erstfang **and** every Wiederfang, because each is a bird that was physically handled. The Ring-vernichtet Sonderart is excluded (it is not a bird); Aves ignota is included. Not deduplicated: a bird caught on three Fangtage counts three times. This is what the dashboard's "Anzahl Fänge" and the per-Fangtag Individuenzahl report. A count of *distinct* birds over a period (deduping Wiederfänge by ring) is a different, biologically stricter figure and is deliberately **not** what Individuenzahl means here.
_Avoid_: Catches (English), Fangereignis; distinct-individual count (a separate figure, not this one)

**Artenzahl**:
The number of distinct species among a set of captures (species richness). Aves ignota contributes exactly one distinct "unbekannt" category; the Ring-vernichtet Sonderart never counts. Distinct from Individuenzahl — ten Fänge of a single species are Artenzahl 1, Individuenzahl 10.
_Avoid_: Species count (English), Artenvielfalt / diversity (a plain richness count is not a diversity index)

**Saison**:
A ringing campaign period a Beringer treats as one stretch of effort (e.g. an autumn migration run). Modelled as an **optional per-Projekt recurring month window** (`saison_start_month`…`saison_end_month`, inclusive, wrap-around allowed so Nov–März spans the year boundary) — **not** a separate entity/row, and set manually per Projekt with **no Projekttyp coupling** (ADR 0029). It drives the dashboard's **„Diese Saison"** preset: in-season it shows the current occurrence up to today, off-season the most-recently-ended one. A Projekt with no window configured simply hides the preset. To the user a Saison is still only a date range over the Fangtage, never anything more than the chosen window.
_Avoid_: Season (English); year (as a synonym — a calendar year is only a rough stand-in for a Saison)

**Wochengrenze**:
The instant a Projekt's ringing week turns over — a **weekday plus a time of day** (e.g. Samstag 12:00, Europe/Vienna), set manually per Projekt beside the Saison and Admin-only, exactly like it (ADR 0029). It exists because a Beringungsbetrieb's week is a rhythm of effort, not a calendar convention: a run that goes Samstag Mittag to Samstag Mittag is one week's work, and cutting it at midnight drags the tail of the previous week into this one's figures.
It governs the dashboard's **„Diese Woche"** preset and nothing else — Heute stays a calendar day, and Monat/Jahr/Saison keep their midnight bounds (ADR 0036). „Diese Woche" means **the most recent Wochengrenze up to now**, an in-progress range like „Diese Saison" in-season, deliberately **not** the last completed week. Every Projekt has one: unconfigured means **Montag 00:00**, so the preset has a single meaning everywhere and never depends on invisible configuration. This replaced a rolling „letzte 7 Tage" range that was labelled „Letzte Woche" and was neither.
_Avoid_: Week boundary (English), Wochenwechsel, Wochenstart (it is an instant, not a date), Fangwoche (the resulting range, not the boundary)

**Diesjährig**:
A bird hatched in the current calendar year (age class 3). Diesjährig gates a single field — the Kleingefieder *Fortschritt* (post-juvenile small-feather moult progress, J/U/M/N), recorded for diesjährige birds alone because only a this-year bird undergoes its first post-juvenile moult. The Kleingefieder *Intensität* and the Handschwingenmauser are recorded for **all** age classes.
_Avoid_: Juvenile, first-year

**Fettvorrat**:
The fat reserve estimated on a captured bird, recorded as a class 0–8. Part of the **Kern** — a Projekt cannot switch it off. The app names it **Fettvorrat** on every surface; the IWM export and import keep the Meldestelle's own column heading **Fett**, which is the file format and not a label BirdDoc is free to choose. The same split as **CPL+**/Kloake.
_Avoid_: Fett (that is the export column heading, never a label), Fettklasse, Fettdepot, Fettscore, Fat (English)

**Brutfleck**:
A Ja/Nein finding on a capture: the bare, vascularised belly patch a breeding bird develops for incubation. One of the **Optionale Felder** a Projekt may switch off. Reaches the Datenmeldung twice over — its own export column **Brutfleck**, and the word „Brutfleck" appended to the exported Bemerkung. Recorded per capture, so a ring's Wiederfang-Historie also answers "was this bird breeding when we last had it?" — which is why a listing surface names it rather than burying it in the record.
_Avoid_: Brood patch (English), Bebrütungsfleck, Brutflecken (as the singular)

**CPL+**:
A Ja/Nein finding on a capture: the distended cloacal protuberance of a bird in breeding condition — the counterpart to the **Brutfleck**. Written exactly **CPL+**; the plus belongs to the name and is not a modifier. One of the **Optionale Felder**. Like the Brutfleck it reaches the Datenmeldung twice, but under the Meldestelle's own column name **Kloake** — the app's term and the file's term differ here, exactly as **Fettvorrat**/Fett do.
_Avoid_: Kloakenprotuberanz (the long form — say CPL+), CPL (without the plus), Kloake (that is the export column heading), Cloacal protuberance (English)

**Ringgröße**:
The size class of a ring, a short letter code, validated against the **known size conventions of the ring's Zentrale**. Modelled today only for **AUW** — the 28 Austrian codes, offered as a fixed choice; any **other Zentrale means free text** (trimmed, uppercased, length-capped, **never empty**), because BirdDoc does not model foreign schemes' size tables. It is one `size` field either way; the choice is conditional on the ring's Zentrale, not on a UI gesture, so the same rule serves data entry, offline sync and IWM import alike. Because an Erstfang and a Ring vernichtet always carry the Projekt-Zentrale (AUW today), a free-form, non-Austrian Ringgröße can only appear on a Wiederfang of a foreign ring.
_Avoid_: Ring size (English), Größenklasse, size code

**Empfohlene Ringgröße**:
The ring size suggested by default for a species. May be absent — e.g. for species whose sexes take different sizes — and may be overridden for an individual bird when its leg dictates otherwise. **Two-layered** like the Artennorm (ADR 0028): a global default on `Species` (reference data, also read by the public Wissen-Artenseite) plus an optional **per-Organisation override** set in the Artennormen editor. The effective value = org override ?? global default — a per-value coalesce (null override = inherit), resolved **independently** of the Artennorm's whole-row override, so setting a ring size never touches an Organisation's plausibility checks. The public Artenseite always shows the global value.
_Avoid_: Required size, fixed size, locked size

**Ringserie**:
A rope/string of sequentially-numbered rings of one Ringgröße, sliced up for use in the field. Slices are not necessarily used in number order, so a Projekt's ring numbers do **not** increase monotonically over time — a newer capture can carry a lower number than an older one. Consequently the suggested number for a new Erstfang is _last consumed + 1_: take the Projekt's most recent capture of that size that **drew a fresh number from the rope** — an Erstfang or a **Ring vernichtet** sentinel (see below) — regardless of Beringer, and add one. A Wiederfang consumes no rope number and is ignored, as is _max + 1_ (an old, higher-numbered slice must not pull the suggestion forward). A **gelöschter** Eintrag is ignored too — deleting an Erstfang hands its number back to the rope, so the suggestion offers that number again (ADR 0030).
_Avoid_: Ring batch, ring series (English), rope

**Ring-Block**:
The three fields that together designate the ring on a capture — **Zentrale, Ringgröße, Ringnummer**. Named as a unit because the app supplies all three wherever it can: the Projekt-Zentrale on an Erstfang, the Art's Empfohlene Ringgröße, and the next number off the Ringserie rope. What the app supplied, the Beringer does not retype — so the block is the stretch of the capture form a keyboard run passes *through* rather than works on, and a field in it earns attention only where the app had nothing to put. Beyond the block that reasoning stops: Alter and Geschlecht carry app-set defaults too, but they are answers the Beringer owes for every bird. The mirrored counterpart is the **Netz-Block**, one item in the Optionale Felder because *its* three fields are only ever wanted together.
_Avoid_: Ringfelder, Ringgruppe, Ring section (English); the Netz-Block (a different block, and a switchable one)

**Sonderart**:
The umbrella term for the non-taxon `Species` rows that stand in for something other than an identified bird. Each is marked by a non-empty `special_kind` discriminator and is **always selectable**, bypassing the active Artenliste, so a rarity or a ruined ring never blocks data entry. Two kinds exist — **Ring vernichtet** (`special_kind = "ring_destroyed"`) and **Unbekannte Art / Aves ignota** (`special_kind = "unknown_species"`). The discriminator drives three behaviours independently: visibility (any Sonderart), form-collapse + server-side bird-data null-out (Ring vernichtet only), and a mandatory Bemerkung (Aves ignota only). `special_kind` supersedes the former conflated `is_sentinel` boolean — see ADR 0004.
Distinct from a **Fangmarker** (Tot-Fund, Nicht-Standard-Fang), which flags a
situation on an otherwise fully-identified capture *without* replacing the Art
(ADR 0026).
_Avoid_: Special species, sentinel (English), pseudo-species

**Ring vernichtet**:
A destroyed-ring marker: a placeholder "species" recorded when a ring is taken out of service (e.g. lost, damaged, or cut off) so its number is never reused. Like an Erstfang it **draws a fresh number from the Ringserie rope**, so it counts as a consumed number when suggesting the next one; unlike a real capture it carries no Vogeldaten — the backend blanks every bird-data field, keeping only Ring, Beringer, Station and Datum. That set is wider than the biometry: the **Ringstatus**, Alter, Geschlecht and the Netz-Block go with it, so a Ring vernichtet is **neither Erstfang noch Wiederfang** and its Ringstatus is absent rather than defaulted. The Sonderart with `special_kind = "ring_destroyed"`.
It is the right record whenever a ring physically leaves the rope without ending up on a bird. **Deleting** a capture is a different act: it hands the number back to the rope for re-use (ADR 0030), so a ring that is genuinely gone must be recorded as Ring vernichtet, never deleted away.
_Avoid_: Destroyed ring (English), placeholder species, dummy entry

**Unbekannte Art (Aves ignota)**:
A Sonderart for a **real captured bird** whose species is not on the active Artenliste (typically a rarity), so the catch can be recorded even when the list cannot name it. Unlike _Ring vernichtet_ it carries full bird data — the whole measurement form stays — and to guarantee the unusual catch is always described, the **Bemerkung is mandatory** (enforced in the form and again in `DataEntrySerializer.validate()`). The Sonderart with `special_kind = "unknown_species"`; `common_name_de = "Art nicht in der Liste (Aves ignota)"`, `scientific_name = "Aves ignota"`.
_Avoid_: Unknown bird, miscellaneous species, fremde Art

**Fangmarker**:
A capture-level marker that flags a special situation about an otherwise
fully-recorded capture **without replacing the Art or the Ring** — the exact
opposite of a Sonderart, which substitutes the Art. Two exist — **Tot-Fund** and
**Nicht-Standard-Fang** — each an independent boolean on the capture, so a
capture may carry both, and either may also sit on an Aves-ignota bird. Both make
the Bemerkung mandatory and are applied by a toggle button next to „Ring
vernichtet" (never Tab-focused, hidden while Ring vernichtet is active). They do
**not** change the dashboard counts today — that exclusion is deferred (ADR 0026).
_Avoid_: Sonderart (that substitutes the Art), Fang-Flag, Sondermarkierung

**Tot-Fund**:
The Fangmarker for a dead ringed bird (found dead, or handed in) — the real Art
and Ring stay. Clicking it opens a popup for the **Todesumstände** (required); the
Bemerkung is then composed as **„Totfund; Umstände: <Eingabe>"** and stays
mandatory. The Todesumstände is not stored separately — it lives inside the
composed Bemerkung. In the IWM export that Bemerkung text travels along in the
Bemerkungsspalte and the row takes **no row colour**. Carries a row icon in the
Marker-Spalte of **every** Fang-Tabelle — „Letzte Fänge", the Wiederfang-Historie
and both sections of „Heute" (#480). Not
an Erst/Wiederfang distinction and not a Sonderart.
Beyond the Bemerkung the export row also sets its **Umstand to 08** and its
**Zustand to 2** (ADR 0034) — the only capture-level facts that displace a
Projekt-derived export column. (Until ADR 0034 a Tot-Fund reached the export
*solely* as that Bemerkung text, leaving the method columns at the Projekt's
values; that is what the two codes replaced.) Those two codes make a Tot-Fund **machine-readable**,
so the IWM import reconstructs the marker from **Umstand 08 alone** (Zustand is
corroborating, never required); a reconstructed Tot-Fund whose file row carries no
Bemerkung gets the bare word „Totfund" — a transcription of the code, never a
fabricated Todesumstände clause.
_Avoid_: Totmeldung, Wiederfund (a recovery need not be dead), Sonderart

**Nicht-Standard-Fang**:
The Fangmarker for a bird caught **outside the Standard-Fangprotokoll** (Handfang,
Zufallsfang, Schaufang). It makes the Bemerkung mandatory (with a hint) and
outlines the form with a coloured frame + badge. In the IWM export its row is
background-coloured — purely for the user's own review, since the Meldestelle
ignores formatting — and the method columns **the Projekt supplies** are left
empty. That is the rule, and it is deliberately phrased about the *source* of the
value rather than a fixed column list (ADR 0034): **Fangmethode** and **Lockmittel**
are always the Projekt's, so they always blank; **Umstand** blanks too — unless the
capture is also a **Tot-Fund**, whose 08 is a fact about that capture and therefore
survives the combination, as does its Zustand 2. Carries a row icon in the Marker-Spalte
of **every** Fang-Tabelle, „Heute" included (#480). Does not change the standard statistics today (deferred).
_Avoid_: Beifang, Zufallsfang (one cause of it, not the marker itself), Sonderart

**Detail-Zeichen**:
The ⓘ of the Marker-Spalte. It appears when the capture carries something the
columns do not show — **Brutfleck**, **CPL+** or a **Bemerkung** — and **names**
it in the tooltip. Naming is all it does: it is a passive sign, not a control, and
its click bubbles to the row exactly like ♥ and ⚑ do. Opening happens through the
row, which leads to the **Detail-Dialog** (ADR 0042). Its job is to let a
Beringer:in decide **before** tapping which row is worth opening while scanning a
list. Its text is called _das Bemerkenswerte_: the vocabulary first, the free
Bemerkung explicitly labelled as „Bemerkung: …" behind it. **Not a Fangmarker**: it
shares the column with ♥ and ⚑ but does not belong to them (ADR 0026) — those flag
a situation about the capture, this one only says that there is more to read. It
does **not** know the Optionale-Felder configuration (#468): a Brutfleck was
recorded on the bird, not on the form, so a Projekt that switched the field off
still sees it on a historical capture.
_Avoid_: Bemerkungs-Indikator (it means more than the Bemerkung since #468), info icon (English), Fangmarker; describing it as *opening* anything (it names, the row opens)

**MarkerFakten**:
**What the Marker-Spalte reads about a Fang** — exactly five things: **Brutfleck**,
**CPL+**, the **Bemerkung**, **Tot-Fund** and **Nicht-Standard-Fang**. Deliberately
independent of whether the Fang has reached the server: a Tot-Fund captured this
morning is a Tot-Fund in „Heute" before it ever syncs. That is why the column
takes these five and not a Fang record — a **nicht synchronisiert** row is a flat
projection of an Outbox-Eintrag, which carries all five verbatim but resolves none
of the references a record promises. A Fang record satisfies MarkerFakten
**structurally**, so the Material tables („Letzte Fänge", the Wiederfang-Historie)
hand in their record unchanged, with no adapter (#480).
The five belong to the **Fang** question — „what was special about this capture?" —
and stand beside, never instead of, the Zustands-Abzeichen of „Heute", which answers
the **Sync** question („is this up yet?").
_Avoid_: building a synthetic Fang record out of a queued row (its Art, Ring, Station
and Beringer:in references are not nullable — the result would be a forged record,
not an adapter); Markerdaten, marker facts (English); treating it as a Fangmarker
(it *contains* the two, alongside three things that are not markers at all)

**Detail-Dialog**:
The complete, **read-only** record of one Fang. It shows **every** attribute,
including one a Projekt switched off via the Optionale Felder, and is therefore the
only surface on which a Fang is fully readable in every Projekt. It is reached by
the **row click of every Fang-Tabelle** — „Letzte Fänge", the Wiederfang-Historie
and both sections of „Heute", online and offline alike (ADR 0042). That makes it
the reading path of *every* Fang, not only of one that happens to carry something
remarkable, and it is why a row click no longer means something different per
table.
It carries exactly one way onward: **„Bearbeiten"**, which leads **out** to the
Bearbeitungsmaske — for a **nicht synchronisiert** entry to the ordinary editing of
that queued entry. The dialog itself stays read-only: the button leaves, it changes
nothing in place. It is locked in exactly one case — the Fang is synchronisiert
**and** the device is offline — and then stays **visible** and names its reason
rather than going quietly dead (ADR 0037). „Im Backend öffnen" is gone; the Django
access lives in the Navigationsleiste behind the Staff-Recht and nowhere else.
It reads a **nicht synchronisiert** Fang too, through a read model whose references
may be unresolvable — see _auf diesem Gerät nicht bekannt_.
_Avoid_: Detailansicht, Fang-Popup, detail view (English), Bearbeitungsmaske (the editable form — a different screen); "read-only" as meaning it has no way out

**auf diesem Gerät nicht bekannt**:
What a surface says about a **reference it cannot resolve on this device** — an
Art, a Station or a Beringer:in of a **nicht synchronisiert** Fang whose flat id
the cached offline bundle does not (or no longer) carry. It is deliberately **not**
the Gedankenstrich: the dash means *nicht erfasst* („Tarsus not measured"), and
those three are mandatory on every Fang, so a dash there would read as a field the
Beringer:in left empty and make her doubt her own capture. The distinction is the
whole point — **not recorded ≠ not lookupable here** — and the phrase is about the
device's reach, never about the record. The Zentrale already refused the dash on
the same grounds, putting its EURING code up instead. The row in „Heute" and the
Detail-Dialog it opens use the **same** wording, so a screen never contradicts what
it opens.
_Avoid_: unbekannt (that would claim something about the Fang), nicht gefunden, kein Eintrag, "unknown/unresolved" (English), the Gedankenstrich

**Parasit**:
A capture's recorded ectoparasite findings, held as a **multi-valued** selection
from a fixed, app-wide vocabulary of parasite types (shared reference data, not
tenant-configurable — ADR 0027). Generalises the former single **Milben** flag,
and a capture may record more than one type — Zecke *and* Rote Milben is an
ordinary finding. The five types, in order: **Rote Milben**, **Weiße Milben**,
**Zecke**, **Federlinge**, **Lausfliege** (`red_mites`, `white_mites`, `tick`,
`feather_lice`, `louse_fly`). Rendered as a Mehrfachauswahl beside the Ja/Nein
flags (Brutfleck, CPL+, Hungerstreifen). No IWM export column exists, so selected
types are written into the Bemerkung, comma-separated.
**Milben** is no longer a type: the user's ruling is that it always meant
_Dermanyssus gallinae_, so it is retired in favour of **Rote Milben** (ADR 0031 —
migrated at rest, still accepted and rewritten on write for the ~30-day offline
window).
_Avoid_: Milben (retired — say Rote Milben), Ektoparasit, Befall

**Fangmethode**:
How a bird was caught, recorded as an IWM code (e.g. M = Japannetz). A property of the Projekt, constant across its captures.
_Avoid_: Trap type, method (English)

**Lockmittel**:
Any lure used to attract the bird, recorded as an IWM code (e.g. N = no lure). A property of the Projekt.
_Avoid_: Bait, decoy

**Umstand**:
The circumstance under which a bird was caught, recorded as an IWM code (e.g. 25 = caught by humans for a scientific project). A property of the **Projekt** — the Beringer never types one. It is nonetheless not *invariably* the Projekt's value in the export: a **Tot-Fund** is a statement about the circumstance of *that* capture, so its row is exported as **08** instead (ADR 0034). This is the first realisation of the per-capture override ADR 0002 deferred — derived from the Fangmarker, never entered. Distinct from _Zustand_ (the bird's condition, a separate IWM field).
_Avoid_: Reason, condition

**Zustand**:
The bird's condition when it left the Beringer's hand, recorded as an IWM code. **Every** exported row carries one — the authentic Datenmeldung has no blank Zustand cell — so BirdDoc emits **8** (lebend, unverletzt freigelassen) by default and **2** on a **Tot-Fund** (ADR 0034). Not modelled per capture and not enterable: BirdDoc records no condition beyond the Fangmarker, so the 8 is an assertion the app makes on the Beringer's behalf, not something it knows. A bird released alive but injured is therefore exported as 8 today; recording condition properly would mean a real per-capture field. Distinct from _Umstand_ (the circumstance of the catch).
_Avoid_: Condition (English), Vogelzustand, Verfassung

**Referenzprojekt**:
The de-identified demo tenant — realised as a real **Organisation** (currently _BirdDoc Demo_, handle `BDDEMO`) holding one **Projekt** of plausible-but-non-real captures — used to onboard new users, generate marketing visualisations, and test features. Seeded from a real IWM export whose every reality-linking field (Beringer, Station, Ringnummer, capture year) is transformed so no row matches a real capture and the source dataset cannot be recognised or reconstructed: the demo captures are explicitly **not Fangdaten**. It is an ordinary tenant with no schema marker — real Mitglieder never see it (they hold no Mitgliedschaft in it), and code that must single it out does so by its known handle. See ADR 0012.
_Avoid_: Testprojekt, Sandbox, Beispieldaten, Demoprojekt (English: demo project — say Referenzprojekt)

**Offline**:
The connectivity state in which the app has no reach to the server but keeps working from its local cache and outstanding entries (PRD #152). Surfaced with a persistent, always-visible indicator so a Mitglied at a Station always knows whether an entry is being saved to the server or only locally, e.g. "Offline – Einträge werden lokal gespeichert". The normal connected state carries no special term of its own.
_Avoid_: Offline-Modus, disconnected (English)

**nicht synchronisiert**:
The state of a captured entry recorded on a device but not yet reached the server — what a Mitglied sees instead of a named queue. The underlying local hold-area is deliberately **not** given a first-class domain name (no "Warteschlange"): it stays implicit, and the UI describes entries by their sync state instead, e.g. a pending count read as "N nicht synchronisierte Einträge". **Offline**, the entries a device can still edit or delete are the ones that are nicht synchronisiert — they are the only ones it holds itself. A synchronisiert entry is **not** app-wide write-protected offline. That protection is a deliberate affordance, and since ADR 0042 it lives in the **Detail-Dialog's locked „Bearbeiten" button** rather than in a row click: every Fang-Tabelle opens the read-only Detail-Dialog anyway, and where the entry is synchronisiert **and** the device offline, that button stays visible, is not triggerable and names why and when it works again. Reaching the capture form some other way still fails on its own: it cannot load a synchronisiert entry offline at all and shows an error state with the **Erneut versuchen** way out instead of an editable form, so no edit ever comes about. That is graceful degradation, not an enforced invariant (issue #386) — nothing app-wide refuses the write, the surfaces simply never offer it. Back online a synchronisiert entry is editable and deletable again like any other (ADR 0030) — the read-only treatment is about the device's reach, not the entry's age. A nicht synchronisiert entry the server **rejects** during sync (a validation change, an archived Station, or a ring-uniqueness collision) is not lost and does not stall the rest of the queue: it is skipped and stays on the device flagged with the server's own error message (a **Synchronisierungsfehler**), while the remaining entries sync on. Resolving it is just ordinary editing — the flagged entry opens in the normal capture form, is corrected, and re-queues clean for the next sync (issue #164).
_Avoid_: Warteschlange, Queue (English), Outbox (English — internal/code term only, never user-facing)

**synchronisieren / zuletzt synchronisiert**:
The act of replaying a device's nicht synchronisiert entries to the server once connectivity returns — automatically, or on demand via a manual "Jetzt synchronisieren" action — and, once it has happened at least once, the resulting **zuletzt synchronisiert** timestamp shown alongside the Offline-Bereitschaft indicator so a Mitglied can see when a device last reached the server.
_Avoid_: Abgleich, sync (English — internal/code term only), Upload

**Fehlerklasse**:
What a failed action is named after: **what the Mitglied can do about it** — never what technically went wrong. Six classes, each with exactly one way out, so the wording follows from the classification: **Korrigieren** (the input is to be put right here and now), **Erneut versuchen** (the condition is passing), **Neu anmelden** (the session ended), **Freigeben lassen** (only another person may do this — and they are named), **App aktualisieren** (the device is working against a footing that no longer exists) and **Unbekannt** (we do not know — and then it is never blamed on the input). The class settles the *words*; the moment it happened in — a save the Mitglied just gestured for, a load in the background, a standing condition — settles the *surface*. A Plausibilitätswarnung is no Fehlerklasse: it is raised on the device and never blocks. See ADR 0037.
_Avoid_: Fehlertyp, Error-Klasse, Schweregrad/severity, Fehlercode (the code is the machine-readable cause the server sends, not the class the app judges)

**Validierungsfehler**:
The server refusing a record **on its own merits** — a ring number already first-caught, an invalid Ringgröße, a missing mandatory Bemerkung: the **Korrigieren** Fehlerklasse. A Synchronisierungsfehler is this same refusal met during a replay rather than at the moment of saving. Distinct from a Plausibilitätswarnung, which is computed on the device and never blocks.
_Avoid_: Eingabefehler (blames the field — the footing may equally have shifted under a record that was right when it was typed), Formfehler, invalid (English)

**Synchronisierungsfehler**:
An entry the server rejected **on the payload's own merits** while synchronisieren was in progress (e.g. a Station archived mid-trip, a stale reference, a ring-uniqueness collision) — it stays on the device, flagged with the server's reason, and reopens in the ordinary capture form for fix-up and re-queueing. The rest of the sync continues around it: one Synchronisierungsfehler never blocks the other entries. Only a **Validierungsfehler** earns one. Everything else the server can answer — an expired session, a CSRF refusal, a rate limit, a Version so stale the endpoint has moved — is a condition of the **run**, not of the entry: it pauses synchronisieren and marks nothing. A Synchronisierungsfehler is the one outcome that costs a Mitglied manual work per entry, so it is never the fallback for a refusal we do not recognise — it has to be earned.
_Avoid_: Sync error (English), Sync-Fehler (the canonical term is Synchronisierungsfehler), failed entry, rejected entry

**Offline-Bereitschaft**:
Whether a device is currently prepared to keep working with no network — its offline cache is fresh, its identity is cached, its storage is protected from eviction, and it is running the **current Version**. Surfaced as a readiness indicator, alongside zuletzt synchronisiert, so a Mitglied can check before leaving for a Station with no coverage; the manual "Jetzt aktualisieren" action is the **single control** that makes the device current in every one of those senses, a waiting newer Version included. A device holding a stale Version is **not** offline bereit however fresh its cache: an app that keeps working offline for weeks would otherwise go on recording against a vocabulary the server has since retired (ADR 0031). See ADR 0015 for the related operational rule (sync before importing the same period via IWM import).
_Avoid_: Readiness (English), offline mode, Vorbereitung, Programmversion (Programm is the avoided term under Projekttyp — the Version is the app's, not a Projekt's)

**Artennorm**:
The expected-value profile a species' measurements are checked against — a Mittelwert and a spread per measured quantity, used to flag an out-of-range value with a Plausibilitätswarnung. It covers six directly-measured quantities (Gewicht, Federlänge, Flügellänge, Tarsus, Kerbe F2, Innenfuß), each an Ausreißertest on `Mittelwert ± k·Std.-Abw.`, plus one **derived** quantity, the Quotient Federlänge/Flügellänge, tested against a relative band (± %), plus two **categorical** plausibility flags: *Geschlechtsbestimmung möglich* (a determined Männchen/Weibchen on a species flagged not-sexable warns) and *bei dj. Großgefiedermauser möglich* (a Handschwingenmauser value on a diesjährigem bird of a species flagged otherwise warns). **Every rule is independently optional**: a check fires only where its norm is set, so a species may carry a Gewicht norm but no Kerbe-F2 norm and no flags — most species carry no Artennorm at all. **Two-layered**: a **globale Standard-Artennorm** ships with the app (seeded from the current Beringungsprojekt's tuned values) and is shared like Species reference data; an Organisation's Admin may **override** it per species auf Organisationsebene. The Artennorm in force for a capture is the org override if one exists, otherwise the global default — a norm is never shared-and-mutated across tenants. It is **not** part of Species identity (names, codes, Empfohlene Ringgröße): a separate, optional profile most species simply lack. Numeric Artennorm values are **never published in the public Wissen reference** — an Artenseite carries only a prose teaser. The Artennormen **editor** also hosts the per-Organisation **Empfohlene Ringgröße** override (ADR 0028), but that override is a standalone value resolved **independently** — it does not ride the whole-row norm override and cannot switch a plausibility check on or off.
_Avoid_: Artenattribut (the feature title — fuzzier, also covers names/codes), Korrekturebene (spreadsheet jargon), range, bounds, Grenzwerte

**Wissen**:
BirdDoc's public knowledge reference (the `/wissen/` section of the public site): citable pages derived from the app's own global reference data — the Ringgrößen-Tabelle, one Artenseite per species, and the Beringungs-Glossar. Deliberately German-only with exactly one canonical URL per topic. It publishes **reference knowledge, never tenant data**, and never numeric Artennorm values (those stay signup-gated). Its audience explicitly includes machine readers — search engines and AI answer engines that read and cite it.
_Avoid_: Knowledge Base, Docs, Wiki, Blog

**Artenseite**:
The public Wissen page for one species — names, taxonomy, and Empfohlene Ringgröße: the citable public answer to "welche Ringgröße für diese Art?". Read from the same Species reference the app uses, so it can never drift from the in-app list. Sonderarten have no Artenseite. It carries at most a prose Artennorm teaser, never numbers.
_Avoid_: Species page (English), Artenprofil, Artikel

**Beringungs-Glossar**:
The Wissen section defining the **field-domain language of the Beringung** (Erstfang, Wiederfang, Ringserie, Ringgröße, …) for a public audience, one page per term. It covers the craft's vocabulary, deliberately **not** BirdDoc product vocabulary (Mitgliedschaft, Zugangscode, Rolle, …) — product terms interest no outside reader and would dilute the reference's authority. Entries are written fresh for the public; this internal glossary is their source of truth, not their text.
_Avoid_: FAQ, Lexikon, Wörterbuch; product-term glossary

**Plausibilitätswarnung**:
The soft warning raised when a captured value falls outside its species' Artennorm — it names the discrepancy but never *hard*-blocks, because a genuinely unusual bird must stay recordable (the same spirit as Aves ignota). It surfaces in two moments: **inline** under the field as the value is entered (on blur, in the existing Geschlechts-Widerspruch idiom), and again as a **save-time Bestätigung** — hitting Speichern with any active Warnung makes the Beringer acknowledge the discrepancies once before the entry is written or queued offline. That acknowledgment is transient: it is **not stored on the capture** (no audit field) and can always be clicked through. Purely client-side — the server neither runs the Ausreißertest nor records the acknowledgment, so it stays distinct from a Validierungsfehler or Synchronisierungsfehler, which *do* block server-side. The underlying check is an **Ausreißertest** (value outside `Mittelwert ± k·Std.-Abw.`, a relative band for the Quotient, or a categorical-flag contradiction).
_Avoid_: Validierungsfehler, error (English), Ausreißer (name the Warnung, not the outlier)
