# Frontend Reference

Angular 20 SPA for bird-ringing field data entry. Runs at `http://localhost:4200`. Single route (`/`) renders `DataEntryFormComponent`. No authentication in the frontend itself — the backend admin is linked directly at `http://localhost:8000/admin`.

**Tech stack:** Angular 20, Angular Material, Reactive Forms, RxJS, `de-AT` locale (Austrian German).

---

## API Calls

All calls go through `src/app/service/api.service.ts`. Base URL: `http://localhost:8000/api/birds`.

| Method | Verb | Endpoint | Params | Returns |
|---|---|---|---|---|
| `getSpecies(search?)` | GET | `/species/` | `?search=<term>` | `PaginatedApiResponse<Species>` |
| `getNextRingNumber(size)` | GET | `/rings/next-number/` | `?size=<RingSize>` | `{ next_number: number }` |
| `getRingingStations(search?)` | GET | `/ringing-stations/` | `?search=<term>` | `PaginatedApiResponse<RingingStation>` |
| `getScientists(search?)` | GET | `/scientists/` | `?search=<term>` | `PaginatedApiResponse<Scientist>` |
| `getDataEntries()` | GET | `/data-entries/` | — | `DataEntry[]` |
| `getDataEntriesByRing(size, number)` | GET | `/data-entries/` | `?ring_size=&ring_number=` | `PaginatedApiResponse<DataEntry>` |
| `getDataEntry(id)` | GET | `/data-entries/{id}/` | — | `DataEntry` |
| `createDataEntry(payload)` | POST | `/data-entries/` | body | `DataEntry` |
| `updateDataEntry(id, payload)` | PUT | `/data-entries/{id}/` | body | `DataEntry` |

`PaginatedApiResponse<T>` shape:
```json
{ "count": 150, "next": "...?page=2", "previous": null, "results": [ ... ] }
```

---

## Data Models

### Species
```typescript
interface Species {
  id: string;
  common_name_de: string;
  common_name_en: string;
  scientific_name: string;
  family_name: string;
  order_name: string;
  ring_size: RingSize | null;
}
```
Autocomplete displays `common_name_de`. Selecting a species auto-fills `ring_size` on the form.

### RingingStation
```typescript
interface RingingStation { handle: string; name: string; }
```
`handle` is the PK (string, not UUID). Autocomplete displays `name`. Written to API as `ringing_station_id = handle`.

### Scientist
```typescript
interface Scientist { id: number; handle: string; full_name: string; }
```
Autocomplete displays `"full_name (handle)"`. Written to API as `staff_id = id`.

### Ring
```typescript
interface Ring { id: string; number: string; size: RingSize; }
```
Never posted directly — backend creates/looks up by `ring_number` + `ring_size`.

### DataEntry (read shape from GET)
```typescript
interface DataEntry {
  id: string;
  species: string;            // nested Species object on actual GET responses
  ring: Ring;                 // nested Ring object
  staff: number;              // nested Scientist object on actual GET responses
  ringing_station: string;    // nested RingingStation object on actual GET responses
  date_time: string;          // ISO 8601
  bird_status: BirdStatus;
  age_class: AgeClass;
  sex: Sex;
  net_location: number;
  net_height: number;
  net_direction: Direction;
  feather_span: number;
  wing_span: number;
  tarsus: number;
  notch_f2: number;
  inner_foot: number;
  weight_gram: number;
  fat_deposit: number | null;
  muscle_class: MuscleClass | null;
  small_feather_int: SmallFeatherIntMoult | null;
  small_feather_app: SmallFeatherAppMoult | null;
  hand_wing: HandWingMoult | null;
  has_mites: boolean;
  has_hunger_stripes: boolean;
  has_brood_patch: boolean;
  has_cpl_plus: boolean;
  comment: string;
  created: string;
  updated: string;
}
```

---

## Enums

These are the exact values sent to / expected from the backend.

```typescript
enum RingSize    { XSmall='V', Small='T', Medium='S', Large='X', XLarge='P' }
enum BirdStatus  { FirstCatch='e', ReCatch='w' }
enum Direction   { Left='L', Right='R' }
enum AgeClass    { Nest=1, Unknown=2, ThisYear=3, NotThisYear=4, LastYear=5, NotLastYear=6 }
enum Sex         { Unknown=0, Male=1, Female=2 }
enum FatClass    { Null=0, One=1, Two=2, Three=3, Four=4, Five=5, Six=6, Seven=7, Eight=8 }
enum MuscleClass { Null=0, One=1, Two=2, Three=3 }
enum SmallFeatherIntMoult  { None=0, Some=1, Many=2 }
enum SmallFeatherAppMoult  { Juvenile='J', Unmoulted='U', Mixed='M', New='N' }
enum HandWingMoult { None=0, NoneOld=1, AtLeastOne=2, All=3, Part=4 }
```

