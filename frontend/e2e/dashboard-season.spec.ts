import {expect, Page, test} from '@playwright/test';
import {selectProject} from './select-project';

/**
 * E2E capstone for the Projekt-Dashboard (PRD #292, issue #299). From a fully
 * stubbed stats payload it renders the populated season view (KPI row +
 * Stundenaktivität + Erstnachweise), the quiet-phase view (neutral chip + Ruhige
 * Phase + „Fangtag beginnen"), reaches the „Als Tabelle anzeigen" alternative for
 * the line chart, and asserts the dashboard is served by a single stats request.
 *
 * Every backend call is stubbed, so this runs without a Django backend — same
 * pattern as navigation-hub.spec.ts. The dashboard's recency chip and
 * Ruhige-Phase note read the REAL wall clock (DASHBOARD_NOW is not injected in
 * E2E), so `last_fangtag.date` is always computed relative to `new Date()`:
 * recent (gestern) for the populated view, long-stale (40 Tage) for the quiet
 * phase.
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

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

// An ISO date (`YYYY-MM-DD`) `n` calendar days before today. The last Fangtag's
// recency is measured against the real wall clock, so the fixtures compute their
// dates relative to now (a fresh „gestern" vs. a long-stale > 14 Tage) rather
// than hard-coding a date that would eventually go stale.
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// A full ProjectStats payload (models/project-stats.model.ts): totals,
// top_species, erstnachweise, a ≥ 3-Fangtag series with an Übrige line (so the
// Fänge sparkline draws and the table alternative has rows), a 24-slot hour
// histogram, and a last_fangtag whose date the caller pins to control the recency
// chip / quiet-phase note.
function stats(lastFangtagDate: string) {
  return {
    range: {from: '2026-06-26', to: '2026-07-03', preset: 'week'},
    totals: {faenge: 120, artenzahl: 17, fangtage: 16, erstfaenge: 90, wiederfaenge: 30},
    top_species: [
      {species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 34},
      {species_id: 'sp-2', name: 'Amsel', count: 21},
    ],
    erstnachweise: [
      {
        species_id: 'sp-1',
        name: 'Mönchsgrasmücke',
        scientific_name: 'Sylvia atricapilla',
        date: isoDaysAgo(2),
        beringer: 'Anna Huber',
      },
    ],
    series: {
      days: ['2026-06-26', '2026-06-28', '2026-07-02'],
      lines: [
        {species_id: 'sp-1', name: 'Mönchsgrasmücke', counts: [10, 12, 12]},
        {species_id: 'sp-2', name: 'Amsel', counts: [5, 8, 8]},
        {species_id: null, name: 'Übrige', counts: [2, 3, 4]},
      ],
    },
    hour_histogram: [0, 0, 0, 0, 0, 3, 9, 12, 8, 5, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    last_fangtag: {
      date: lastFangtagDate,
      faenge: 38,
      trend: {previous_fangtag: '2026-06-28', previous_faenge: 25, delta: 13},
      haeufigste_art: {species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 12},
      strongest_hour: {hour: 6, count: 9},
    },
  };
}

async function stubApi(page: Page, lastFangtagDate: string): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({json: {username: 'fre', handle: 'FRE', is_staff: false}}),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({json: page0([PROJECT])}));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/scientists/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/projects/*/stats/**', (route) =>
    route.fulfill({json: stats(lastFangtagDate)}),
  );
}

test.describe('Projekt-Dashboard season view (capstone, #299)', () => {
  test('renders the populated season view (KPI row, Stundenaktivität, Erstnachweise)', async ({
    page,
  }) => {
    await stubApi(page, isoDaysAgo(1)); // gestern → fresh, no quiet note
    await selectProject(page, 'Schilfgürtel Linz');

    await expect(page.locator('app-project-dashboard')).toBeVisible();

    // The KPI row with all four tiles.
    const kpiRow = page.locator('.kpi-row');
    await expect(kpiRow).toBeVisible();
    await expect(kpiRow).toContainText('Fänge');
    await expect(kpiRow).toContainText('Arten');
    await expect(kpiRow).toContainText('Fangtage');
    await expect(kpiRow).toContainText('Wiederfang-Anteil');

    // The Fangaktivität-nach-Tagesstunde histogram section.
    await expect(page.getByText('Fangaktivität nach Tagesstunde')).toBeVisible();
    await expect(page.locator('app-hour-histogram-chart')).toBeVisible();

    // The Erstnachweise arrival feed.
    await expect(page.locator('.erstnachweise')).toBeVisible();

    // A fresh last Fangtag is not a quiet phase.
    await expect(page.locator('.quiet-phase')).toHaveCount(0);
  });

  test('renders the quiet-phase payload with the neutral chip, „Ruhige Phase" note and „Fangtag beginnen" action', async ({
    page,
  }) => {
    await stubApi(page, isoDaysAgo(40)); // > 14 Tage → quiet
    await selectProject(page, 'Schilfgürtel Linz');

    await expect(page.locator('app-project-dashboard')).toBeVisible();

    // The recency chip is always shown, but neutral (not success-tinted) for a
    // long-stale last Fangtag.
    const chip = page.locator('.fangtag-strip__chip');
    await expect(chip).toBeVisible();
    await expect(chip).not.toHaveClass(/fangtag-strip__chip--recent/);

    // The calm Ruhige-Phase note offering a way back into capturing (/heute).
    await expect(page.locator('.quiet-phase')).toBeVisible();
    const action = page.locator('.quiet-phase__action');
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute('href', '/heute');
  });

  test('reaches the table alternative for the „Fänge pro Fangtag" line chart', async ({page}) => {
    await stubApi(page, isoDaysAgo(1));
    await selectProject(page, 'Schilfgürtel Linz');

    await expect(page.locator('app-project-dashboard')).toBeVisible();

    // Chart first, table on demand.
    await expect(page.locator('app-species-line-chart')).toBeVisible();
    await expect(page.locator('table.series-table')).toHaveCount(0);

    await page.locator('.chart-panel__table-toggle').click();

    // The chart is swapped for the table alternative, carrying the same series.
    const table = page.locator('table.series-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Mönchsgrasmücke');
    await expect(table).toContainText('Übrige');
    await expect(page.locator('app-species-line-chart')).toHaveCount(0);
  });

  test('serves the dashboard from a single stats request', async ({page}) => {
    let statsHits = 0;
    await stubApi(page, isoDaysAgo(1));
    // Count the stats route for one dashboard load; registered after stubApi so it
    // wins the overlapping pattern (Playwright matches the most-recently-added
    // route first).
    await page.route('**/api/birds/projects/*/stats/**', (route) => {
      statsHits += 1;
      route.fulfill({json: stats(isoDaysAgo(1))});
    });

    await selectProject(page, 'Schilfgürtel Linz');
    await expect(page.locator('app-project-dashboard')).toBeVisible();
    await expect(page.locator('.kpi-row')).toBeVisible();

    // One dashboard load ⇒ exactly one stats request feeds the whole view.
    expect(statsHits).toBe(1);
  });
});
