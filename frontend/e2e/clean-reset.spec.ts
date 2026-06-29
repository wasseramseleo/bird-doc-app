import { expect, Page, test } from '@playwright/test';

/**
 * E2E for the clean-reset / Zurücksetzen behaviour (#24):
 * - after a successful save the form is clean with NO required-field errors and
 *   the Art field is focused (the post-save Pflichtfeld-bug is gone);
 * - the action bar offers a "Zurücksetzen" button instead of "Abbrechen";
 * - Zurücksetzen on a dirty form asks for confirmation before clearing.
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

const BERINGER = { id: 'sc1', handle: 'FRE', full_name: 'Filip Reiter' };

const SPECIES = {
  id: 's1',
  common_name_de: 'Kohlmeise',
  common_name_en: 'Great Tit',
  scientific_name: 'Parus major',
  family_name: '',
  order_name: '',
  ring_size: null,
  special_kind: '',
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
  await page.route('**/api/birds/scientists/**', (route) =>
    route.fulfill({ json: page0([BERINGER]) }),
  );
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([SPECIES]) }));
  await page.route('**/api/birds/data-entries/**', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { id: 'new1' } });
    }
    return route.fulfill({ json: page0([]) });
  });
}

async function gotoCreateForm(page: Page): Promise<void> {
  await stubApi(page);
  await page.goto('/');
  await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
  await expect(page).toHaveURL(/\/data-entries$/);
  await page.goto('/data-entry');
  await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(STATION.name);
}

async function fillMinimalErstfang(page: Page): Promise<void> {
  const staff = page.locator('input[formControlName="staff"]');
  await staff.click();
  await staff.fill('FRE');
  await page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' }).click();

  const species = page.locator('input[formControlName="species"]');
  await species.click();
  await species.fill('Kohl');
  await page.locator('mat-option', { hasText: 'Kohlmeise' }).click();

  await page.locator('mat-select[formControlName="bird_status"]').click();
  await page.locator('mat-option', { hasText: 'Erstfang' }).click();

  // Ringgröße shows the bare code (#25), so match exactly — 'S' must not also
  // match SA/AS/BS/DS.
  await page.locator('mat-select[formControlName="ring_size"]').click();
  await page.getByRole('option', { name: 'S', exact: true }).click();

  await page.locator('input[formControlName="ring_number"]').fill('901234');
}

test.describe('Clean-reset / Zurücksetzen (#24)', () => {
  test('shows a Zurücksetzen button instead of Abbrechen', async ({ page }) => {
    await gotoCreateForm(page);

    await expect(page.locator('.action-buttons button', { hasText: 'Zurücksetzen' })).toBeVisible();
    await expect(page.locator('.action-buttons button', { hasText: 'Abbrechen' })).toHaveCount(0);
  });

  test('after saving, the form is clean with no required-field errors and Art is focused', async ({
    page,
  }) => {
    await gotoCreateForm(page);
    await fillMinimalErstfang(page);

    const savePost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.keyboard.press('Control+s');
    await savePost;

    // Wait for the reset to land (the bird fields are emptied), then assert the
    // post-save Pflichtfeld-bug is gone: no error messages and no field left in an
    // invalid/touched error state — even though Ringnummer held focus at save.
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('');
    await expect(page.locator('input[formControlName="species"]')).toBeFocused();
    await expect(page.locator('mat-error')).toHaveCount(0);
    await expect(page.locator('.mat-form-field-invalid')).toHaveCount(0);
    // Station and Beringer are kept for the next bird.
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );

    await page.screenshot({ path: 'test-results/after-save-clean.png', fullPage: true });
  });

  test('Zurücksetzen on a dirty form asks for confirmation', async ({ page }) => {
    await gotoCreateForm(page);
    await fillMinimalErstfang(page);

    await page.locator('.action-buttons button', { hasText: 'Zurücksetzen' }).click();

    const dialog = page.locator('app-confirm-dialog');
    await expect(dialog).toContainText('zurücksetzen');
    await page.screenshot({ path: 'test-results/reset-confirm.png', fullPage: true });

    // Confirm clears the bird fields.
    await dialog.locator('button', { hasText: 'Zurücksetzen' }).click();
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('');
  });
});
