import { expect, Page, test } from '@playwright/test';
import { selectProject } from './select-project';

/**
 * E2E for the Tab-Reihenfolge of the capture form's action row (#387):
 * a single Tab from the last measurement field (Innenfuß) must land on the
 * primary action ("Erstellen" / "Änderungen speichern") — never on the
 * destructive "Ring vernichtet" or on "Zurücksetzen".
 *
 * This asserts the *traversal*, not the attributes: the Karma suite already
 * checks every `tabindex="-1"`, and every one of them can be right while the
 * order is still wrong. Only a real browser moves focus on a Tab keypress, so
 * this gap can only be closed here.
 *
 * Every backend call is stubbed, so this runs without a Django backend.
 */

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
};

// Innenfuß only renders while the Projekt shows the optional fields.
const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: true,
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

// The entry the edit route loads — a complete Wiederfang, so the form is valid
// (and the primary action therefore enabled) the moment it is pre-filled.
const SAVED_ENTRY = {
  id: '42',
  species: SPECIES,
  ring: { id: 'r1', number: '901234', size: 'S' },
  staff: BERINGER,
  ringing_station: STATION,
  project: null,
  net_location: null,
  net_height: null,
  net_direction: null,
  feather_span: 54,
  wing_span: 73,
  tarsus: 19,
  notch_f2: null,
  inner_foot: null,
  weight_gram: 18,
  bird_status: 'w',
  fat_deposit: null,
  muscle_class: null,
  age_class: 4,
  sex: 2,
  small_feather_int: null,
  small_feather_app: null,
  hand_wing: null,
  date_time: '2024-05-01T08:30:00Z',
  created: '2024-05-01T08:30:00Z',
  updated: '2024-05-01T08:30:00Z',
  comment: 'Wiederfang am Hauptnetz',
  parasites: [],
  has_hunger_stripes: false,
  has_brood_patch: false,
  has_cpl_plus: false,
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
    const url = new URL(route.request().url());
    // The edit route fetches one entry by id: /api/birds/data-entries/42/
    if (/\/data-entries\/42\/?$/.test(url.pathname)) {
      return route.fulfill({ json: SAVED_ENTRY });
    }
    return route.fulfill({ json: page0([]) });
  });
}

/** The row's primary action — "Erstellen" on create, "Änderungen speichern" on edit. */
const saveButton = (page: Page) => page.locator('.action-buttons button[type="submit"]');

test.describe('Aktionszeile: Tab vom Innenfuß auf Speichern (#387)', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('Tab from Innenfuß focuses the primary action in create mode', async ({ page }) => {
    await selectProject(page, PROJECT.title);
    await page.goto('/data-entry');

    // Fill the Pflichtfelder — a disabled button is not tabbable, so the form
    // has to be valid for the traversal under test to be the real one.
    const staff = page.locator('input[formControlName="staff"]');
    await staff.click();
    await staff.fill('FRE');
    await expect(page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' })).toBeVisible();
    await staff.press('ArrowDown');
    await staff.press('Enter');

    await page.locator('mat-select[formControlName="bird_status"]').click();
    await page.locator('mat-option', { hasText: 'Wiederfang' }).click();

    const species = page.locator('input[formControlName="species"]');
    await species.click();
    await species.fill('Kohlmeise');
    await expect(page.locator('mat-option', { hasText: 'Kohlmeise' })).toBeVisible();
    await species.press('ArrowDown');
    await species.press('Enter');

    await page.locator('mat-select[formControlName="ring_size"]').click();
    await page.getByRole('option', { name: 'S', exact: true }).click();

    await page.locator('input[formControlName="ring_number"]').fill('901234');

    await expect(saveButton(page)).toBeEnabled();

    const innerFoot = page.locator('input[formControlName="inner_foot"]');
    await innerFoot.focus();
    await expect(innerFoot).toBeFocused();

    await page.keyboard.press('Tab');

    // Neither "Ring vernichtet" nor "Zurücksetzen" — straight to the primary action.
    await expect(saveButton(page)).toBeFocused();
  });

  test('Tab from Innenfuß focuses the primary action in edit mode', async ({ page }) => {
    await selectProject(page, PROJECT.title);
    await page.goto('/data-entry/42');

    // The loaded entry pre-fills the form; "Zur Liste" only exists in edit mode
    // and must be skipped too.
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('901234');
    await expect(page.locator('.action-buttons button', { hasText: 'Zur Liste' })).toBeVisible();
    await expect(saveButton(page)).toBeEnabled();

    const innerFoot = page.locator('input[formControlName="inner_foot"]');
    await innerFoot.focus();
    await expect(innerFoot).toBeFocused();

    await page.keyboard.press('Tab');

    await expect(saveButton(page)).toBeFocused();
  });
});
