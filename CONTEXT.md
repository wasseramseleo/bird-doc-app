# Bird Ringing Documentation

The domain language for the bird-ringing (Beringung) field-data-entry application. One record is captured per bird caught and ringed.

## Language

**Beringer**:
A person who rings birds and is recorded as responsible for a capture. Belongs to exactly one Organisation, which owns the record. May or may not have a login account — experienced helpers ring birds too and are recorded without one. A Beringer **with** an account and a Mitgliedschaft is a **Mitglied**; one **without** an account is just an org-owned selectable name (no Mitgliedschaft, no Rolle, never an actor). Any Mitglied may quick-add a no-account Beringer mid-session (ADR 0001); an Organisation's Admin otherwise manages Beringer in-app — add, edit, delete (which reassigns captures to the Gelöschter Nutzer rather than losing them, ADR 0003) and link/unlink a Beringer to a Mitgliedschaft — not only in the Django admin (ADR 0016). Deleting a Beringer that is a Mitglied goes through Mitgliedschaft (seat) management, not the Beringer surface.
_Avoid_: Scientist, Staff, Ringer (English)
_Code note_: the model and the `/scientists/` endpoint are historically named `Scientist` (and the form field `staff`); the domain term is **Beringer**. Renaming the code to match is a tracked follow-up.

**Mitglied**:
A Beringer who has a login account and a Mitgliedschaft in an Organisation — i.e. an *actor* who logs in, as opposed to a no-account Beringer (a mere selectable name). Every Mitglied is a Beringer; not every Beringer is a Mitglied. An Admin promotes a no-account Beringer to a Mitglied by linking it to a Mitgliedschaft, or demotes it back by unlinking — the latter only while the Beringer owns no captures, so a recorded identity is never stripped from its account (ADR 0016).
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
A named campaign that groups captures, scoped to one Organisation and a set of Beringer. Carries its **Zentrale** — the EURING scheme its Erstfänge are ringed under — **today always AUW** (Österreichische Vogelwarte) and backfilled for every existing Projekt. There is **no selector in project settings yet**: exposing a non-AUW Projekt-Zentrale would silently turn all of a Projekt's Erstfänge to free-text Ringgrößen, so the knob stays hidden until a second real Zentrale user exists — a one-line UI change at that point.
_Avoid_: Campaign

**Projekttyp**:
The ringing programme a Projekt runs under, chosen from a fixed single-valued list — **IWM, IMS, Zugvogelmonitoring, Nestlingsberingung, Sonstiges**. Purely a **descriptive, internal** organising label: it is **never exported** (the IWM export ignores it) and **drives no behaviour** — in particular it does **not** gate any capture field. Optional; a Projekt with none set reads as Sonstiges. Deliberately **decoupled from field visibility**: although Nestlingsberingung inherently uses no mist-nets, whether a Projekt shows the Netz/Netzfach fields is a **separate per-Projekt toggle**, not derived from the type — the type may at most seed that toggle's default at project creation, never enforce it.
_Avoid_: Project type (English), Programm, Projektkategorie, Kategorie

