import { expect, Page, Request, test } from '@playwright/test';
import { expectOutboxIndicator } from './status-menu-helpers';

/**
 * E2E for the offline quick-add Beringer + Kürzel-matched sync (issue #167,
 * PRD #152): the "helper who shows up unannounced at a remote Station" (ADR
 * 0001) is quick-added offline (name + Kürzel), selected into the same
 * session's capture, and — once connectivity returns — the sync creates the
 * Beringer FIRST, then replays the dependent capture resolved to the real
 * server id it comes back with.
 *
 * Follows the offline-simulation pattern of `offline-sync.spec.ts`: stub
 * `**​/api/**` while "online", `route.abort(...)` every `/api/**` call while
 * "offline", then re-establish working routes and dispatch a synthetic
 * `window` "online" event to trigger the auto-sync.
 */

const ORGANIZATION = { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' };

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: ORGANIZATION,
};

// The Projekt's existing Beringer. The one we quick-add offline (ANM) is
// deliberately NOT in the offline bundle, so an unknown Kürzel prompts the
// "Neuer Beringer" flow.
const BERINGER = { id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter' };

// The id the server hands back for the quick-added Beringer on sync — this is
// what the dependent capture's staff_id must resolve to.
const CREATED_BERINGER = { id: 'server-anm', handle: 'ANM', full_name: 'Anna Muster' };

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
  await page.route('**/api/birds/scientists/**', (route) => {
    if (route.request().method() === 'POST') {
      // Idempotent create: whether newly created or Kürzel-matched to a Beringer
      // already created server-side, the server hands back the real id.
      route.fulfill({ status: 201, json: CREATED_BERINGER });
      return;
    }
    route.fulfill({ json: page0([BERINGER]) });
  });
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

async function goOnline(page: Page): Promise<void> {
  await page.unroute('**/api/**');
  await stubApiOnline(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test.describe('Offline quick-add Beringer + Kürzel-matched sync (issue #167)', () => {
  test('offline quick-add + capture → reconnect → sync creates the Beringer, then the capture resolved to its real id', async ({
    page,
  }) => {
    // Online: sign in, pick the Projekt, open the capture form.
    await stubApiOnline(page);
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);
    await page.goto('/data-entry');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );

    // Go offline, then quick-add a no-account Beringer from an unknown Kürzel.
    await goOffline(page);
    const staff = page.locator('input[formControlName="staff"]');
    await staff.click();
    await staff.fill('ANM');
    await page.locator('mat-option', { hasText: 'Neuer Beringer' }).click();

    // The "Neuer Beringer" dialog: the typed Kürzel is pre-filled; add the name.
    await page.locator('input[formControlName="first_name"]').fill('Anna');
    await page.locator('input[formControlName="last_name"]').fill('Muster');
    await page.getByRole('button', { name: 'Anlegen' }).click();

    // The quick-added Beringer is selected into the field in the same session.
    await expect(staff).toHaveValue('Anna Muster (ANM)');

    // Record an Erstfang against the quick-added Beringer — it lands in the
    // durable outbox, referencing the Beringer's local placeholder id.
    const species = page.locator('input[formControlName="species"]');
    await species.click();
    await species.fill('Kohl');
    await page.locator('mat-option', { hasText: 'Kohlmeise' }).click();
    await page.locator('mat-select[formControlName="bird_status"]').click();
    await page.locator('mat-option', { hasText: 'Erstfang' }).click();
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('0043');

    const failedCapture = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.keyboard.press('Control+s');
    await failedCapture;

    await expectOutboxIndicator(page, '1 nicht synchronisierte Einträge');

    // Reconnect: the app auto-syncs. Record the order of the two POSTs and the
    // capture's staff_id so we can assert Beringer-before-capture + resolution.
    const posts: { kind: string; staffId?: string }[] = [];
    page.on('request', (request: Request) => {
      if (request.method() !== 'POST') {
        return;
      }
      if (request.url().includes('/api/birds/scientists/')) {
        posts.push({ kind: 'beringer' });
      } else if (request.url().includes('/api/birds/data-entries/')) {
        posts.push({ kind: 'capture', staffId: request.postDataJSON()?.staff_id });
      }
    });

    const syncedCapture = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await goOnline(page);
    await syncedCapture;

    // The queue empties once both are synced.
    await expectOutboxIndicator(page, '0 nicht synchronisierte Einträge');

    const beringerIndex = posts.findIndex((p) => p.kind === 'beringer');
    const captureIndex = posts.findIndex((p) => p.kind === 'capture');
    expect(beringerIndex).toBeGreaterThanOrEqual(0);
    expect(captureIndex).toBeGreaterThanOrEqual(0);
    // The Beringer is created BEFORE its dependent capture...
    expect(beringerIndex).toBeLessThan(captureIndex);
    // ...and the capture resolves to the real (Kürzel-matched) server id.
    expect(posts[captureIndex].staffId).toBe(CREATED_BERINGER.id);
  });
});
