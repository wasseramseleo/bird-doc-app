import { expect, Page, test } from '@playwright/test';

/**
 * E2E for the offline walking skeleton (issue #156, PRD #152): a device that
 * prepared while online (identity cached in IndexedDB after a successful
 * `/auth/me/` check, active Projekt cached in LocalStorage as today) boots
 * with no connectivity and still lands the Mitglied on the capture form
 * rather than redirecting to `/login`.
 *
 * This establishes the offline-simulation pattern for later PRD #152 e2e
 * specs: stub `**​/api/**` for the "prepare online" phase, then re-route every
 * `/api/**` call to `route.abort(...)` for the "offline" phase — a genuine
 * network-level failure (`HttpErrorResponse.status === 0`), not a 401, which
 * is what `AuthService.bootstrap()` treats as "no connectivity" rather than
 * "logged out". The static shell keeps loading from the `ng serve` dev
 * server on reload — real zero-network app-shell delivery is the service
 * worker's job (`ngsw-config.json`), which only a production build
 * registers, outside what this dev-server-backed harness can exercise.
 */

const ORGANIZATION = { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' };

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: ORGANIZATION,
};

const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: false,
  organization: ORGANIZATION,
  default_station: STATION,
  scientists: [],
  created: '2026-06-01T00:00:00Z',
  updated: '2026-06-01T00:00:00Z',
};

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

async function stubApiOnline(page: Page): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({
      json: {
        username: 'fre',
        handle: 'FRE',
        is_staff: false,
        active_organization_rolle: 'mitglied',
        active_organization: ORGANIZATION,
      },
    }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({ json: page0([PROJECT]) }));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/scientists/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
}

// Re-routes every API call to a hard network failure (status 0 on the
// client), simulating the device losing connectivity entirely.
async function goOffline(page: Page): Promise<void> {
  await page.unroute('**/api/auth/me/');
  await page.unroute('**/api/birds/projects/');
  await page.unroute('**/api/birds/organizations/');
  await page.unroute('**/api/birds/scientists/**');
  await page.unroute('**/api/birds/species/**');
  await page.unroute('**/api/birds/data-entries/**');
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
}

test.describe('Offline cold boot (issue #156)', () => {
  test('lands on the capture form instead of login after an offline reload', async ({ page }) => {
    // Prepare online: sign in, pick the Projekt, visit the capture form once
    // so both the identity (IndexedDB) and the active Projekt (LocalStorage)
    // are cached.
    await stubApiOnline(page);
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);

    await page.goto('/data-entry');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );

    // Go offline and cold-boot at the guarded capture-form route.
    await goOffline(page);
    await page.reload();

    await expect(page).toHaveURL(/\/data-entry$/);
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );
  });

  test('does not fall back to a stale identity once logged out online', async ({ page }) => {
    await stubApiOnline(page);
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);

    // A confirmed "not authenticated" response (today's online logout/expiry
    // behaviour) clears the cached identity — offline never resurrects it.
    await page.unroute('**/api/auth/me/');
    await page.route('**/api/auth/me/', (route) =>
      route.fulfill({ status: 401, json: { detail: 'Not authenticated.' } }),
    );
    await page.goto('/data-entry');
    await expect(page).toHaveURL(/\/login/);

    await goOffline(page);
    await page.reload();

    await expect(page).toHaveURL(/\/login/);
  });
});
