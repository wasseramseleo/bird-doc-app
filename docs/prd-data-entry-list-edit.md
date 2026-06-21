## Problem Statement

After a ringer saves a capture, they often realize a mistake was made — a wrong measurement, the wrong age class, a typo in the ring number. Today the only way to revisit and fix a past entry is the Django admin, which is utilitarian, not project-aware, and visually disconnected from the data-entry workflow the ringer just used. There is no convenient, good-looking way inside the app itself to look back over the recent entries of the project you are working on and correct one.

## Solution

After selecting a project, the ringer lands on a **list of that project's data entries**, most recently saved first. The list shows the same kind of information surfaced when recapturing a bird, plus the record's creation timestamp and the ring, so entries are easy to scan and identify. Clicking any row opens the **same data-entry form layout, pre-filled with that entry**, in a clearly marked "edit mode" (a thick amber border with a "Bearbeitungsmodus" badge). The ringer edits the record, saves, and is returned to the list. The list is reachable at any time from a "Letzte Fänge" link in the global header whenever a project is active, supports variable page sizes, and offers a free-text species search.

## User Stories

1. As a ringer, I want to land on a list of my project's data entries right after selecting the project, so that reviewing recent work is the natural starting point rather than an extra navigation step.
2. As a ringer, I want the list sorted by record-creation time descending, so that the entry I just saved (and likely need to fix) is at the very top.
3. As a ringer, I want each row to show when the record was entered ("Erfasst") and the capture date/time ("Datum"), so that I can distinguish recently-saved records from back-dated captures.
4. As a ringer, I want each row to show the ring (size + number), so that I can identify a specific bird among many of the same species.
5. As a ringer, I want the list to display the same biometric/classification fields shown when recapturing a bird (Art, Status, Beringer, Tarsus, Federlänge, Flügel, Gewicht), so that the information is familiar and consistent with the rest of the app.
6. As a ringer, I want the capture status shown as an Erstfang/Wiederfang chip, so that it reads the same way it does in the recapture history table.
7. As a ringer, I want to click anywhere on a row to open that entry, so that opening a record for review/editing is fast and obvious.
8. As a ringer, I want the opened entry to use the same form layout I use for data entry, pre-filled with the saved values, so that I do not have to learn a different screen to make corrections.
9. As a ringer, I want it to be visually unmistakable that I am editing an existing record rather than creating a new one, so that I do not accidentally overwrite real data thinking I am entering a fresh capture.
10. As a ringer, I want the form in edit mode to be surrounded by a thick, distinctly-coloured (amber/warning) border with a centered "Bearbeitungsmodus" badge at the top, so that the edit state is obvious at a glance.
11. As a ringer, I want the save button in edit mode to read "Änderungen speichern", so that the action communicates I am updating an existing record.
12. As a ringer, I want an "Abbrechen" button in edit mode, so that I can leave without saving if I opened the wrong entry or only wanted to look.
13. As a ringer, I want a confirmation prompt if I press "Abbrechen" with unsaved changes, so that I do not lose edits by mistake.
14. As a ringer, I want to be returned to the list after saving an edited record, so that I can immediately continue reviewing other entries.
15. As a ringer, I want creating brand-new entries to keep its current rapid behaviour (form clears, stays on the entry screen), so that high-speed field data entry is unaffected by this feature.
16. As a ringer, I want a "Letzte Fänge" link in the global header whenever a project is active, so that I can reach the list from anywhere in the workflow.
17. As a ringer, I want the active project's title shown in the header, so that I always know which project I am working in.
18. As a ringer, I want a "Neuer Eintrag" button on the list, so that the list works as a hub from which I can also start a new capture.
19. As a ringer, I want to page through the list with selectable page sizes of 10, 50, or 100, so that I can review entries at whatever density suits the moment.
20. As a ringer, I want the list to default to 10 entries per page, so that the initial view stays light.
21. As a ringer, I want a total count of entries shown, so that I have a sense of how much data the project holds.
22. As a ringer, I want a free-text species search above the list, so that I can narrow the list to a species I am looking for.
23. As a ringer, I want the species search to match partial names as I type, so that I do not have to know or type the exact species name.
24. As a ringer, I want changing the species search to return me to the first page, so that results are not hidden on a stale page number.
25. As a ringer, I want a clear loading indicator while entries are fetched, so that I know the app is working.
26. As a ringer, I want a friendly message when the project has no entries yet, so that an empty list is not confusing.
27. As a ringer, I want an error message if the list fails to load, so that I understand something went wrong rather than seeing an empty screen.
28. As a ringer, I want the list to only show entries belonging to the currently selected project, so that I am not shown other projects' data.
29. As a ringer, I want the list view to send me back to project selection if no project is active, so that I am never on a list with no project context.
30. As a ringer, I want editing an entry's ring number to correctly update the ring (and clean up an orphaned ring), so that corrections to the ring behave the same as during normal entry.

## Implementation Decisions

**Modules built/modified**

