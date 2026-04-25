# Backend API Reference

Django REST Framework backend running at `http://localhost:8000`. All endpoints are under `/api/birds/`. No authentication is required for most endpoints (exceptions noted below). Pagination applies to all list endpoints.

## Pagination

All list responses are paginated (10 items per page):

```json
{
  "count": 150,
  "next": "http://localhost:8000/api/birds/species/?page=2",
  "previous": null,
  "results": [ ... ]
}
```

Use `?page=N` to navigate. To fetch all items (e.g. for dropdowns), iterate pages until `next` is `null`.

---

## Endpoints

### Species — `GET /api/birds/species/`

Read-only. Large dataset (~1M rows) — always use search, never load all at once for UI.

**Query params:**
- `?search=<term>` — searches `common_name_de` (starts-with) and `scientific_name` (contains)

**Response item:**
```json
{
  "id": "uuid",
  "common_name_de": "Amsel",
  "common_name_en": "Common Blackbird",
  "scientific_name": "Turdus merula",
  "ring_size": "T"
}
```

`ring_size` is the recommended ring size for the species (`V | T | S | X | P` or `null`). Use it to pre-fill the ring size field when a species is selected.

**Active species list:** If the logged-in user has an active `SpeciesList`, this endpoint automatically returns only those species (already filtered, same response shape). No extra query param needed.

---

### Rings — `GET /api/birds/rings/next-number`

Returns the next sequential ring number for a given size.

**Query params:**
- `?size=<V|T|S|X|P>` (required)

**Response:**
```json
{ "next_number": 42 }
```

Call this when the user selects a ring size to auto-suggest the next number in sequence.

---

### Ringing Stations — `GET /api/birds/ringing-stations/`

Read-only.

**Query params:**
- `?search=<term>` — searches `name` and `handle`

**Response item:**
```json
{
  "handle": "STAMT",
  "name": "Stammersdorf"
}
```

Note: `handle` is the primary key (a string), not a UUID.

---

### Scientists — `GET /api/birds/scientists/`

Read-only.

**Query params:**
- `?search=<term>` — searches `handle`, `first_name`, `last_name`

**Response item:**
```json
{
  "id": 1,
  "handle": "MUS",
  "full_name": "Max Mustermann"
}
```

---

### Data Entries — `/api/birds/data-entries/`

Full CRUD. Ordered by `date_time` descending.

**Query params (list):**
- `?ring_size=T&ring_number=42` — filter by exact ring (both params required together)

#### GET response item (read shape):

Nested objects are returned on read:

```json
{
  "id": "uuid",
  "species": {
    "id": "uuid",
    "common_name_de": "Amsel",
    "common_name_en": "Common Blackbird",
    "scientific_name": "Turdus merula",
    "ring_size": "T"
  },
  "ring": {
    "id": "uuid",
    "number": "42",
    "size": "T"
  },
  "staff": {
    "id": 1,
    "handle": "MUS",
    "full_name": "Max Mustermann"
  },
  "ringing_station": {
    "handle": "STAMT",
    "name": "Stammersdorf"
  },
  "date_time": "2025-06-01T08:30:00Z",
  "bird_status": "e",
  "age_class": 3,
  "sex": 1,
  "net_location": 3,
  "net_height": 2,
  "net_direction": "L",
  "feather_span": "72.50",
  "wing_span": "95.00",
  "tarsus": "28.10",
  "notch_f2": "5.20",
  "inner_foot": null,
  "weight_gram": "85.30",
  "fat_deposit": 2,
  "muscle_class": 1,
  "small_feather_int": 0,
  "small_feather_app": "N",
  "hand_wing": 3,
  "has_mites": false,
  "has_hunger_stripes": false,
  "has_brood_patch": false,
  "has_cpl_plus": false,
  "comment": null,
  "created": "2025-06-01T08:35:00Z",
  "updated": "2025-06-01T08:35:00Z"
}
```

#### POST/PUT/PATCH write shape:

Use flat write-only fields instead of the nested objects:

```json
{
  "species_id": "uuid",
  "staff_id": 1,
  "ringing_station_id": "STAMT",
  "ring_number": "42",
  "ring_size": "T",
  "date_time": "2025-06-01T08:30:00Z",
  "bird_status": "e",
  "age_class": 3,
  "sex": 1,
  "net_location": 3,
  "net_height": 2,
  "net_direction": "L",
  "feather_span": "72.50",
  "wing_span": "95.00",
  "tarsus": "28.10",
  "notch_f2": null,
  "inner_foot": null,
  "weight_gram": "85.30",
  "fat_deposit": 2,
  "muscle_class": 1,
  "small_feather_int": 0,
  "small_feather_app": "N",
  "hand_wing": 3,
  "has_mites": false,
  "has_hunger_stripes": false,
  "has_brood_patch": false,
  "has_cpl_plus": false,
  "comment": null
}
```

The backend handles ring creation/lookup — never POST to `/rings/` directly. `ring_number` + `ring_size` together identify or create the ring.

#### Field reference:

| Field | Type | Values |
|---|---|---|
| `bird_status` | string | `"e"` = first catch, `"w"` = recapture |
| `age_class` | integer | `1`=Nestling, `2`=Unknown, `3`=This year, `4`=Not this year, `5`=Last year, `6`=Not last year |
| `sex` | integer | `0`=Unknown, `1`=Male, `2`=Female |
| `net_direction` | string | `"L"` = left, `"R"` = right |
| `fat_deposit` | integer | `0–9`, nullable |
| `muscle_class` | integer | `0–3`, nullable |
| `small_feather_int` | integer | `0`=none, `1`=up to 20, `2`=more than 20 |
| `small_feather_app` | string | `"J"`=juvenile, `"U"`=<1/3, `"M"`=1/3–2/3, `"N"`=>2/3 |
| `hand_wing` | integer | `0`=none growing, `1`=all unmoulted, `2`=at least one moulting, `3`=all moulted, `4`=partial |
| `ring_size` (write) | string | `V \| T \| S \| X \| P` |
| Decimal fields | string | Sent and received as decimal strings (e.g. `"85.30"`) |

---

### Species Lists — `/api/birds/species-lists/`

**Requires authentication.** Full CRUD. Scoped to the logged-in user — each user only sees their own lists.

**Response item:**
```json
{
  "id": "uuid",
  "name": "My Warblers",
  "is_active": true,
  "species": [
    { "id": "uuid", "common_name_de": "Amsel", "common_name_en": "...", "scientific_name": "...", "ring_size": "T" }
  ],
  "updated": "2025-06-01T08:00:00Z"
}
```

**Write shape:**
```json
{
  "name": "My Warblers",
  "is_active": true,
  "species_ids": ["uuid1", "uuid2"]
}
```

Setting `is_active: true` on one list automatically deactivates all other lists for that user (enforced server-side). Only one list can be active at a time.

When a list is active, `GET /api/birds/species/` returns only the species in that list.
