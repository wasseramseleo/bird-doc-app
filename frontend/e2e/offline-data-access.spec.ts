import { expect, Page, test } from '@playwright/test';
import { selectProject } from './select-project';
import { expectOfflineReadiness } from './status-menu-helpers';

/**
 * E2E for the offline data-access facade (issue #159, PRD #152): a device
 * that prepared while online (the reference bundle cached in IndexedDB by
 * `ReferenceCacheService`, issue #158) keeps the species/Station/Beringer
 * pickers and the Ringnummer suggestion working once connectivity is gone,
 * and shows the persistent "Offline" indication.
 *
 * Follows the offline-simulation pattern established by
 * `offline-cold-boot.spec.ts` (issue #156): stub `**​/api/**` while "online",
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

// Project has no default_station, so the Station field starts empty and the
// offline picker's own search (not just a prefill) is what has to work.
const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: false,
  organization: ORGANIZATION,
  default_station: null,
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

const OFFLINE_BUNDLE = {
  identity: {
    username: 'fre',
    handle: 'FRE',
    organization: ORGANIZATION,
    rolle: 'mitglied',
  },
  species: [KOHLMEISE, RING_VERNICHTET],
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
  // Deliberately empty/different from the cached bundle, so a picker that
  // (incorrectly) kept using stale online data once offline would show
  // nothing instead of the cached entries below.
  await page.route('**/api/birds/scientists/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/ringing-stations/**', (route) =>
    route.fulfill({ json: page0([]) }),
  );
  await page.route('**/api/birds/rings/next-number/**', (route) =>
    route.fulfill({ json: { next_number: null } }),
  );
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
}

// Re-routes every API call to a hard network failure (status 0 on the
// client), simulating the device losing connectivity entirely.
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

test.describe('Offline data-access facade (issue #159)', () => {
  test('populates the species/Station/Beringer pickers and the Ringnummer suggestion from the cache while offline, and shows the offline indication', async ({
    page,
  }) => {
    // Prepare online: sign in, pick the Projekt (mounts the nav bar, whose
    // Offline-Bereitschaft indicator fetches and caches the reference bundle
    // automatically).
    await stubApiOnline(page);
    await selectProject(page, PROJECT.title);
    await expectOfflineReadiness(page, 'zuletzt aktualisiert');

    // No offline indication while the app is online.
    await expect(page.locator('.offline-indicator')).toHaveCount(0);

    await goOffline(page);
    await page.goto('/data-entry');

    // The persistent "Offline" indication (CONTEXT.md's **Offline** entry).
    await expect(page.locator('.offline-indicator')).toContainText(
      'Offline – Einträge werden lokal gespeichert',
    );

    // Species picker: populated from the cached pool, which also pre-fills
    // Ringgröße from the selected Art.
    const species = page.locator('input[formControlName="species"]');
    await species.click();
    await species.fill('Kohl');
    await expect(page.locator('mat-option', { hasText: 'Kohlmeise' })).toBeVisible();
    await page.locator('mat-option', { hasText: 'Kohlmeise' }).click();
    await expect(page.locator('mat-select[formControlName="ring_size"]')).toContainText('V');

    // Station picker: populated from the cache (no default_station prefill
    // here, so this exercises the search itself, not just a carried-over
    // value).
    const station = page.locator('input[formControlName="ringing_station"]');
    await station.click();
    await station.fill('Linz');
    await expect(page.locator('mat-option', { hasText: STATION.name })).toBeVisible();
    await page.locator('mat-option', { hasText: STATION.name }).click();
    await expect(station).toHaveValue(STATION.name);

    // Beringer picker: populated from the cache.
    const staff = page.locator('input[formControlName="staff"]');
    await staff.click();
    await staff.fill('Filip');
    await expect(
      page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' }),
    ).toBeVisible();
    await page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' }).click();
    await expect(staff).toHaveValue('Filip Reiter (FRE)');

    // Ringnummer suggestion: the cached last-consumed number ("0042") + 1,
    // triggered by choosing Erstfang.
    await page.locator('mat-select[formControlName="bird_status"]').click();
    await page.locator('mat-option', { hasText: 'Erstfang' }).click();
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('0043');
  });
});