- **New `DataEntryListComponent`** (route `/data-entries`): project-scoped, server-side paginated list. Reads the active project from `ProjectService.currentProject()`; redirects to `/` when none. Renders a Material table reusing the recapture history column set plus `Erfasst` (created) and `Ring`, a `MatPaginator` (`pageSizeOptions = [10, 50, 100]`, default 10, shows total count), a debounced free-text species search input, and a "Neuer Eintrag" button. Whole-row click navigates to `/data-entry/:id`. Loading/empty/error states mirror `HomeComponent`.
- **`DataEntryFormComponent`** (existing): wire up its already-present-but-unreachable edit-mode logic via the new `/data-entry/:id` route. Add the edit-mode visual treatment (thick amber/warning border + centered "Bearbeitungsmodus" badge), relabel submit to "Änderungen speichern", add an "Abbrechen" button. On successful **edit** save: show the existing snackbar, then navigate to `/data-entries` (do **not** call `clearForm()`). **Create** save behaviour is unchanged (`clearForm()`, stays on `/data-entry`). Create-only effects remain guarded by `!isEditMode()`.
- **New reusable `ConfirmDialogComponent`** consistent with the four existing Material dialogs; used for the dirty-form "Abbrechen" confirmation.
- **`NavBarComponent`** (existing): when `currentProject()` is set, show the project title as plain context plus a "Letzte Fänge" link to `/data-entries`. Nothing extra when no project is active.
- **`HomeComponent.selectProject()`**: navigate to `/data-entries` (the list/hub) instead of `/data-entry`.
- **Routing**: add `/data-entries` (list) and `/data-entry/:id` (edit) alongside the existing `/data-entry` (create). All under `authGuard`.
- **`ApiService`**: replace the unused, wrongly-typed `getDataEntries()` with `getDataEntries({ projectId, page, pageSize, search })` returning `PaginatedApiResponse<DataEntry>`.
- **Backend `DataEntryViewSet`**: add a project query-param filter; add DRF `SearchFilter` with `search_fields = ["species__common_name_de", "species__scientific_name"]`; introduce a `DataEntryPagination(PageNumberPagination)` with `page_size_query_param = "page_size"` and `max_page_size = 100`, applied to this viewset only. The list is ordered by `-created`; the existing `-date_time` ordering and the `ring_size`/`ring_number` filter (used by recapture history) must remain unchanged.

**API contracts**

- `GET /api/birds/data-entries/?project=<project_id>&page=<n>&page_size=<10|50|100>&search=<text>` → paginated `DataEntry` list ordered by `-created`, scoped to the project, optionally narrowed by species name. `page_size` above 100 is clamped to 100; absent `page_size` defaults to 10.
- Read vs. write shapes are unchanged: GET returns nested objects; PUT/PATCH expect flat IDs. `created` is already serialized (read-only).
- Editing reuses the existing `PUT /api/birds/data-entries/:id/` contract, including ring create/switch/orphan-cleanup behaviour.

**Architectural decisions**

- Pagination is **server-side** (a project may hold thousands of entries).
- The active project is sourced from `ProjectService` (storage-backed) rather than encoded in the URL, consistent with the existing entry-form flow.
- The variable-page-size pagination class is scoped to the data-entries endpoint, not changed globally.
- No schema/migration changes are required.

## Testing Decisions

Good tests here assert **external behaviour at the highest existing seam**, not implementation details (no assertions about DOM structure, component internals, or private methods).

- **Primary seam — backend DRF HTTP API via `auth_client`** (prior art: `backend/birds/tests/test_data_entries.py`, which already covers pagination, `-date_time` ordering, the ring filter, and update/ring-cleanup). New cases added alongside the existing ones:
  - `?project=<id>` returns only that project's entries.
  - `?page_size=50` and `?page_size=100` are honoured; `?page_size` above 100 is clamped to 100; absent `page_size` defaults to 10.
  - `?search=<species>` filters by species common/scientific name (partial match).
  - The list is ordered by `-created`; the existing `-date_time` / ring-filter behaviour is unaffected.
- **Secondary seam — frontend `ApiService` via `HttpTestingController`** (prior art: `frontend/src/app/service/api.service.spec.ts`). One test that `getDataEntries({ projectId, page, pageSize, search })` issues the correct request URL/params and maps the paginated response.
- **Not given dedicated automated tests** (would test view chrome / glue rather than behaviour): the edit-mode amber border + badge, the nav-bar contextual link, row-click navigation, and confirm-dialog wiring. These are covered by the existing `data-entry-form.spec.ts` continuing to pass, plus manual verification.

## Out of Scope

- General-purpose filtering of the list (by date range, ringer, station, age/sex, biometrics) beyond the species search.
- User-changeable / clickable-header column sorting (sort is fixed to `created` descending).
- A read-only detail view separate from the edit form (the pre-filled form is the detail view).
- A "Neuer Eintrag" link in the global nav-bar (the list view carries that button instead).
- A full route-guard (`CanDeactivate`) for unsaved changes on browser-back/navigation away; the dirty-form confirmation is wired only to the in-form "Abbrechen" button.
- Bulk operations (multi-select, bulk edit/delete) and deletion from the list.
- Any schema/migration changes.

## Further Notes

- The recapture history table (`DataEntryFormComponent`) is the visual and informational reference for the list's columns and status chip; reuse its conventions for consistency.
- Locale is `de-AT`; all dates/times and floats follow Austrian-German formatting (e.g. `dd.MM.yyyy HH:mm`).
- The existing `getDataEntries()` returns `DataEntry[]` but the endpoint is actually paginated — it is unused and is being replaced, so the type correction carries no migration risk.
- Edit-mode reachability is a latent capability already in `DataEntryFormComponent` (`entryId`, `transformToForm`, `updateDataEntry`); this work primarily makes it reachable and visible rather than building it from scratch.
