import {expect, Page, test} from '@playwright/test';

/**
 * E2E for the "Mitglieder ohne Beringer-Eintrag" gap panel (PRD #205, #210):
 * an Org-Admin sees the Organisation's seat that has no Beringer yet, and a
 * happy-path "Beringer zuordnen" (verknüpfen an existing no-account Beringer)
 * promotes that member to "Mitglied" — the seat leaves the gap panel.
 *
 * Every backend call is stubbed, so this runs without a Django backend. The
 * attach PATCH flips a state flag; the subsequent GET reloads then reflect the
 * reconciled world (the seat now carries a handle, the Beringer is a Mitglied).
 */

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

const FREI = {
  id: '1',
  handle: 'FRE',
  first_name: 'Frei',
  last_name: 'Beringer',
  full_name: 'Frei Beringer',
  is_member: false,
  account: null,
};

const MITGLIED = {
  ...FREI,
  is_member: true,
  account: {display_name: 'Frei Beringer', email: 'gap@example.org', rolle: 'mitglied'},
};

const SEAT = {
  id: 's1',
  username: 'gapuser',
  email: 'gap@example.org',
  rolle: 'mitglied',
  created: '2026-01-01T00:00:00Z',
};

async function stubApi(page: Page): Promise<void> {
  // `assigned` flips once the attach PATCH lands, so the reload GETs return the
  // reconciled state: the seat now has a handle (no longer a gap) and the
  // Beringer is a Mitglied.
  let assigned = false;

  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({
      json: {
        username: 'admin',
        handle: 'ADM',
        is_staff: false,
        active_organization_rolle: 'admin',
        active_organization: null,
      },
    }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({json: page0([])}));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({json: page0([])}));

  await page.route('**/api/birds/scientists/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      assigned = true;
      await route.fulfill({json: MITGLIED});
      return;
    }
    await route.fulfill({json: page0([assigned ? MITGLIED : FREI])});
  });

  await page.route('**/api/birds/mitgliedschaften/**', (route) =>
    route.fulfill({json: page0([{...SEAT, handle: assigned ? 'FRE' : null}])}),
  );
}

test.describe('Mitglieder ohne Beringer-Eintrag (gap panel)', () => {
  test('assigning an existing Beringer through the gap panel promotes the member to "Mitglied"', async ({
    page,
  }) => {
    await stubApi(page);
    await page.goto('/beringer');

    // The gap panel surfaces the seat that has no Beringer yet.
    const gapCard = page.locator('.gap-card');
    await expect(gapCard).toHaveCount(1);
    await expect(gapCard).toContainText('gapuser');

    // Open the assignment dialog and verknüpfen the existing no-account Beringer.
    await gapCard.getByRole('button', {name: 'Beringer zuordnen'}).click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.locator('mat-select').click();
    await page.getByRole('option', {name: /Frei Beringer/}).click();
    await dialog.getByRole('button', {name: 'Zuordnen', exact: true}).click();

    // The seat drops out of the gap panel and shows as a Mitglied in the list.
    await expect(page.locator('.gap-card')).toHaveCount(0);
    await expect(page.locator('.beringer-card__badge--member')).toContainText('Mitglied');
  });
});
