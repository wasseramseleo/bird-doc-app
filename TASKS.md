# Tasks

Derived from beta-user feedback in `FEEDBACK.md`. Tasks are grouped by area; each item lists requirements, files to touch, and acceptance criteria.

User decisions captured during planning:
- Optional fields will be hidden via a **per-project toggle** (not user-pref, not removed).
- IWM export is reached via **a button in the Angular app**, with the backend serving the filled `.xlsx`.
- Beringerkürzel correction is a **one-off data fix** via Django admin — no code feature.

---

## A. Answers to user's open questions (no code)

### A1 — Project title/subtitle editing
Currently not possible from the UI. See task **B1** below; once implemented, any scientist member of a project can rename it. No need to create a new project.

### A2 — Test bird entries
Yes, any data can be entered. The only DB constraint is ring uniqueness on `(size, number)` (`backend/birds/models.py`, `Ring.Meta.unique_together`). Recommend keeping test entries against the dedicated `TEST` ringing station that the `create_test_data` management command already creates, so they're easy to filter out later.

---

## B. Project management

### B1 — Add project edit dialog
Add a UI to edit `title`, `description`, and the per-project optional-fields toggle (see C2) for an existing project.

**Requirements**
- Mirror `frontend/src/app/home/project-create-dialog/` as a new `project-edit-dialog/`.
- Reuse the same form fields (title, description, organizationHandle, scientists), pre-filled from the selected project.
- Trigger the dialog from `home.html` next to each project entry (e.g. an edit icon).
- Use `PATCH /api/birds/projects/{id}/` — backend already permits this for scientists in the project (`backend/birds/views.py:147-162`).

**Files**
- New: `frontend/src/app/home/project-edit-dialog/`
- Modify: `frontend/src/app/home/home.ts`, `frontend/src/app/home/home.html`
- Verify: `frontend/src/app/service/api.service.ts` exposes `updateProject` (add if missing).

**Acceptance**
- Scientist member can rename their project's title and edit its description; non-members see no edit affordance and `PATCH` returns 404 (existing behavior).

---

## C. Data-entry form changes

### C1 — Rename "Kiel" → "Brustbein" in Muskelklasse options
Pure label change in the muscle-class select.

**Files**
- `frontend/src/app/data-entry-form/data-entry-form.ts:169-177` — replace each occurrence of `Kiel` with `Brustbein` in `muscleClassOptions`.

**Acceptance**
- The Muskelklasse dropdown shows `0 - Brustbein nicht fühlbar`, `1 - Brustbein gut fühlbar`, etc.

### C2 — Per-project toggle to hide optional fields
The user does not need Milben, Hungerstreifen, Brutfleck, CPL+, KerbeF2, Innenfuß in winter. Make their visibility togglable per project.

**Backend**
- Add `show_optional_fields = models.BooleanField(default=True)` to `Project` (`backend/birds/models.py:109-130`).
- Generate migration.
- Expose the field on `ProjectSerializer` (`backend/birds/serializers.py`).

**Frontend**
- `data-entry-form` reads the flag from the active project (via the existing `ProjectService`).
- When `false`, hide the form controls **and** their HTML rows for: `has_mites`, `has_hunger_stripes`, `has_brood_patch`, `has_cpl_plus`, `notch_f2`, `inner_foot`.
- Add a checkbox for this toggle to the edit dialog from B1.

**Files**
- `backend/birds/models.py`, new migration, `backend/birds/serializers.py`
- `frontend/src/app/data-entry-form/data-entry-form.ts`
- `frontend/src/app/data-entry-form/data-entry-form.html`
- `frontend/src/app/home/project-edit-dialog/` (added in B1)

**Acceptance**
- Toggling the flag in the project edit dialog and re-opening the entry form makes the six fields appear/disappear consistently. Existing entries remain unaffected.

### C3 — Station naming guidance (no code)
Existing `RingingStation.name` values can be edited via Django admin to the more specific "Stadt, Ortsname" pattern (e.g. `Linz, Botanischer Garten`). No model or UI change required.

---

## D. Data fixes

### D1 — Add ring size V for Blaumeise (and audit modern taxonomy)
Migration `0022_seed_austrian_ring_sizes.py` only seeds the **old** name `Parus caeruleus` (line 243), but the 2024 species CSV uses `Cyanistes caeruleus`, so Blaumeise currently has `ring_size = NULL`.

**Requirements**
- New migration `backend/birds/migrations/00XX_fix_modern_taxonomy_ring_sizes.py` that does, at minimum:
  ```python
  Species.objects.filter(scientific_name="Cyanistes caeruleus").update(ring_size="V")
  ```
