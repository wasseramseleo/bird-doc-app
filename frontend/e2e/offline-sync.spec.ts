import { expect, Page, test } from '@playwright/test';
import { selectProject } from './select-project';
import { expectOutboxIndicator } from './status-menu-helpers';

/**
 * E2E for the offline outbox sync replay (issue #161, PRD #152): the outbox
 * durably queues offline captures (issue #160); this proves the other half —
 * once connectivity returns, the queue drains to the server automatically,
 * with no manual action, and the pending count reflects it.
 *
 * Follows the offline-simulation pattern established by
 * `offline-outbox.spec.ts` (issue #160): stub `**​/api/**` while "online",
 * re-route every `/api/**` call to a genuine network-level failure
 * (`route.abort(...)`) for the "offline" phase, then re-establish working
 * routes and dispatch a synthetic `window` "online" event for "reconnect" —
 * the same technique `offline-persistent-storage.spec.ts` already uses for a
 * different browser event, and the same trigger `OutboxIndicator`'s own unit
 * spec exercises directly (`window.dispatchEvent(new Event('online'))`).
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

async function routeAuthMe(page: Page): Promise<void> {
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
}

async function stubApiOnline(page: Page): Promise<void> {
  await routeAuthMe(page);
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
  await page.route('**/api/birds/data-entries/**', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({ status: 201, json: { id: 'server-1' } });
      return;
    }
    route.fulfill({ json: page0([]) });
  });
}

// Re-routes every API call to a hard network failure (status 0 on the
// client), simulating the device losing connectivity entirely — including
// the create POST, which must never reach the server while offline.
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

// Reconnects: drops the catch-all abort and re-establishes working routes —
// then a synthetic "online" event is what the app itself reacts to (issue
// #161's auto-sync trigger), exactly like a real connectivity change would.
async function goOnline(page: Page): Promise<void> {
  await page.unroute('**/api/**');
  await stubApiOnline(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
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

test.describe('Offline outbox sync (issue #161)', () => {
  test('offline capture → reconnect → auto-sync → capture reaches the server, queue empties', async ({
    page,
  }) => {
    // Prepare online: sign in, pick the Projekt, open the capture form.
    await stubApiOnline(page);
    await selectProject(page, PROJECT.title);
    await page.goto('/data-entry');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );
    await expectOutboxIndicator(page, 'Alle Einträge synchronisiert');

    // Go offline and record an Erstfang — it lands in the durable outbox
    // (issue #160), never reaching the server.
    await goOffline(page);
    await fillErstfang(page);
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('0043');

    const failedPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.keyboard.press('Control+s');
    await failedPost;

    await expectOutboxIndicator(page, '1 nicht synchronisierter Eintrag');

    // Reconnect: the app auto-syncs with no manual action (issue #161).
    const syncedPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await goOnline(page);
    const request = await syncedPost;
    const body = request.postDataJSON();
    expect(body.species_id).toBe(KOHLMEISE.id);
    expect(body.ring_number).toBe('0043');
    expect(body.idempotency_key).toBeTruthy();

    // The queue empties and the pending count reflects it.
    await expectOutboxIndicator(page, 'Alle Einträge synchronisiert');
  });
});
