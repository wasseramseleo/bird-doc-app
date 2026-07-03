import { expect, Page, test } from '@playwright/test';
import { selectProject } from './select-project';

/**
 * E2E for the compact Ringgröße field width (#45, parent #41).
 *
 * The Ringgröße select carries a short value (a single ring-size letter), so the
 * field only needs to be about as wide as its "Ringgröße" label. It used to
 * stretch to fill a full grid cell — more than double the label width. This
 * verifies, in a real browser, that the field is now constrained: it renders
 * meaningfully narrower than a sibling field (Ringnummer) that still fills its
 * grid cell, while remaining visible with its floating label intact.
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

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({ json: { username: 'fre', handle: 'FRE', is_staff: false } }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({ json: page0([PROJECT]) }));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/scientists/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
}

test.describe('Compact Ringgröße field width (#45)', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
    await selectProject(page, PROJECT.title);
    await page.goto('/data-entry');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );
  });

  test('renders the Ringgröße field at roughly label width, narrower than Ringnummer', async ({
    page,
  }) => {
    const ringSizeField = page.locator('mat-form-field:has([formControlName="ring_size"])');
    const ringNumberField = page.locator('mat-form-field:has([formControlName="ring_number"])');

    await expect(ringSizeField).toBeVisible();
    await expect(page.locator('mat-label', { hasText: 'Ringgröße' })).toBeVisible();

    const ringSizeBox = await ringSizeField.boundingBox();
    const ringNumberBox = await ringNumberField.boundingBox();
    expect(ringSizeBox).not.toBeNull();
    expect(ringNumberBox).not.toBeNull();

    // The compact field should be clearly narrower than a full-cell sibling —
    // at most 70% of the Ringnummer width — and close to its label width.
    expect(ringSizeBox!.width).toBeLessThan(ringNumberBox!.width * 0.7);
    expect(ringSizeBox!.width).toBeLessThanOrEqual(170);
  });
});
