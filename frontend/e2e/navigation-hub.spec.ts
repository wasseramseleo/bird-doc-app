import {expect, Page, test} from '@playwright/test';

/**
 * E2E coverage for the data-entry list as the project navigation hub (#17).
 *
 * Every backend call is stubbed, so these run without a Django backend:
 *   - GET /api/auth/me/        → an authenticated user (satisfies authGuard)
 *   - GET .../projects/        → one selectable project
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

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({json: {username: 'fre', handle: 'FRE', is_staff: false}}),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({json: page0([PROJECT])}));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/scientists/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({json: page0([])}));
}

test.describe('Data-entry list as navigation hub', () => {
  test.beforeEach(async ({page}) => {
    await stubApi(page);
  });

  test('selecting a project lands on the data-entry hub', async ({page}) => {
    await page.goto('/');

    await page.locator('.project-card__main', {hasText: 'Schilfgürtel Linz'}).click();

    await expect(page).toHaveURL(/\/data-entries$/);
  });

  test('header shows the project title and a Letzte Fänge link once a project is active', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('.project-card__main', {hasText: 'Schilfgürtel Linz'}).click();
    await expect(page).toHaveURL(/\/data-entries$/);

    await expect(page.locator('.project-context')).toHaveText('Schilfgürtel Linz');
    const hubLink = page.locator('a[href="/data-entries"]');
    await expect(hubLink).toBeVisible();
    await expect(hubLink).toContainText('Letzte Fänge');
  });

  test('header shows neither the title nor the link when no project is active', async ({page}) => {
    await page.goto('/');

    // On the home screen no project has been selected yet.
    await expect(page.locator('.project-card__main').first()).toBeVisible();
    await expect(page.locator('.project-context')).toHaveCount(0);
    await expect(page.locator('a[href="/data-entries"]')).toHaveCount(0);
  });
});
