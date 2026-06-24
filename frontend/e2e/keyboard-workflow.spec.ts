import { expect, Page, test } from '@playwright/test';

/**
 * E2E happy-path for the keyboard-driven field workflow (#23):
 * record a Wiederfang, run the ring-history search on Enter (which prefills
 * Art + Geschlecht), then save with Strg+S — no mouse on the save button.
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

// The most recent prior catch the ring-history search returns. Art + Geschlecht
// (Weiblich = 2) must carry over to the form; measurements must not.
const PRIOR_CATCH = {
  id: 'prev1',
  species: SPECIES,
  bird_status: 'w',
  staff: BERINGER,
  sex: 2,
  age_class: 4,
  tarsus: 19,
  feather_span: 54,
  wing_span: 73,
  weight_gram: 18,
  date_time: '2024-05-01T08:30:00Z',
};

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

let createdPayload: Record<string, unknown> | null = null;

async function stubApi(page: Page): Promise<void> {
  createdPayload = null;
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
    const request = route.request();
    if (request.method() === 'POST') {
      createdPayload = request.postDataJSON();
      return route.fulfill({ json: { id: 'new1' } });
    }
    const url = new URL(request.url());
    // The ring-history search carries a ring_number param; the list view does not.
    if (url.searchParams.get('ring_number')) {
      return route.fulfill({ json: page0([PRIOR_CATCH]) });
    }
    return route.fulfill({ json: page0([]) });
  });
}

test.describe('Keyboard workflow happy-path (#23)', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('records a Wiederfang via Enter-search and saves with Strg+S', async ({ page }) => {
    // Selecting the project persists it, so the form route does not redirect home.
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);

    await page.goto('/data-entry');

    // Station is pre-filled from the project default.
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );

    // Beringer: type the Kürzel and accept the open autocomplete option with
    // Enter — which also advances focus to the next field (Datum und Uhrzeit).
    const staff = page.locator('input[formControlName="staff"]');
    await staff.click();
    await staff.fill('FRE');
    await expect(page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' })).toBeVisible();
    await staff.press('ArrowDown');
    await staff.press('Enter');
    await expect(staff).toHaveValue('Filip Reiter (FRE)');
    await expect(page.locator('input[formControlName="date_time"]')).toBeFocused();

    // Status: Wiederfang (enables the recapture Enter behaviour).
    await page.locator('mat-select[formControlName="bird_status"]').click();
    await page.locator('mat-option', { hasText: 'Wiederfang' }).click();

    // Ringgröße: pick a size so the ring search has both parts. The field now
    // shows only the bare code (#25), so match the option exactly — 'S' must not
    // also match SA/AS/BS/DS.
    await page.locator('mat-select[formControlName="ring_size"]').click();
    await page.getByRole('option', { name: 'S', exact: true }).click();

    // Ringnummer + Enter → ring-history search → Art/Geschlecht prefill.
    await page.locator('input[formControlName="ring_number"]').fill('901234');
    await page.locator('input[formControlName="ring_number"]').press('Enter');

    await expect(page.locator('.recapture-section')).toContainText('Bisherige Fänge');
    await expect(page.locator('input[formControlName="species"]')).toHaveValue('Kohlmeise');

    // Save with Strg+S — never touching the save button.
    const savePost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.keyboard.press('Control+s');
    await savePost;

    // The record was created with the typed ring number and the prefilled
    // Geschlecht (Weiblich = 2) — proving Strg+S saved the recapture.
    expect(createdPayload?.['ring_number']).toBe('901234');
    expect(createdPayload?.['sex']).toBe(2);

    // Create mode clears the form after a successful save.
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('');
  });
});
