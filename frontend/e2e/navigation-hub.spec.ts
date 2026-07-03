import {expect, Page, test} from '@playwright/test';
import {selectProject} from './select-project';

/**
 * E2E coverage for the navbar project switcher (#37) and the dedicated project
 * picker at /projekte (#221).
 *
 * Post-ADR-0018 navigation: selecting/switching a Projekt lands on the home
 * dashboard (`/`), the picker lives at its own `/projekte` route, and `/` with no
 * current Projekt redirects there. "Alle Projekte …" opens /projekte without
 * clearing the current Projekt.
 *
 * Every backend call is stubbed, so these run without a Django backend:
 *   - GET /api/auth/me/            → an authenticated user (satisfies authGuard)
 *   - GET .../projects/            → two selectable projects (so a switch is observable)
 *   - GET .../projects/<id>/stats/ → a populated dashboard payload
 *   - GET .../organizations/, .../scientists/, .../data-entries/ → empty lists
 */

const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: false,
  organization: {id: 'o1', name: 'IWM Linz'},
  default_station: null,
  scientists: [],
  created: '2026-06-01T00:00:00Z',
  updated: '2026-06-01T00:00:00Z',
};

const PROJECT2 = {
  ...PROJECT,
  id: 'p2',
  title: 'Donau-Auen',
};

// A populated stats payload so the home dashboard (ADR 0018) renders its
// "Letzter Tag" card once a Projekt is active.
const STATS = {
  range: {from: '2026-06-26', to: '2026-07-03', preset: 'week'},
  totals: {faenge: 142, artenzahl: 17},
  top_species: [{species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 12}],
  last_fangtag: {
    date: '2026-07-02',
    faenge: 38,
    trend: {previous_fangtag: '2026-06-28', previous_faenge: 25, delta: 13},
    haeufigste_art: {species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 12},
    strongest_hour: {hour: 6, count: 9},
  },
};

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

// A minimal list row whose species name we can assert against per project.
function entry(id: string, speciesName: string) {
  return {
    id,
    created: '2026-06-01T08:00:00Z',
    date_time: '2026-06-01T08:00:00Z',
    ring: {id: 'r1', number: '901234', size: 'M'},
    species: {id: 's1', common_name_de: speciesName, special_kind: ''},
    bird_status: 'e',
    staff: {id: 'p1', handle: 'FRE', full_name: 'Filip Reiter'},
    tarsus: 19,
    feather_span: 54,
    wing_span: 73,
    weight_gram: 18,
  };
}

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({json: {username: 'fre', handle: 'FRE', is_staff: false}}),
  );
  await page.route('**/api/birds/projects/', (route) =>
    route.fulfill({json: page0([PROJECT, PROJECT2])}),
  );
  await page.route('**/api/birds/projects/*/stats/**', (route) => route.fulfill({json: STATS}));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/scientists/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({json: page0([])}));
}

test.describe('Project switcher and the /projekte picker', () => {
  test.beforeEach(async ({page}) => {
    await stubApi(page);
  });

  test('/ redirects to the /projekte picker when no Projekt is selected (#221)', async ({page}) => {
    await page.goto('/');

    // No current Projekt: the home guard sends us to the dedicated picker.
    await expect(page).toHaveURL(/\/projekte$/);
    await expect(page.locator('.project-card__main').first()).toBeVisible();
    // The switcher only appears once a Projekt is active.
    await expect(page.locator('.project-switcher')).toHaveCount(0);
    await expect(page.locator('a[href="/data-entries"]')).toHaveCount(0);
  });

  test('selecting a Projekt lands on its dashboard at / (ADR 0018)', async ({page}) => {
    await page.goto('/');

    await page.locator('.project-card__main', {hasText: 'Schilfgürtel Linz'}).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('app-project-dashboard')).toBeVisible();
    await expect(page.locator('.project-switcher')).toContainText('Schilfgürtel Linz');
    const hubLink = page.locator('a[href="/data-entries"]');
    await expect(hubLink).toBeVisible();
    await expect(hubLink).toContainText('Letzte Fänge');
  });

  test('the switcher lists projects and switching stays on the dashboard', async ({page}) => {
    await selectProject(page, 'Schilfgürtel Linz');

    await page.locator('.project-switcher').click();

    // The menu lists both projects plus the "Alle Projekte …" escape hatch.
    await expect(page.getByRole('menuitem', {name: 'Schilfgürtel Linz'})).toBeVisible();
    await expect(page.getByRole('menuitem', {name: 'Donau-Auen'})).toBeVisible();
    await expect(page.getByRole('menuitem', {name: /Alle Projekte/})).toBeVisible();

    // Switching to the second project stays on the dashboard and updates the trigger.
    await page.getByRole('menuitem', {name: 'Donau-Auen'}).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.project-switcher')).toContainText('Donau-Auen');
  });

  test('"Letzte Fänge" reflects the current Projekt after a switch (#44)', async ({page}) => {
    // Serve a different species per project so a reload is visible in the rows.
    await page.route('**/api/birds/data-entries/**', (route) => {
      const project = new URL(route.request().url()).searchParams.get('project');
      const species = project === 'p2' ? 'Blaumeise' : 'Kohlmeise';
      route.fulfill({json: page0([entry(`${project}-row`, species)])});
    });

    await selectProject(page, 'Schilfgürtel Linz');

    // First project's data on the "Letzte Fänge" hub.
    await page.locator('a[href="/data-entries"]').click();
    await expect(page).toHaveURL(/\/data-entries$/);
    await expect(page.locator('tr.entry-row')).toContainText('Kohlmeise');

    // Switch projects via the navbar switcher (lands back on the dashboard)…
    await page.locator('.project-switcher').click();
    await page.getByRole('menuitem', {name: 'Donau-Auen'}).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.project-switcher')).toContainText('Donau-Auen');

    // …then the hub shows the new project's data, none of the first's.
    await page.locator('a[href="/data-entries"]').click();
    await expect(page).toHaveURL(/\/data-entries$/);
    await expect(page.locator('tr.entry-row')).toContainText('Blaumeise');
    await expect(page.locator('tr.entry-row')).not.toContainText('Kohlmeise');
  });

  test('the "Neuer Fang" action routes to the data-entry form', async ({page}) => {
    await selectProject(page, 'Schilfgürtel Linz');

    await page.locator('.new-fang').click();

    await expect(page).toHaveURL(/\/data-entry$/);
  });

  test('"Alle Projekte …" opens /projekte and keeps the current Projekt (#221)', async ({page}) => {
    await selectProject(page, 'Schilfgürtel Linz');

    await page.locator('.project-switcher').click();
    await page.getByRole('menuitem', {name: /Alle Projekte/}).click();

    // Navigates to the dedicated picker…
    await expect(page).toHaveURL(/\/projekte$/);
    await expect(page.locator('.project-card__main').first()).toBeVisible();
    // …without clearing the current Projekt: the switcher stays visible so the
    // user can return to their dashboard.
    await expect(page.locator('.project-switcher')).toContainText('Schilfgürtel Linz');
  });
});