---

## Form → API Payload Transformation

`transformFromForm()` in `data-entry-form.ts` converts the reactive form's nested objects to the flat write shape the backend expects:

| Form control | API field | Notes |
|---|---|---|
| `species` (Species object) | `species_id` | UUID string |
| `ringing_station` (RingingStation object) | `ringing_station_id` | handle string (the PK) |
| `staff` (Scientist object) | `staff_id` | integer |
| `ring_size` | `ring_size` | passed through as-is |
| `ring_number` | `ring_number` | passed through as-is |
| all other fields | same name | passed through as-is |

The nested `species`, `ringing_station`, and `staff` keys are deleted before sending.

---

## Form Fields

Defined in `src/app/data-entry-form/data-entry-form.ts`. Required fields are marked **R**.

| Control | Type | Default | Required | Notes |
|---|---|---|---|---|
| `organization` | string | `'AUW'` | **R** | Fixed, not editable |
| `ringing_station` | RingingStation | null | **R** | Autocomplete |
| `staff` | Scientist | null | **R** | Autocomplete |
| `date_time` | string | current hour | **R** | `datetime-local` input, format `yyyy-MM-ddTHH:mm` |
| `species` | Species | null | **R** | Autocomplete; selecting pre-fills `ring_size` |
| `bird_status` | BirdStatus | null | **R** | Select |
| `ring_size` | RingSize | null | **R** | Select; triggers `next-number` fetch on FirstCatch |
| `ring_number` | string | `''` | **R** | Numeric string only (`^[0-9]*$`) |
| `net_location` | number | null | | |
| `net_height` | number | null | | |
| `net_direction` | Direction | null | | Select |
| `age_class` | AgeClass | `AgeClass.Unknown` (2) | **R** | Select |
| `sex` | Sex | `Sex.Unknown` (0) | **R** | Select |
| `fat_deposit` | FatClass | null | | Select |
| `muscle_class` | MuscleClass | null | | Select |
| `small_feather_int` | SmallFeatherIntMoult | null | | Select |
| `small_feather_app` | SmallFeatherAppMoult | null | | Select |
| `hand_wing` | HandWingMoult | null | | Select |
| `tarsus` | number | null | | |
| `feather_span` | number | null | | |
| `wing_span` | number | null | | |
| `weight_gram` | number | null | | |
| `notch_f2` | number | null | | |
| `inner_foot` | number | null | | |
| `has_mites` | boolean | false | **R** | Checkbox |
| `has_hunger_stripes` | boolean | false | **R** | Checkbox |
| `has_brood_patch` | boolean | false | **R** | Checkbox |
| `has_cpl_plus` | boolean | false | **R** | Checkbox |
| `comment` | string | null | | Textarea |

**After a successful save**, `clearForm()` resets all fields **except** `ringing_station`, `staff`, and `organization`. `date_time` is reset to the current hour; `age_class`, `sex`, and the boolean flags are reset to their defaults.

---

## Autocomplete Behavior

All three autocomplete fields use the same RxJS pattern: `valueChanges` → `debounceTime(300)` → `distinctUntilChanged` → `switchMap` → API search. Only the first page of results is shown (10 items). The `search` param is the raw text the user has typed.

- **Species**: searches on `common_name_de` (starts-with) and `scientific_name` (contains). `autoActiveFirstOption` is enabled; Tab confirms the highlighted option (`SelectOnTabDirective`).
- **Ringing station**: searches `name` and `handle`.
- **Scientist**: searches `handle`, `first_name`, `last_name`.

---

## Reactive Effects

Two Angular `effect()` calls run in `DataEntryFormComponent`:

1. **Auto-fill ring number** — fires when `ring_size` or `bird_status` changes. If both have values and `bird_status === BirdStatus.FirstCatch` and not in edit mode, calls `GET /rings/next-number/?size=<size>` and patches `ring_number`.

2. **Load entry for edit** — fires when `entryId` signal has a value (set from route param `id`). Calls `GET /data-entries/{id}/` and patches the form via `transformToForm()`, which extracts `ring.size` → `ring_size` and `ring.number` → `ring_number`.

---

## Ring History (Recapture Lookup)

Visible only when `bird_status === BirdStatus.ReCatch`. A "Search" button is enabled once both `ring_size` and `ring_number` are filled. Clicking it calls `getDataEntriesByRing(size, number)` and renders results in a Material table with columns: `date_time`, `ringing_station`, `staff`, `wing_span`, `weight_gram`.
