import { expect, Page, test } from '@playwright/test';
import { selectProject } from './select-project';
import { expectOutboxIndicator } from './status-menu-helpers';

/**
 * E2E for offline Wiederfang + Sonderarten (issue #162, PRD #152): every
 * capture kind — not just Erstfang (#160's tracer bullet) — can be recorded
 * offline and durably enqueued, with the ring-consumption rules honoured:
 * Wiederfang consumes no number, Ring vernichtet consumes one from a
 * collapsed form, Aves ignota keeps the full form with a mandatory
 * Bemerkung, and the offline ring-number suggestion folds the device's own
 * queued consuming entries in on top of the cached last-consumed number so
 * back-to-back offline captures suggest sequential numbers.
 *
 * Follows the offline-simulation pattern established by
 * `offline-cold-boot.spec.ts` (issue #156) and `offline-outbox.spec.ts`
 * (issue #160): stub `**​/api/**` while "online" (also caching the offline
 * reference bundle), then re-route every `/api/**` call to a genuine
 * network-level failure (`route.abort(...)`) for the "offline" phase.
 */

const ORGANIZATION = { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' };

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: ORGANIZATION,
};

const BERINGER = { id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter' };

const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: false,
  organization: ORGANIZATION,
  default_station: STATION,
  scientists: [BERINGER],
  created: '2026-06-01T00:00:00Z',
  updated: '2026-06-01T00:00:00Z',
};

const KOHLMEISE = {
  id: 's1',
  common_name_de: 'Kohlmeise',
  common_name_en: 'Great Tit',
  scientific_name: 'Parus major',
  family_name: '',
  order_name: '',
  ring_size: 'V',
  special_kind: '',
  usage_count: 5,
};

const RING_VERNICHTET = {
  id: 's-rv',
  common_name_de: 'Ring Vernichtet',
  common_name_en: '',
  scientific_name: '',
  family_name: '',
  order_name: '',
  ring_size: null,
  special_kind: 'ring_destroyed',
  usage_count: 0,
};

const AVES_IGNOTA = {
  id: 's-ai',
  common_name_de: 'Art nicht in der Liste (Aves ignota)',
  common_name_en: 'Species not listed',
  scientific_name: 'Aves ignota',
  family_name: '—',
  order_name: '—',
  ring_size: null,
  special_kind: 'unknown_species',
  usage_count: 0,
};

const OFFLINE_BUNDLE = {
  identity: {
    username: 'fre',
    handle: 'FRE',
    organization: ORGANIZATION,
    rolle: 'mitglied',
  },
  species: [KOHLMEISE, RING_VERNICHTET, AVES_IGNOTA],
  ringing_stations: [STATION],
  scientists: [BERINGER],
  projects: [PROJECT],
  last_consumed_ring_numbers: [{ project_id: 'p1', size: 'V', number: '0042' }],
};

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

async function stubApiOnline(page: Page): Promise<void> {
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
  await page.route('**/api/birds/scientists/**', (route) =>
    route.fulfill({ json: page0([BERINGER]) }),
  );
  await page.route('**/api/birds/species/**', (route) =>
    route.fulfill({ json: page0([KOHLMEISE, RING_VERNICHTET, AVES_IGNOTA]) }),
  );
  await page.route('**/api/birds/ringing-stations/**', (route) =>
    route.fulfill({ json: page0([STATION]) }),
  );
  await page.route('**/api/birds/rings/next-number/**', (route) =>
    route.fulfill({ json: { next_number: '0043' } }),
  );
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
}

// Re-routes every API call to a hard network failure (status 0 on the
// client), simulating the device losing connectivity entirely — including
// any create POST, which must never reach the server while offline.
async function goOffline(page: Page): Promise<void> {
  await page.unroute('**/api/auth/me/');
  await page.unroute('**/api/birds/offline-bundle/');
  await page.unroute('**/api/birds/projects/');
  await page.unroute('**/api/birds/organizations/');
  await page.unroute('**/api/birds/scientists/**');
  await page.unroute('**/api/birds/species/**');
  await page.unroute('**/api/birds/ringing-stations/**');
  await page.unroute('**/api/birds/rings/next-number/**');
  await page.unroute('**/api/birds/data-entries/**');
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
}

async function selectSpecies(page: Page, searchTerm: string, optionText: string): Promise<void> {
  const species = page.locator('input[formControlName="species"]');
  await species.click();
  await species.fill(searchTerm);
  await page.locator('mat-option', { hasText: optionText }).click();
}

