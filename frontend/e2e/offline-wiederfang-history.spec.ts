import { expect, Page, test } from '@playwright/test';
import { selectProject } from './select-project';
import { expectOutboxIndicator } from './status-menu-helpers';

/**
 * E2E for the offline local Wiederfang history panel (issue #168, PRD #152):
 * entering a ring for a Wiederfang while offline still shows a "Bisherige
 * Fänge" panel — assembled from what this device knows locally (its own
 * queued captures plus the cached recent captures) — and that panel is
 * clearly labelled as possibly incomplete, since captures made on another
 * device or before this device's cache snapshot cannot be seen offline.
 *
 * Follows the offline-simulation pattern of `offline-sonderarten.spec.ts`
 * (issue #162): stub `**​/api/**` while "online" (also caching the offline
 * reference bundle by picking the Projekt), then re-route every `/api/**`
 * call to a genuine network-level failure (`route.abort(...)`) for the
 * "offline" phase.
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

const OFFLINE_BUNDLE = {
  identity: {
    username: 'fre',
    handle: 'FRE',
    organization: ORGANIZATION,
    rolle: 'mitglied',
  },
  species: [KOHLMEISE],
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
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([KOHLMEISE]) }));
  await page.route('**/api/birds/ringing-stations/**', (route) =>
    route.fulfill({ json: page0([STATION]) }),
  );
  await page.route('**/api/birds/rings/next-number/**', (route) =>
    route.fulfill({ json: { next_number: '0043' } }),
  );
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
}

// Re-routes every API call to a hard network failure (status 0 on the
// client), simulating the device losing connectivity entirely — including the
// ring-history GET, which must fall back to the local sources instead.
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

async function selectSpecies(page: Page): Promise<void> {
  const species = page.locator('input[formControlName="species"]');
  await species.click();
  await species.fill('Kohl');
  await page.locator('mat-option', { hasText: 'Kohlmeise' }).click();
}

async function selectBirdStatus(page: Page, label: 'Erstfang' | 'Wiederfang'): Promise<void> {
  await page.locator('mat-select[formControlName="bird_status"]').click();
  await page.locator('mat-option', { hasText: label }).click();
}

async function saveAndAwaitFailedPost(page: Page): Promise<void> {
  const failedPost = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
  );
  await page.keyboard.press('Control+s');
  await failedPost;
}

test.describe('Offline local Wiederfang history panel (issue #168)', () => {
  test('assembles a Wiederfang ring history from the device\'s queued captures and labels it possibly incomplete', async ({
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

    await goOffline(page);

    // Establish that connectivity is genuinely lost: the Beringer search below
    // fails against the aborted routes, flipping the persistent Offline
    // indicator on.
    const staff = page.locator('input[formControlName="staff"]');
    await staff.click();
    await staff.fill('Filip');
    await expect(page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' })).toBeVisible();
    await page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' }).click();
    await expect(page.locator('.offline-indicator')).toContainText(
      'Offline – Einträge werden lokal gespeichert',
    );

    // --- Ring the bird offline (Erstfang): Kohlmeise pre-fills Ringgröße "V",
    // and Erstfang draws the next number "0043" from the cached rope. Saving
    // durably queues it (nicht synchronisiert). ---
    await selectSpecies(page);
    await selectBirdStatus(page, 'Erstfang');
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('0043');
    await saveAndAwaitFailedPost(page);
    await expectOutboxIndicator(page, '1 nicht synchronisierter Eintrag');

    // --- Now recapture the same ring offline (Wiederfang) and look up its
    // history. With no server reachable, the panel is assembled from the just-
    // queued capture the device holds locally. ---
    await selectSpecies(page);
    await selectBirdStatus(page, 'Wiederfang');
    const ringNumber = page.locator('input[formControlName="ring_number"]');
    await ringNumber.fill('0043');
    // Enter in the Ringnummer field during a Wiederfang runs the ring-history
    // lookup — the Beringer's first move.
    await ringNumber.press('Enter');

    // The history panel appears, assembled from the local queue...
    const historyPanel = page.locator('.recapture-section');
    await expect(historyPanel).toBeVisible();
    // #405: die Anzahl steht als matBadge an der Überschrift statt in Klammern.
    // MatBadge rendert seinen Inhalt *innerhalb* des Hosts, `h3` textContent ist
    // also "Bisherige Fänge1" — Text und Zahl werden deshalb getrennt geprüft.
    await expect(historyPanel.locator('h3')).toContainText('Bisherige Fänge');
    await expect(historyPanel.locator('h3 .mat-badge-content')).toHaveText('1');
    await expect(historyPanel.locator('td.mat-column-species')).toContainText('Kohlmeise');
    await expect(historyPanel.locator('td.mat-column-staff')).toContainText('FRE');

    // ...and it is clearly labelled as possibly incomplete offline.
    const incompleteHint = page.locator('[data-testid="offline-history-incomplete"]');
    await expect(incompleteHint).toBeVisible();
    await expect(incompleteHint).toContainText('Offline');
    await expect(incompleteHint).toContainText('möglicherweise unvollständig');
  });
});