- Audit migration 0022 for other genus splits between old and modern taxonomy and patch any further gaps in the same migration. Hot spots to check (old → modern):
  - `Parus` → `Cyanistes` / `Poecile` / `Periparus` / `Lophophanes`
  - `Carduelis` → `Linaria` / `Spinus` / `Acanthis` / `Chloris`
  - `Saxicola torquata` → `Saxicola rubicola`
  - `Miliaria calandra` → `Emberiza calandra`

**Files**
- New: `backend/birds/migrations/00XX_fix_modern_taxonomy_ring_sizes.py`

**Acceptance**
- After `python manage.py migrate`, picking "Blaumeise" in the species autocomplete pre-fills ring size **V** in the entry form.

### D2 — Beringerkürzel one-off correction (no code)
The Austrian convention is **first letter of first name + first two of last name** (e.g. `FRE` instead of `FIL`). Fix the affected `Scientist.handle` rows directly in Django admin. Convention remains a manual entry pattern; auto-suggest is explicitly out of scope right now.

---

## E. IWM / Vogelwarte Excel export

### E1 — Backend: filled-xlsx export endpoint
Generate the IWM submission spreadsheet by filling the committed template with project data.

**Requirements**
- Add `openpyxl` to `backend/requirements.txt`.
- New action on `ProjectViewSet`: `GET /api/birds/projects/{id}/export-iwm/` returning `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (use `FileResponse` or `HttpResponse` with the bytes).
- Open the committed template `Datenmeldung_Vorlage_IWM.xlsx` (repo root, also referenced in feedback). Read the header row to locate column indices by name; do **not** hard-code column letters — be resilient if the template's column order changes.
- Iterate `DataEntry.objects.filter(project=project).order_by("date_time")`; write one row per entry.
- **Sex stays numeric (0/1/2)** — do not convert to `U/M/F(W)`.
- **Leave the following columns empty** (user fills them at end of season): `Zusatzmarkierung`, `Fangmethode`, `Lockmittel`, `Ortskodierung`, `Geo-Koordinaten`, `Zustand`, `Umstand`, `Brutfleck`, `Kloake`, `Region`, `Land`.
- Map remaining columns from `DataEntry` fields. Use the example rows in `Datenmeldung_Vorlage_IWM.xlsx` to confirm field formats; species code, ring size+number, age class, sex, date, biometrics, etc.

**Files**
- `backend/requirements.txt` — add `openpyxl`.
- `backend/birds/views.py` — new `@action(detail=True, methods=["get"], url_path="export-iwm")` on `ProjectViewSet`.
- New: `backend/birds/iwm_export.py` — keep mapping logic separate from the ViewSet.
- Template path constant — locate template via `settings.BASE_DIR / "Datenmeldung_Vorlage_IWM.xlsx"` or move it under `backend/birds/templates/iwm/` and reference there.

**Acceptance**
- `curl -H "Authorization: …" -OJ http://localhost:8000/api/birds/projects/<id>/export-iwm/` produces a valid `.xlsx` that opens in Excel/Numbers, the header row matches the IWM template, populated rows correspond to project entries, and the deferred columns are empty.

### E2 — Frontend: download button
Surface the export to the user.

**Requirements**
- Add `exportIwm(projectId: string)` to `frontend/src/app/service/api.service.ts` using `HttpClient.get(url, { responseType: 'blob', observe: 'response' })` so the filename can be parsed from `Content-Disposition`.
- Add an "Als IWM Excel exportieren" button to the project list / tile in `home.html` (or wherever the user picks the active project).
- Trigger download via a temporary `<a>` with `URL.createObjectURL(blob)`; revoke the URL after click.

**Files**
- `frontend/src/app/service/api.service.ts`
- `frontend/src/app/home/home.ts`
- `frontend/src/app/home/home.html`

**Acceptance**
- With a project selected and ≥1 entry, clicking the button downloads the filled `.xlsx`.

---

## Verification (end-to-end after all tasks land)

1. `cd backend && python manage.py migrate` — new project-toggle + species-fix migrations apply cleanly.
2. `cd frontend && ng serve` and `cd backend && python manage.py runserver` — open the app at `http://localhost:4200`.
3. Edit a project's title and description from the UI (B1).
4. Toggle the per-project optional-fields flag; reload the entry form and confirm the six optional inputs disappear (C2).
5. Open the entry form and confirm the muscle-class dropdown shows "Brustbein" wording (C1).
6. Pick "Blaumeise" in species autocomplete and confirm ring size auto-fills to V (D1).
7. Click "Als IWM Excel exportieren" on a project with entries, open the resulting file, and confirm headers match the IWM template and deferred columns are empty (E1 + E2).

---

## Out of scope

- No new `Kloake`, `Zustand`, or `Umstand` fields on `DataEntry` — user fills these in the export at end of season; OK to leave them empty.
- No auto-suggest for Beringerkürzel.
- No conversion of sex from `0/1/2` to `U/M/F(W)`.
- The existing CSV admin export (`backend/birds/admin.py:19-90`) is kept untouched alongside the new IWM export.
