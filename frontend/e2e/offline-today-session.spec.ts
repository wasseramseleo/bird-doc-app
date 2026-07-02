import { expect, Page, test } from '@playwright/test';
import { expectOutboxIndicator, openUserMenu } from './status-menu-helpers';

/**
 * E2E for "today's session" (issue #163, PRD #152): offline, a queued
 * (nicht synchronisiert) capture is visible in the session view, can be
 * opened in the normal capture form, edited and re-queued, and can be
 * deleted — all without ever reaching the server.
 *
 * Follows the offline-simulation pattern established by
 * `offline-outbox.spec.ts` (issue #160): stub `**​/api/**` while "online"
 * (also caching the offline reference bundle), then re-route every
 * `/api/**` call to a genuine network-level failure (`route.abort(...)`,
 * `HttpErrorResponse.status === 0`) for the "offline" phase.
 */

const ORGANIZATION = { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' };

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: ORGANIZATION,
};

const BERINGER = { id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter' };

const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: false,
  organization: ORGANIZATION,
  default_station: STATION,
  scientists: [BERINGER],
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
  usage_count: 5,
};

const OFFLINE_BUNDLE = {
  identity: {
    username: 'fre',
    handle: 'FRE',
    organization: ORGANIZATION,
    rolle: 'mitglied',
  },
  species: [KOHLMEISE],
  ringing_stations: [STATION],
  scientists: [BERINGER],
  projects: [PROJECT],
  last_consumed_ring_numbers: [{ project_id: 'p1', size: 'V', number: '0042' }],
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
  await page.route('**/api/birds/offline-bundle/', (route) =>
    route.fulfill({ json: OFFLINE_BUNDLE }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({ json: page0([PROJECT]) }));
  await page.route('**/api/birds/organizations/', (route) =>
    route.fulfill({ json: page0([ORGANIZATION]) }),
  );
  await page.route('**/api/birds/scientists/**', (route) =>
    route.fulfill({ json: page0([BERINGER]) }),
  );
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([KOHLMEISE]) }));
  await page.route('**/api/birds/ringing-stations/**', (route) =>
    route.fulfill({ json: page0([STATION]) }),
  );
  await page.route('**/api/birds/rings/next-number/**', (route) =>
    route.fulfill({ json: { next_number: '0043' } }),
  );
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
}

// Re-routes every API call to a hard network failure (status 0 on the
// client), simulating the device losing connectivity entirely — including
// any create/edit POST/PUT, which must never reach the server while offline.
async function goOffline(page: Page): Promise<void> {
  await page.unroute('**/api/auth/me/');
  await page.unroute('**/api/birds/offline-bundle/');
  await page.unroute('**/api/birds/projects/');
  await page.unroute('**/api/birds/organizations/');
  await page.unroute('**/api/birds/scientists/**');
  await page.unroute('**/api/birds/species/**');
  await page.unroute('**/api/birds/ringing-stations/**');
  await page.unroute('**/api/birds/rings/next-number/**');
  await page.unroute('**/api/birds/data-entries/**');
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
}

async function fillErstfang(page: Page): Promise<void> {
  const staff = page.locator('input[formControlName="staff"]');
  await staff.click();
  await staff.fill('Filip');
  await page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' }).click();

  const species = page.locator('input[formControlName="species"]');
  await species.click();
  await species.fill('Kohl');
  await page.locator('mat-option', { hasText: 'Kohlmeise' }).click();

  await page.locator('mat-select[formControlName="bird_status"]').click();
  await page.locator('mat-option', { hasText: 'Erstfang' }).click();
}

test.describe("Today's session — editing and deleting a queued entry offline (issue #163)", () => {
  test('lists a queued capture as nicht synchronisiert, edits it in the normal form (re-queued, not POSTed/PUT), then deletes it', async ({
    page,
  }) => {
    // Prepare online, then go offline and record an Erstfang — it lands in
    // the durable outbox instead of reaching the server (issue #160).
    await stubApiOnline(page);
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);

    await goOffline(page);
    await page.goto('/data-entry');
    await fillErstfang(page);
    await page.locator('input[formControlName="weight_gram"]').fill('15');

    const failedPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.keyboard.press('Control+s');
    await failedPost;
    await expectOutboxIndicator(page, '1 nicht synchronisierte Einträge');

    // "Today's session": the queued capture is visible offline, shown as
    // nicht synchronisiert.
    await openUserMenu(page);
    await page.locator('a.heutige-session-item').click();
    await expect(page).toHaveURL(/\/heute$/);
    const queuedRow = page.locator('.session-row--queued');
    await expect(queuedRow).toBeVisible();
    await expect(queuedRow).toContainText('Kohlmeise');
    await expect(queuedRow).toContainText('nicht synchronisiert');

    // Opening it resolves the local outbox id to the same capture form.
    await queuedRow.click();
    await expect(page).toHaveURL(/\/data-entry\/[0-9a-f-]+$/);
    await expect(page.locator('.queued-edit-badge')).toContainText('Nicht synchronisiert');
    await expect(page.locator('input[formControlName="species"]')).toHaveValue('Kohlmeise');
    await expect(page.locator('input[formControlName="weight_gram"]')).toHaveValue('15');

    // Fixing a typo on the last bird before it ever reaches the server: the
    // edit re-queues into the outbox (no PUT, no second POST) and returns to
    // "today's session".
    await page.locator('input[formControlName="weight_gram"]').fill('19');
    const putOrPostAttempt = page.waitForRequest(
      (r) =>
        (r.method() === 'PUT' || r.method() === 'POST') &&
        r.url().includes('/api/birds/data-entries/'),
      { timeout: 1000 },
    );
    await page.keyboard.press('Control+s');
    await expect(page).toHaveURL(/\/heute$/);
    await expect(putOrPostAttempt).rejects.toThrow();

    // Still exactly one nicht synchronisiert entry — the edit corrected it
    // in place rather than queueing a second capture.
    await expectOutboxIndicator(page, '1 nicht synchronisierte Einträge');
    await expect(page.locator('.session-row--queued')).toHaveCount(1);

    // Deleting the queued entry removes it for good.
    await page.locator('[data-testid="delete-queued"]').click();
    await page.locator('mat-dialog-actions button', { hasText: 'Löschen' }).click();
    await expect(page.locator('.session-row--queued')).toHaveCount(0);
    await expectOutboxIndicator(page, '0 nicht synchronisierte Einträge');
  });
});