**Erstfang / Wiederfang**:
First capture of a bird (new ring applied) vs. a later recapture of an already-ringed bird. A physical ring is applied to a bird exactly once, so within an Organisation a given ring — now keyed by **(Organisation, Zentrale, Ringgröße, Nummer)** (ADR 0019, extending ADR 0006) — may be the subject of **at most one Erstfang** — a second Erstfang on the same ring is a genuine ring-uniqueness collision and is refused (`capture_service.create_capture`), while any number of Wiederfänge of that ring are expected. This is what turns two concurrent offline devices that record the same Erstfang into exactly one flagged sync error on the losing device, never a silent duplicate (issue #164). An **Erstfang** — and a **Ring vernichtet** — always carries the **Projekt-Zentrale** (AUW today), so a free-form, non-Austrian Ringgröße can only appear on a **Wiederfang** of a foreign ring; the next-number rope suggestion counts only Erstfang/Ring-vernichtet entries and so never sees a foreign size.
_Avoid_: First catch / recatch (English), recapture

**Erstnachweis**:
The **first record of an Art within a selected range** — the per-species arrival, the unit the dashboard's Ankunfts-Feed lists newest-first (capped at five). Deliberately **not an Erstfang**: an Erstfang is the first capture of an *individual bird* (a new ring), whereas an Erstnachweis is the first time a *species* shows up in the range, regardless of whether that record is itself an Erstfang or a Wiederfang. A **Sonderart is not an Art record**: Aves ignota is excluded from Erstnachweise (Ring vernichtet is excluded everywhere), so only real, identified Arten form arrivals. Each Erstnachweis carries the Art (with wissenschaftlichem Namen), the Europe/Vienna date of its first in-range record, and that record's Beringer; the dashboard badges those from the last seven days „NEU".
_Avoid_: First record (English), Erstfang (a different concept — the first capture of an individual bird), Saison-Erstfang

**Fangtag**:
A single calendar day (Europe/Vienna) on which a Projekt recorded at least one capture — the unit the dashboard groups daily figures by. A day with no capture is not a Fangtag: the daily series is sparse (only days that happened), never a padded continuous calendar.
_Avoid_: Catch day (English), Session, Fangsession

**Fänge / Individuenzahl**:
The count of captures in a set of records — every Erstfang **and** every Wiederfang, because each is a bird that was physically handled. The Ring-vernichtet Sonderart is excluded (it is not a bird); Aves ignota is included. Not deduplicated: a bird caught on three Fangtage counts three times. This is what the dashboard's "Anzahl Fänge" and the per-Fangtag Individuenzahl report. A count of *distinct* birds over a period (deduping Wiederfänge by ring) is a different, biologically stricter figure and is deliberately **not** what Individuenzahl means here.
_Avoid_: Catches (English), Fangereignis; distinct-individual count (a separate figure, not this one)

**Artenzahl**:
The number of distinct species among a set of captures (species richness). Aves ignota contributes exactly one distinct "unbekannt" category; the Ring-vernichtet Sonderart never counts. Distinct from Individuenzahl — ten Fänge of a single species are Artenzahl 1, Individuenzahl 10.
_Avoid_: Species count (English), Artenvielfalt / diversity (a plain richness count is not a diversity index)

**Saison**:
A ringing campaign period a Beringer treats as one stretch of effort (e.g. an autumn migration run). It is **not a modelled entity** — no Saison row, no start/end on a Projekt. In the dashboard it is expressed only as a selectable date range over the Fangtage; "per Saison" is a preset range (e.g. the current year), never a stored season. A future configurable Saison would be a deliberate schema addition, not something the model implies today.
_Avoid_: Season (English); year (as a synonym — a calendar year is only a rough stand-in for a Saison)

**Diesjährig**:
A bird hatched in the current calendar year (age class 3). Diesjährig gates a single field — the Kleingefieder *Fortschritt* (post-juvenile small-feather moult progress, J/U/M/N), recorded for diesjährige birds alone because only a this-year bird undergoes its first post-juvenile moult. The Kleingefieder *Intensität* and the Handschwingenmauser are recorded for **all** age classes.
_Avoid_: Juvenile, first-year

**Ringgröße**:
The size class of a ring, a short letter code, validated against the **known size conventions of the ring's Zentrale**. Modelled today only for **AUW** — the 28 Austrian codes, offered as a fixed choice; any **other Zentrale means free text** (trimmed, uppercased, length-capped, **never empty**), because BirdDoc does not model foreign schemes' size tables. It is one `size` field either way; the choice is conditional on the ring's Zentrale, not on a UI gesture, so the same rule serves data entry, offline sync and IWM import alike. Because an Erstfang and a Ring vernichtet always carry the Projekt-Zentrale (AUW today), a free-form, non-Austrian Ringgröße can only appear on a Wiederfang of a foreign ring.
_Avoid_: Ring size (English), Größenklasse, size code

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

**Referenzprojekt**:
The de-identified demo tenant — realised as a real **Organisation** (currently _BirdDoc Demo_, handle `BDDEMO`) holding one **Projekt** of plausible-but-non-real captures — used to onboard new users, generate marketing visualisations, and test features. Seeded from a real IWM export whose every reality-linking field (Beringer, Station, Ringnummer, capture year) is transformed so no row matches a real capture and the source dataset cannot be recognised or reconstructed: the demo captures are explicitly **not Fangdaten**. It is an ordinary tenant with no schema marker — real Mitglieder never see it (they hold no Mitgliedschaft in it), and code that must single it out does so by its known handle. See ADR 0012.
_Avoid_: Testprojekt, Sandbox, Beispieldaten, Demoprojekt (English: demo project — say Referenzprojekt)

**Offline**:
The connectivity state in which the app has no reach to the server but keeps working from its local cache and outstanding entries (PRD #152). Surfaced with a persistent, always-visible indicator so a Mitglied at a Station always knows whether an entry is being saved to the server or only locally, e.g. "Offline – Einträge werden lokal gespeichert". The normal connected state carries no special term of its own.
_Avoid_: Offline-Modus, disconnected (English)

**nicht synchronisiert**:
The state of a captured entry recorded on a device but not yet reached the server — what a Mitglied sees instead of a named queue. The underlying local hold-area is deliberately **not** given a first-class domain name (no "Warteschlange"): it stays implicit, and the UI describes entries by their sync state instead, e.g. a pending count read as "N nicht synchronisierte Einträge". Only entries that are nicht synchronisiert can still be edited or deleted on that device; once an entry synchronisiert, it becomes read-only offline. A nicht synchronisiert entry the server **rejects** during sync (a validation change, an archived Station, or a ring-uniqueness collision) is not lost and does not stall the rest of the queue: it is skipped and stays on the device flagged with the server's own error message (a **Sync-Fehler**), while the remaining entries sync on. Resolving it is just ordinary editing — the flagged entry opens in the normal capture form, is corrected, and re-queues clean for the next sync (issue #164).
_Avoid_: Warteschlange, Queue (English), Outbox (English — internal/code term only, never user-facing)

**synchronisieren / zuletzt synchronisiert**:
The act of replaying a device's nicht synchronisiert entries to the server once connectivity returns — automatically, or on demand via a manual "Jetzt synchronisieren" action — and, once it has happened at least once, the resulting **zuletzt synchronisiert** timestamp shown alongside the Offline-Bereitschaft indicator so a Mitglied can see when a device last reached the server.
_Avoid_: Abgleich, sync (English — internal/code term only), Upload

**Synchronisierungsfehler**:
An entry the server rejected while synchronisieren was in progress (e.g. a Station archived mid-trip, a stale reference) — it stays on the device, flagged with the server's reason, and reopens in the ordinary capture form for fix-up and re-queueing. The rest of the sync continues around it: one Synchronisierungsfehler never blocks the other entries.
_Avoid_: Sync error (English), failed entry, rejected entry

**Offline-Bereitschaft**:
Whether a device is currently prepared to keep working with no network — its offline cache is fresh, its identity is cached, its storage is protected from eviction. Surfaced as a readiness indicator, alongside zuletzt synchronisiert, so a Mitglied can check before leaving for a Station with no coverage; a manual "Jetzt aktualisieren" action tops up the cache on demand. See ADR 0015 for the related operational rule (sync before importing the same period via IWM import).
_Avoid_: Readiness (English), offline mode, Vorbereitung

**Artennorm**:
The expected-value profile a species' measurements are checked against — a Mittelwert and a spread per measured quantity, used to flag an out-of-range value with a Plausibilitätswarnung. It covers six directly-measured quantities (Gewicht, Federlänge, Flügellänge, Tarsus, Kerbe F2, Innenfuß), each an Ausreißertest on `Mittelwert ± k·Std.-Abw.`, plus one **derived** quantity, the Quotient Federlänge/Flügellänge, tested against a relative band (± %), plus two **categorical** plausibility flags: *Geschlechtsbestimmung möglich* (a determined Männchen/Weibchen on a species flagged not-sexable warns) and *bei dj. Großgefiedermauser möglich* (a Handschwingenmauser value on a diesjährigem bird of a species flagged otherwise warns). **Every rule is independently optional**: a check fires only where its norm is set, so a species may carry a Gewicht norm but no Kerbe-F2 norm and no flags — most species carry no Artennorm at all. **Two-layered**: a **globale Standard-Artennorm** ships with the app (seeded from the current Beringungsprojekt's tuned values) and is shared like Species reference data; an Organisation's Admin may **override** it per species auf Organisationsebene. The Artennorm in force for a capture is the org override if one exists, otherwise the global default — a norm is never shared-and-mutated across tenants. It is **not** part of Species identity (names, codes, Empfohlene Ringgröße): a separate, optional profile most species simply lack. Numeric Artennorm values are **never published in the public Wissen reference** — an Artenseite carries only a prose teaser.
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
