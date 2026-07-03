import { expect, Page, test } from '@playwright/test';
import { expectOfflineReadiness, expectOutboxIndicator } from './status-menu-helpers';

/**
 * E2E for the Gewicht-Plausibilitätswarnung (PRD #245, issue #246 — the
 * tracer-bullet spine of the Artennorm feature; numeric UX redesigned in PRD
 * #261, issue #265).
 *
 * Drives the REAL capture form in the browser and asserts BEHAVIOUR: a Beringer
 * selects an Art that carries an effective Artennorm, enters a Gewicht outside
 * its σ-band (Ø ± sd_factor·SD), and — per #265 — sees the single-„Verstanden"
 * modal raised on blur with the de-AT message, then a quiet warning suffix icon
 * that persists after the modal is dismissed. On Speichern the aggregated
 * confirm-dialog gate still lists the discrepancy (removed later in #266) and,
 * once acknowledged, the capture is written (online) / queued (offline). An
 * in-range Gewicht raises neither the modal nor the suffix icon and writes
 * straight through.
 *
 * The norm reaches the client exactly one way — via the per-org norms list the
 * offline reference bundle embeds next to the species pool (the same list the
 * `GET /api/birds/species-norms/` resource serves), cached in IndexedDB by the
 * nav bar's Offline-Bereitschaft refresh. So the identical client lookup drives
 * the check online and offline.
 *
 * Follows the offline-simulation pattern of `offline-data-access.spec.ts`
 * (issue #159) and `offline-outbox.spec.ts` (issue #160): stub `**​/api/**`
 * while "online" (which also caches the reference bundle with its `norms`),
 * then re-route every `/api/**` call to a genuine network-level failure
 * (`route.abort(...)`, `HttpErrorResponse.status === 0`) for the "offline"
 * phase.
 */

const ORGANIZATION = { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' };

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: ORGANIZATION,
};

const BERINGER = { id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter' };

// A normed Art: Zaunkönig, ring size "V". Its effective Artennorm below gives a
// Gewicht σ-band of 7,5–10,7 g (Ø 9,1, SD 0,82, k 1,96), so 25 g is clearly out
// of range and 9 g is in range.
const ZAUNKOENIG = {
  id: 's1',
  common_name_de: 'Zaunkönig',
  common_name_en: 'Wren',
  scientific_name: 'Troglodytes troglodytes',
  family_name: '',
  order_name: '',
  ring_size: 'V',
  special_kind: '',
  usage_count: 5,
};

// The per-org effective Artennorm (override ?? default) keyed by species_id —
// the shape `computePlausibilityWarnings` reads. Only the Gewicht Ø/SD are set
// in this slice; every other rule column is off (null).
const ZAUNKOENIG_NORM = {
  species_id: 's1',
  species_name: 'Zaunkönig',
  weight_mean: '9.1',
  weight_sd: '0.82',
  feather_mean: null,
  feather_sd: null,
  wing_mean: null,
  wing_sd: null,
  tarsus_mean: null,
  tarsus_sd: null,
  notch_f2_mean: null,
  notch_f2_sd: null,
  inner_foot_mean: null,
  inner_foot_sd: null,
  quotient_mean: null,
  quotient_tolerance_pct: null,
  sd_factor: '1.96',
  geschlechtsbestimmung_moeglich: null,
  dj_grossgefiedermauser_moeglich: null,
};

const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: true,
  organization: ORGANIZATION,
  default_station: STATION,
  scientists: [BERINGER],
  created: '2026-06-01T00:00:00Z',
  updated: '2026-06-01T00:00:00Z',
};

// The reference bundle a device caches while online — it carries the `norms`
// list next to the species pool, so the client lookup `norms[species.id]` is
// identical online and offline.
const OFFLINE_BUNDLE = {
  identity: {
    username: 'fre',
    handle: 'FRE',
    organization: ORGANIZATION,
    rolle: 'mitglied',
  },
  species: [ZAUNKOENIG],
  ringing_stations: [STATION],
  scientists: [BERINGER],
  projects: [PROJECT],
  centrals: [],
  norms: [ZAUNKOENIG_NORM],
  last_consumed_ring_numbers: [{ project_id: 'p1', size: 'V', number: '0042' }],
};

// The exact de-AT message the pure function emits for 25 g against this norm.
const OUT_OF_RANGE_MESSAGE =
  'Gewicht 25 g liegt außerhalb des erwarteten Bereichs 7,5–10,7 g (Zaunkönig)';

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

