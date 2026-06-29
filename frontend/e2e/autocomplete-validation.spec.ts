import { expect, Page, test } from '@playwright/test';

/**
 * E2E for the inline autocomplete validation (#58): typing a value into the Art
 * control that is never picked from the list must fail inline — an inline message,
 * the typed text kept on screen, and no network POST — instead of being accepted
 * by the form and rejected by the server as an opaque 400.
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
  is_sentinel: false,
};

const ART_ERROR = 'Unbekannte Art – bitte aus der Liste wählen';

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

test.describe('Inline autocomplete validation (#58)', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('typed non-match on Art shows an inline message, keeps the text, and POSTs nothing', async ({
    page,
  }) => {
    // Fail the test on any create POST — the whole point is that none fires.
    let createPosted = false;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/birds/data-entries/')
      ) {
        createPosted = true;
      }
    });

    // Selecting the project persists it, so the form route does not redirect home.
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);

    await page.goto('/data-entry');

    // Make the rest of the form valid so the Art is the only thing left blocking
    // the save — proving an unmatched Art alone keeps the form invalid.
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );

    const staff = page.locator('input[formControlName="staff"]');
    await staff.click();
    await staff.fill('FRE');
    await expect(page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' })).toBeVisible();
    await staff.press('ArrowDown');
    await staff.press('Enter');
    await expect(staff).toHaveValue('Filip Reiter (FRE)');

    await page.locator('mat-select[formControlName="bird_status"]').click();
    await page.locator('mat-option', { hasText: 'Wiederfang' }).click();

    await page.locator('mat-select[formControlName="ring_size"]').click();
    await page.getByRole('option', { name: 'S', exact: true }).click();

    await page.locator('input[formControlName="ring_number"]').fill('901234');

    // Art: type a value that matches no record and leave the field without picking
    // an option from the list. The control value stays the typed free text.
    const species = page.locator('input[formControlName="species"]');
    await species.click();
    await species.fill('Zaunkönigxyz');
    await species.blur();

    // The error surfaces on blur, and the typed text remains for correction.
    await expect(page.locator('mat-error', { hasText: ART_ERROR })).toBeVisible();
    await expect(species).toHaveValue('Zaunkönigxyz');

    // The save button stays disabled while the Art is unmatched...
    await expect(page.getByRole('button', { name: 'Erstellen' })).toBeDisabled();

    // ...and the keyboard save shortcut fires no POST either.
    await page.keyboard.press('Control+s');
    await expect(page.locator('mat-error', { hasText: ART_ERROR })).toBeVisible();
    expect(createPosted).toBe(false);
  });
});
