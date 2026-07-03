import {expect, Page, test} from '@playwright/test';

/**
 * E2E coverage for the Org-Admin "Beringer verwalten" surface (PRD #205, #206):
 * the admin-only user-menu entry navigates to /beringer, and a plain Mitglied
 * neither sees the entry nor may reach the route directly (orgAdminGuard).
 *
 * Every backend call is stubbed, so these run without a Django backend:
 *   - GET /api/auth/me/     → an authenticated user with a given Rolle
 *   - GET .../scientists/   → the Admin-aware Beringer list
 *   - other collections     → empty lists
 */

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

const BERINGER = [
  {
    id: '1',
    handle: 'FRE',
    first_name: 'Filip',
    last_name: 'Reiter',
    full_name: 'Filip Reiter',
    is_member: false,
    account: null,
  },
  {
    id: '2',
    handle: 'MAR',
    first_name: '',
    last_name: 'Moser',
    full_name: 'Mara Moser',
    is_member: true,
    account: {display_name: 'Mara Moser', email: 'mara@example.org', rolle: 'mitglied'},
  },
];

async function stubApi(page: Page, rolle: 'admin' | 'mitglied'): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({
      json: {
        username: 'fre',
        handle: 'FRE',
        is_staff: false,
        active_organization_rolle: rolle,
        active_organization: null,
      },
    }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/scientists/**', (route) => route.fulfill({json: page0(BERINGER)}));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({json: page0([])}));
}

test.describe('Beringer verwalten (Org-Admin)', () => {
  test('the admin-only "Beringer verwalten" entry navigates to /beringer', async ({page}) => {
    await stubApi(page, 'admin');
    await page.goto('/');

    await page.locator('.user-trigger').click();
    await page.getByRole('menuitem', {name: 'Beringer verwalten'}).click();

    await expect(page).toHaveURL(/\/beringer$/);
    await expect(page.locator('h1')).toContainText('Beringer verwalten');
    // The list renders with the two badge states.
    await expect(page.locator('.beringer-card__badge--member')).toContainText('Mitglied');
    await expect(page.locator('.beringer-card__badge--no-account')).toContainText('Ohne Konto');
  });

  test('a plain Mitglied sees no "Beringer verwalten" entry and cannot reach /beringer', async ({
    page,
  }) => {
    await stubApi(page, 'mitglied');
    await page.goto('/');

    await page.locator('.user-trigger').click();
    await expect(page.getByRole('menuitem', {name: 'Beringer verwalten'})).toHaveCount(0);

    // A direct hit on the guarded route is bounced back to the home picker.
    await page.goto('/beringer');
    await expect(page).toHaveURL(/\/$/);
  });
});