async function stubApiOnline(page: Page): Promise<void> {
  // A permissive fallback so any endpoint this flow touches but does not need
  // (e.g. the dashboard's project stats) resolves deterministically instead of
  // hitting the dead :8000 backend. Registered first so every specific route
  // below takes precedence (Playwright uses the most-recently-added match).
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({
      json: {
        username: 'fre',
        handle: 'FRE',
        is_staff: false,
        active_organization_rolle: 'mitglied',
        active_organization: ORGANIZATION,
      },
    }),
  );
  await page.route('**/api/birds/offline-bundle/', (route) =>
    route.fulfill({ json: OFFLINE_BUNDLE }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({ json: page0([PROJECT]) }));
  await page.route('**/api/birds/organizations/', (route) =>
    route.fulfill({ json: page0([ORGANIZATION]) }),
  );
  // The per-org norms resource (#246). The client caches the same list via the
  // offline bundle, so this is only stubbed for completeness of the online
  // surface — the check reads the bundle's `norms`.
  await page.route('**/api/birds/species-norms/**', (route) =>
    route.fulfill({ json: page0([ZAUNKOENIG_NORM]) }),
  );
  await page.route('**/api/birds/scientists/**', (route) =>
    route.fulfill({ json: page0([BERINGER]) }),
  );
  await page.route('**/api/birds/species/**', (route) =>
    route.fulfill({ json: page0([ZAUNKOENIG]) }),
  );
  await page.route('**/api/birds/ringing-stations/**', (route) =>
    route.fulfill({ json: page0([STATION]) }),
  );
  await page.route('**/api/birds/rings/next-number/**', (route) =>
    route.fulfill({ json: { next_number: '0043' } }),
  );
  // A create POST is confirmed written by echoing back a persisted record; a GET
  // list stays empty.
  await page.route('**/api/birds/data-entries/**', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, json: { id: 'de-1' } });
    }
    return route.fulfill({ json: page0([]) });
  });
}

// Re-routes every API call to a hard network failure (status 0 on the client),
// simulating the device losing connectivity entirely — including the create
// POST, which must never reach the server while offline.
async function goOffline(page: Page): Promise<void> {
  await page.unroute('**/api/auth/me/');
  await page.unroute('**/api/birds/offline-bundle/');
  await page.unroute('**/api/birds/projects/');
  await page.unroute('**/api/birds/organizations/');
  await page.unroute('**/api/birds/species-norms/**');
  await page.unroute('**/api/birds/scientists/**');
  await page.unroute('**/api/birds/species/**');
  await page.unroute('**/api/birds/ringing-stations/**');
  await page.unroute('**/api/birds/rings/next-number/**');
  await page.unroute('**/api/birds/data-entries/**');
  // Drop the permissive fallback too, then abort everything: genuinely offline.
  await page.unroute('**/api/**');
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
}

// Sign in, pick the Projekt (which mounts the nav bar and auto-caches the
// reference bundle — norms included), then wait for the cache to be primed.
async function prepareOnline(page: Page): Promise<void> {
  await stubApiOnline(page);
  // `/` redirects to the `/projekte` picker while no Projekt is current (issue
  // #221 / projectSelectedGuard); choosing a card makes it current and lands on
  // its dashboard back at `/` (ADR 0018).
  await page.goto('/');
  await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
  await expect(page).toHaveURL('/');
  // "zuletzt aktualisiert" confirms the nav bar has fetched and cached the
  // reference bundle (with its `norms`) — the source the form's norm lookup
  // reads, online and offline alike.
  await expectOfflineReadiness(page, 'zuletzt aktualisiert');
}

// Choose the Beringer, the normed Art (Zaunkönig, pre-filling Ringgröße "V")
// and Erstfang (auto-filling the next Ringnummer), leaving only the Gewicht.
async function fillErstfangExceptWeight(page: Page): Promise<void> {
  await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(STATION.name);

  const staff = page.locator('input[formControlName="staff"]');
  await staff.click();
  await staff.fill('Filip');
  await page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' }).click();

  const species = page.locator('input[formControlName="species"]');
  await species.click();
  await species.fill('Zaun');
  await page.locator('mat-option', { hasText: 'Zaunkönig' }).click();
  // Selecting the Art pre-fills its recommended Ringgröße.
  await expect(page.locator('mat-select[formControlName="ring_size"]')).toContainText('V');

  await page.locator('mat-select[formControlName="bird_status"]').click();
  await page.locator('mat-option', { hasText: 'Erstfang' }).click();
  await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('0043');
}

// Enter the Gewicht and blur the field so the on-blur check runs.
async function enterWeightAndBlur(page: Page, grams: number): Promise<void> {
  const weight = page.locator('input[formControlName="weight_gram"]');
  await weight.click();
  await weight.fill(String(grams));
  await weight.blur();
}

// #265: the verbose inline hint is gone — a quiet warning suffix icon marks the
// breaching field, and the newly-appeared warning is announced by the single-
// „Verstanden" InfoDialog. Both the InfoDialog and the save-time confirm-dialog
// render as `mat-dialog-container`; the InfoDialog is dismissed before Speichern
// so only one is ever on screen at a time.
const weightIcon = (page: Page) =>
  page.locator('[data-testid="plausibility-weight_gram-icon"]');
