import { expect, Page, test } from '@playwright/test';

/**
 * E2E for #27: once a Projekt is selected, the species autocomplete must scope
 * its query to that project, so the backend can order species by project usage.
 *
 * Every backend call is stubbed, so this runs without a Django backend.
 */

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
};

const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: false,
  organization: STATION.organization,
  default_station: STATION,
  scientists: [],
  created: '2026-06-01T00:00:00Z',
  updated: '2026-06-01T00:00:00Z',
};

const SPECIES = {
  id: 's1',
  common_name_de: 'Kohlmeise',
  common_name_en: 'Great Tit',
  scientific_name: 'Parus major',
  family_name: '',
  order_name: '',
  ring_size: null,
  is_sentinel: false,
};

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

const speciesRequestUrls: string[] = [];

async function stubApi(page: Page): Promise<void> {
  speciesRequestUrls.length = 0;
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({ json: { username: 'fre', handle: 'FRE', is_staff: false } }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({ json: page0([PROJECT]) }));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/scientists/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/species/**', (route) => {
    speciesRequestUrls.push(route.request().url());
    return route.fulfill({ json: page0([SPECIES]) });
  });
}

test.describe('Species project-scoped ordering (#27)', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('species autocomplete query carries the current project', async ({ page }) => {
    // Selecting the project persists it as the current project.
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);

    await page.goto('/data-entry');

    // Drive the species autocomplete like a beringer would.
    const species = page.locator('input[formControlName="species"]');
    await species.click();
    await species.fill('Kohl');
    await expect(page.locator('mat-option', { hasText: 'Kohlmeise' })).toBeVisible();

    // Every species request issued while a project is active must scope to it.
    expect(speciesRequestUrls.length).toBeGreaterThan(0);
    for (const url of speciesRequestUrls) {
      expect(new URL(url).searchParams.get('project')).toBe(PROJECT.id);
    }
  });
});