async function selectBirdStatus(page: Page, label: 'Erstfang' | 'Wiederfang'): Promise<void> {
  await page.locator('mat-select[formControlName="bird_status"]').click();
  await page.locator('mat-option', { hasText: label }).click();
}

async function selectRingSizeV(page: Page): Promise<void> {
  await page.locator('mat-select[formControlName="ring_size"]').click();
  await page.getByRole('option', { name: 'V', exact: true }).click();
}

async function saveAndAwaitFailedPost(page: Page): Promise<void> {
  const failedPost = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
  );
  await page.keyboard.press('Control+s');
  await failedPost;
}

async function expectPendingCount(page: Page, count: number): Promise<void> {
  // Mirror the outbox indicator's own phrasing: zero flips to the friendly-green
  // "Alle Einträge synchronisiert" (#223); exactly one takes the singular.
  const label =
    count === 0
      ? 'Alle Einträge synchronisiert'
      : count === 1
        ? '1 nicht synchronisierter Eintrag'
        : `${count} nicht synchronisierte Einträge`;
  await expectOutboxIndicator(page, label);
}

test.describe('Offline Wiederfang + Sonderarten (issue #162)', () => {
  test('records Wiederfang, Ring vernichtet, and Aves ignota offline, enqueuing each — with the ring suggestion folding in the device\'s own queued consumption', async ({
    page,
  }) => {
    // Prepare online: sign in, pick the Projekt (caches the reference bundle
    // via the nav bar's Offline-Bereitschaft indicator), open the form.
    await stubApiOnline(page);
    await selectProject(page, PROJECT.title);
    await page.goto('/data-entry');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );
    await expectPendingCount(page, 0);

    await goOffline(page);

    const staff = page.locator('input[formControlName="staff"]');
    await staff.click();
    await staff.fill('Filip');
    await expect(page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' })).toBeVisible();
    await page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' }).click();

    // The persistent "Offline" indication (CONTEXT.md's **Offline** entry) —
    // by now the Beringer search above has failed against the aborted
    // routes, confirming connectivity is genuinely lost.
    await expect(page.locator('.offline-indicator')).toContainText(
      'Offline – Einträge werden lokal gespeichert',
    );

    // --- Wiederfang: consumes no ring number, so no suggestion fires; the
    // Beringer types the ring number of the bird already carrying it.
    // Kohlmeise pre-fills Ringgröße "V" on selection. ---
    await selectSpecies(page, 'Kohl', 'Kohlmeise');
    await selectBirdStatus(page, 'Wiederfang');
    await page.locator('input[formControlName="ring_number"]').fill('0010');

    await saveAndAwaitFailedPost(page);
    await expectPendingCount(page, 1);
    await expect(page.locator('input[formControlName="species"]')).toHaveValue('');

    // --- Ring vernichtet: the form collapses to the essentials, and the
    // Beringer types the number reconstructed from the destroyed ring. ---
    await selectSpecies(page, 'Ring', 'Ring Vernichtet');
    await expect(page.locator('mat-select[formControlName="age_class"]')).toHaveCount(0);
    await expect(page.locator('mat-select[formControlName="bird_status"]')).toHaveCount(0);
    await selectRingSizeV(page);
    await page.locator('input[formControlName="ring_number"]').fill('0555');

    await saveAndAwaitFailedPost(page);
    await expectPendingCount(page, 2);

    // --- Aves ignota: the full form stays, but the Bemerkung is mandatory —
    // exactly like online. Selecting it and Erstfang together also proves the
    // ring suggestion now folds in the Ring-vernichtet capture just queued
    // above (cached last-consumed "0042" is stale; "0555" + 1 wins). ---
    await selectSpecies(page, 'Aves', 'Aves ignota');
    await selectBirdStatus(page, 'Erstfang');
    await selectRingSizeV(page);
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('0556');

    // Attempting to save without the Bemerkung is refused locally — no
    // request is even attempted, and the mandatory-Bemerkung error surfaces.
    await page.keyboard.press('Control+s');
    await expect(page.locator('mat-error')).toContainText('Aves ignota');
    await expectPendingCount(page, 2);

    await page.locator('textarea[formControlName="comment"]').fill('Seltener Irrgast, unbestimmbar.');
    await saveAndAwaitFailedPost(page);
    await expectPendingCount(page, 3);

    // --- A following Erstfang keeps incrementing from the device's own
    // queue — "0556" (the just-queued Aves-ignota Erstfang) + 1. ---
    await selectSpecies(page, 'Kohl', 'Kohlmeise');
    await selectBirdStatus(page, 'Erstfang');
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('0557');

    await saveAndAwaitFailedPost(page);
    await expectPendingCount(page, 4);
  });
});