const infoDialog = (page: Page) =>
  page.locator('mat-dialog-container', { hasText: 'Plausibilität prüfen' });
const anyDialog = (page: Page) => page.locator('mat-dialog-container');
const confirmDialog = (page: Page) => page.locator('mat-dialog-container');

test.describe('Gewicht-Plausibilitätswarnung end-to-end (issue #246)', () => {
  test('ONLINE: out-of-range Gewicht raises the warning, the confirm-dialog lists it, and acknowledging writes the entry', async ({
    page,
  }) => {
    await prepareOnline(page);
    await page.goto('/data-entry');
    await fillErstfangExceptWeight(page);

    // #265: leaving the field with an out-of-range Gewicht raises the single-
    // „Verstanden" modal immediately, listing the exact de-AT message.
    await enterWeightAndBlur(page, 25);
    await expect(infoDialog(page)).toBeVisible();
    await expect(infoDialog(page)).toContainText(OUT_OF_RANGE_MESSAGE);
    await page.getByRole('button', { name: 'Verstanden' }).click();
    await expect(anyDialog(page)).toHaveCount(0);

    // The quiet warning suffix icon persists after the modal is dismissed.
    await expect(weightIcon(page)).toBeVisible();

    // Speichern still opens the aggregated confirm-dialog gate (removed in #266).
    await page.locator('button[type="submit"]').click();
    await expect(confirmDialog(page)).toBeVisible();
    await expect(confirmDialog(page)).toContainText('Plausibilität prüfen');
    await expect(confirmDialog(page)).toContainText(OUT_OF_RANGE_MESSAGE);

    // Acknowledge → the create POST fires (written to the server, not queued).
    const post = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.getByRole('button', { name: 'Trotzdem speichern' }).click();
    await post;

    // The dialog closes and the high-speed create flow resets for the next
    // capture (species cleared) — the written-through success path.
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.locator('input[formControlName="species"]')).toHaveValue('');
    // Written to the server, so nothing was queued into the offline outbox.
    await expectOutboxIndicator(page, 'Alle Einträge synchronisiert');
  });

  test('ONLINE control: an in-range Gewicht shows no warning, opens no dialog, and writes straight through', async ({
    page,
  }) => {
    await prepareOnline(page);
    await page.goto('/data-entry');
    await fillErstfangExceptWeight(page);

    // In-range Gewicht → no modal on blur and no suffix icon.
    await enterWeightAndBlur(page, 9);
    await expect(anyDialog(page)).toHaveCount(0);
    await expect(weightIcon(page)).toHaveCount(0);

    // Speichern writes directly, with no confirm-dialog.
    const post = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.locator('button[type="submit"]').click();
    await post;
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.locator('input[formControlName="species"]')).toHaveValue('');
  });

  test('OFFLINE: the same warning + acknowledge-on-save flow works with no network, off the cached bundle norm, queuing the entry', async ({
    page,
  }) => {
    // Prime the cache (norms included) while online, then lose connectivity.
    await prepareOnline(page);
    await goOffline(page);

    // Navigate to the capture form with the network fully down — every field,
    // and the Artennorm lookup itself, must come from the cached offline bundle.
    await page.goto('/data-entry');
    await expect(page.locator('.offline-indicator')).toContainText(
      'Offline – Einträge werden lokal gespeichert',
    );
    await expectOutboxIndicator(page, 'Alle Einträge synchronisiert');

    await fillErstfangExceptWeight(page);

    // Out-of-range Gewicht → the identical inline Plausibilitätswarnung, driven
    // entirely off the cached bundle's `norms` with no network.
    await enterWeightAndBlur(page, 25);
    // #265: the identical on-blur modal, driven entirely off the cached bundle
    // norm with no network; the suffix icon persists after dismissal.
    await expect(infoDialog(page)).toBeVisible();
    await expect(infoDialog(page)).toContainText(OUT_OF_RANGE_MESSAGE);
    await page.getByRole('button', { name: 'Verstanden' }).click();
    await expect(anyDialog(page)).toHaveCount(0);
    await expect(weightIcon(page)).toBeVisible();

    // Speichern opens the same aggregated confirm-dialog.
    await page.locator('button[type="submit"]').click();
    await expect(confirmDialog(page)).toBeVisible();
    await expect(confirmDialog(page)).toContainText(OUT_OF_RANGE_MESSAGE);

    // Acknowledge → the create POST is attempted, aborted at the network level
    // (genuinely offline), and durably queued into the outbox instead.
    const failedPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.getByRole('button', { name: 'Trotzdem speichern' }).click();
    await failedPost;

    await expect(confirmDialog(page)).toHaveCount(0);
    // The acknowledged capture is queued (not lost, not written) while offline.
    await expectOutboxIndicator(page, '1 nicht synchronisierter Eintrag');
  });
});
