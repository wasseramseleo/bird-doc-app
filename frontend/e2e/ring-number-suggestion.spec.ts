import { expect, Page, test } from '@playwright/test';

/**
 * E2E for #42: the next-number suggestion is the last-consumed number + 1,
 * returned as a string so leading zeros survive, and `null` when there is no
 * suggestion (the field is then left empty).
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
  ring_size: 'V',
  is_sentinel: false,
};

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

async function stubApi(page: Page, nextNumber: string | null): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({ json: { username: 'fre', handle: 'FRE', is_staff: false } }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({ json: page0([PROJECT]) }));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/scientists/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([SPECIES]) }));
  await page.route('**/api/birds/rings/next-number/**', (route) =>
    route.fulfill({ json: { next_number: nextNumber } }),
  );
}

async function selectProjectThenSpecies(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
  await expect(page).toHaveURL(/\/data-entries$/);

  await page.goto('/data-entry');

  // Selecting a species pre-fills its recommended ring size...
  const species = page.locator('input[formControlName="species"]');
  await species.click();
  await species.fill('Kohl');
  await page.locator('mat-option', { hasText: 'Kohlmeise' }).click();

  // ...and choosing Erstfang as the status is what triggers the suggestion.
  await page.locator('mat-select[formControlName="bird_status"]').click();
  await page.locator('mat-option', { hasText: 'Erstfang' }).click();
}

test.describe('Ring-number suggestion (#42)', () => {
  test('populates the Ringnummer with the suggestion verbatim, preserving leading zeros', async ({
    page,
  }) => {
    await stubApi(page, '0043');

    await selectProjectThenSpecies(page);

    const ringNumber = page.locator('input[formControlName="ring_number"]');
    await expect(ringNumber).toHaveValue('0043');

    await page.screenshot({ path: 'test-results/ring-number-0043.png' });
  });

  test('leaves the Ringnummer empty when there is no suggestion (null)', async ({ page }) => {
    await stubApi(page, null);

    await selectProjectThenSpecies(page);

    const ringNumber = page.locator('input[formControlName="ring_number"]');
    await expect(ringNumber).toHaveValue('');

    await page.screenshot({ path: 'test-results/ring-number-null.png' });
  });
});
