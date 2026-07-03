import { expect, Locator, Page, test } from '@playwright/test';
import { selectProject } from './select-project';

/**
 * E2E for #273 — the Wiederfang ring-search refinements, both scoped to the
 * data-entry form:
 *
 *  1. Layout: the "Ringhistorie suchen" magnifying-glass is folded into the
 *     Ringnummer field as a matSuffix, so it stays on the Ringnummer's own row
 *     instead of wrapping onto a line of its own (as it did once the Zentrale
 *     field arrived in #226). Asserted by geometry, in the style of
 *     `ring-size-field-width.spec.ts`.
 *
 *  2. Blur auto-search: leaving the Ringnummer field runs the ring-history
 *     lookup automatically — the same action as Enter or the button — and the
 *     "Bisherige Fänge" panel appears. The lookup is idempotent against the
 *     ring, so Enter-then-blur and blur-twice each perform exactly one lookup.
 *     Modelled on `offline-wiederfang-history.spec.ts`, but online, counting
 *     the ring-history route to prove no double-fetch.
 *
 * Every backend call is stubbed via `page.route`, so this runs without a
 * Django backend.
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

const KOHLMEISE = {
  id: 's1',
  common_name_de: 'Kohlmeise',
  common_name_en: 'Great Tit',
  scientific_name: 'Parus major',
  family_name: '',
  order_name: '',
  ring_size: 'V',
  special_kind: '',
};

// A prior Fang of ring V 0043, returned by the ring-history lookup so the
// "Bisherige Fänge" panel has a row to show.
const PRIOR_CATCH = {
  id: 'prior-1',
  date_time: '2026-07-01T08:30:00Z',
  species: KOHLMEISE,
  ring: { id: 'r1', number: '0043', size: 'V' },
  bird_status: 'w',
  staff: { full_name: 'Filip Reiter', handle: 'FRE' },
  age_class: 2,
  sex: 2,
};

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

// The ring-history lookup is GET /data-entries/?ring_size=…&ring_number=… — the
// only data-entries call carrying those params. The counter lets a test assert
// how many lookups the auto-search actually performed.
async function stubApi(page: Page): Promise<{ count: number }> {
  const counter = { count: 0 };
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({ json: { username: 'fre', handle: 'FRE', is_staff: false } }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({ json: page0([PROJECT]) }));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/scientists/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([KOHLMEISE]) }));
  await page.route('**/api/birds/rings/next-number/**', (route) =>
    route.fulfill({ json: { next_number: null } }),
  );
  await page.route('**/api/birds/data-entries/**', (route) => {
    const url = route.request().url();
    if (url.includes('ring_size=') && url.includes('ring_number=')) {
      counter.count += 1;
      return route.fulfill({ json: page0([PRIOR_CATCH]) });
    }
    return route.fulfill({ json: page0([]) });
  });
  return counter;
}

// Open the capture form on a Wiederfang of a Kohlmeise: selecting the species
// pre-fills Ringgröße "V"; the Ringnummer is left for the test to type.
async function openWiederfang(page: Page): Promise<Locator> {
  await selectProject(page, PROJECT.title);
  await page.goto('/data-entry');

  const species = page.locator('input[formControlName="species"]');
  await species.click();
  await species.fill('Kohl');
  await page.locator('mat-option', { hasText: 'Kohlmeise' }).click();

  await page.locator('mat-select[formControlName="bird_status"]').click();
  await page.locator('mat-option', { hasText: 'Wiederfang' }).click();

  return page.locator('input[formControlName="ring_number"]');
}

test.describe('Wiederfang ring-search row layout (#273)', () => {
  test('keeps the search control on the Ringnummer field row, not wrapped below it', async ({
    page,
  }) => {
    await stubApi(page);
    const ringNumber = await openWiederfang(page);
    await ringNumber.fill('0043');

    const field = page.locator('mat-form-field:has([formControlName="ring_number"])');
    const searchButton = page.locator('button[aria-label="Ringhistorie suchen"]');
    await expect(searchButton).toBeVisible();

    const fieldBox = await field.boundingBox();
    const buttonBox = await searchButton.boundingBox();
    expect(fieldBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();

    // The search control's vertical centre falls within the Ringnummer field's
    // vertical bounds — i.e. on the same row — not on a line of its own below it.
    const buttonCentreY = buttonBox!.y + buttonBox!.height / 2;
    expect(buttonCentreY).toBeGreaterThanOrEqual(fieldBox!.y);
    expect(buttonCentreY).toBeLessThanOrEqual(fieldBox!.y + fieldBox!.height);
  });
});

test.describe('Wiederfang auto-search on Ringnummer blur (#273)', () => {
  test('runs the lookup and shows the history panel when leaving the Ringnummer field', async ({
    page,
  }) => {
    const counter = await stubApi(page);
    const ringNumber = await openWiederfang(page);
    await ringNumber.fill('0043');

    await ringNumber.blur();

    const panel = page.locator('.recapture-section');
    await expect(panel).toBeVisible();
    await expect(panel.locator('h3')).toContainText('Bisherige Fänge (1)');
    await expect(panel.locator('td.mat-column-species')).toContainText('Kohlmeise');
    expect(counter.count).toBe(1);
  });

  test('prefills Art from the prior Fang on the blur lookup', async ({ page }) => {
    await stubApi(page);
    const ringNumber = await openWiederfang(page);
    await ringNumber.fill('0043');

    await ringNumber.blur();

    await expect(page.locator('.recapture-section')).toBeVisible();
    await expect(page.locator('input[formControlName="species"]')).toHaveValue('Kohlmeise');
  });

  test('performs exactly one lookup when Enter is followed by leaving the field', async ({
    page,
  }) => {
    const counter = await stubApi(page);
    const ringNumber = await openWiederfang(page);
    await ringNumber.fill('0043');

    await ringNumber.press('Enter');
    await expect(page.locator('.recapture-section')).toBeVisible();

    // Tabbing/blurring away after the explicit Enter must not fetch again.
    await ringNumber.blur();
    await page.waitForTimeout(200);

    expect(counter.count).toBe(1);
  });

  test('performs exactly one lookup when the field is left twice without changing the ring', async ({
    page,
  }) => {
    const counter = await stubApi(page);
    const ringNumber = await openWiederfang(page);
    await ringNumber.fill('0043');

    await ringNumber.blur();
    await expect(page.locator('.recapture-section')).toBeVisible();

    await ringNumber.click();
    await ringNumber.blur();
    await page.waitForTimeout(200);

    expect(counter.count).toBe(1);
  });
});
