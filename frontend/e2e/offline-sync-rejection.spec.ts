import { expect, Page, test } from '@playwright/test';

/**
 * E2E for skip-and-flag on sync rejection + in-form fix-up (issue #164, PRD
 * #152): during sync, one queued capture the server rejects (here a genuine
 * ring-uniqueness collision from a concurrent device — ADR 0006) is skipped
 * and flagged with the server's own message, while the rest of the queue
 * syncs on. The flagged entry opens in the normal capture form (showing the
 * rejection), is fixed, and re-queues — and the next sync drains it.
 *
 * Follows the offline-simulation pattern of `offline-sync.spec.ts`: stub
 * `**​/api/**` while "online", `route.abort(...)` every `/api/**` call for the
 * "offline" phase, then re-establish working routes and dispatch a synthetic
 * `window` "online" event to reconnect and auto-sync. Backend-free: the create
 * POST is fulfilled by the route stub, which rejects exactly the colliding ring
 * number with a DRF 400 field-error body.
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

// The one ring number that collides with a concurrent device's already-synced
// Erstfang, and the exact German message the server returns for it (mirroring
// `capture_service.RING_ALREADY_FIRST_CAUGHT`).
const REJECTED_RING = '0043';
const FIXED_RING = '0099';
const COLLISION_MESSAGE =
  'Für diese Ringnummer besteht in dieser Organisation bereits ein Erstfang.';

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
    route.fulfill({ json: { next_number: REJECTED_RING } }),
  );
  await page.route('**/api/birds/data-entries/**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { ring_number?: string };
      // Exactly the colliding ring is refused — a genuine ring-uniqueness
      // collision (a concurrent device already first-caught it). Everything
      // else (the second capture, and later the corrected one) is accepted.
      if (body.ring_number === REJECTED_RING) {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ ring_number: [COLLISION_MESSAGE] }),
        });
        return;
      }
      route.fulfill({ status: 201, json: { id: `server-${body.ring_number}` } });
      return;
    }
    route.fulfill({ json: page0([]) });
  });
}

// Re-routes every API call to a hard network failure (status 0 on the client),
// simulating the device losing connectivity entirely — including the create
// POST, which must never reach the server while offline.
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

// Reconnects: drops the catch-all abort, re-establishes working routes, then
// dispatches a synthetic "online" event — the app's own auto-sync trigger.
async function goOnline(page: Page): Promise<void> {
  await page.unroute('**/api/**');
  await stubApiOnline(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

async function recordErstfang(page: Page, ringNumber: string): Promise<void> {
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

  // Let the auto-suggestion land first, then pin the number deterministically —
  // the effect only re-fires on ring-size/status change, so this stays put.
  const ring = page.locator('input[formControlName="ring_number"]');
  await expect(ring).not.toHaveValue('');
  await ring.fill(ringNumber);
  await expect(ring).toHaveValue(ringNumber);
}

test.describe('Offline sync rejection — skip-and-flag + in-form fix-up (issue #164)', () => {
  test('one queued entry is rejected and flagged, the rest sync; fixing it re-queues and the next sync drains it', async ({
    page,
  }) => {
    // Prepare online: sign in and pick the Projekt.
    await stubApiOnline(page);
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);

    // Go offline and record two Erstfänge into the durable outbox: 0043 (which
    // a concurrent device already first-caught) and 0044 (clean).
    await goOffline(page);
    await page.goto('/data-entry');

    await recordErstfang(page, REJECTED_RING);
    const firstPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.keyboard.press('Control+s');
    await firstPost;
    await expect(page.locator('.outbox-indicator')).toContainText(
      '1 nicht synchronisierte Einträge',
    );

    await recordErstfang(page, '0044');
    const secondPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.keyboard.press('Control+s');
    await secondPost;
    await expect(page.locator('.outbox-indicator')).toContainText(
      '2 nicht synchronisierte Einträge',
    );

    // Reconnect: auto-sync. 0044 reaches the server; 0043 is rejected and left
    // flagged — one bad entry never holds the queue hostage. Exactly one stays.
    await goOnline(page);
    await expect(page.locator('.outbox-indicator')).toContainText(
      '1 nicht synchronisierte Einträge',
    );

    // "Today's session" shows the survivor flagged with the server's message.
    await page.locator('a.heutige-session').click();
    await expect(page).toHaveURL(/\/heute$/);
    const flaggedRow = page.locator('.session-row--queued.session-row--error');
    await expect(flaggedRow).toBeVisible();
    await expect(flaggedRow).toContainText('Sync-Fehler');
    await expect(page.locator('[data-testid="queued-sync-error"]')).toContainText(
      COLLISION_MESSAGE,
    );
    await expect(page.locator('.session-row--queued')).toHaveCount(1);

    // Opening the flagged entry surfaces the rejection in the normal form...
    await flaggedRow.click();
    await expect(page).toHaveURL(/\/data-entry\/[0-9a-f-]+$/);
    await expect(page.locator('[data-testid="sync-error-banner"]')).toContainText(COLLISION_MESSAGE);
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue(REJECTED_RING);

    // ...and fixing the ring number re-queues it clean (no PUT — it was never on
    // the server) and returns to the session view, still one entry, now unflagged.
    const ring = page.locator('input[formControlName="ring_number"]');
    await ring.fill(FIXED_RING);
    await page.keyboard.press('Control+s');
    await expect(page).toHaveURL(/\/heute$/);
    await expect(page.locator('.session-row--queued')).toHaveCount(1);
    await expect(page.locator('.session-row--error')).toHaveCount(0);
    await expect(page.locator('.outbox-indicator')).toContainText(
      '1 nicht synchronisierte Einträge',
    );

    // The next sync drains the corrected entry — the queue finally empties.
    const fixedPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const request = await fixedPost;
    expect((request.postDataJSON() as { ring_number: string }).ring_number).toBe(FIXED_RING);
    await expect(page.locator('.outbox-indicator')).toContainText(
      '0 nicht synchronisierte Einträge',
    );
    await expect(page.locator('.session-row--queued')).toHaveCount(0);
  });
});
