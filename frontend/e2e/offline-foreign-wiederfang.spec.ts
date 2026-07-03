import { expect, Page, test } from '@playwright/test';
import { selectProject } from './select-project';
import { expectOutboxIndicator } from './status-menu-helpers';

/**
 * E2E for the offline ausländischer Wiederfang (issue #233, PRD #226): a
 * Beringer standing at a Station with no connectivity records a foreign
 * Wiederfang — picking the ring's Zentrale from the searchable dropdown served
 * entirely from the CACHED offline bundle (no network) — it queues into the
 * durable outbox carrying the Zentrale flat (the EURING scheme code string),
 * and once connectivity returns the queue replays to the server verbatim.
 *
 * Follows the offline-simulation pattern of `offline-outbox.spec.ts` (#160) and
 * `offline-sync.spec.ts` (#161): stub `**​/api/**` while "online" (also caching
 * the offline reference bundle — now carrying the full Zentralen register),
 * re-route every `/api/**` call to a genuine network failure (`route.abort`,
 * `HttpErrorResponse.status === 0`) for the "offline" phase, then re-establish
 * working routes and dispatch a synthetic `online` event to reconnect.
 */

const ORGANIZATION = { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' };

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: ORGANIZATION,
};

const BERINGER = { id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter' };

// The Projekt-Zentrale — the Austrian home scheme a domestic capture defaults to.
const AUW = {
  id: 'c-auw',
  scheme_code: 'AUW',
  name: 'Österreichische Vogelwarte',
  country: 'Österreich',
};

// A foreign Zentrale, the ausländischer Wiederfang's ring scheme.
const SLOVAK = {
  id: 'c-skb',
  scheme_code: 'SKB',
  name: 'Bratislava',
  country: 'Slowakei',
};

const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: false,
  organization: ORGANIZATION,
  central: AUW,
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

// The offline bundle now carries the full Zentralen register and each Projekt's
// Zentrale (#233), so the offline Zentrale dropdown can search it with no network.
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
  centrals: [AUW, SLOVAK],
  last_consumed_ring_numbers: [{ project_id: 'p1', size: 'V', number: '0042' }],
};

// A populated stats payload so the home dashboard (ADR 0018) renders once a
// Projekt is active — the picker lands there on selection.
const STATS = {
  range: { from: '2026-06-26', to: '2026-07-03', preset: 'week' },
  totals: { faenge: 0, artenzahl: 0 },
  top_species: [],
  last_fangtag: null,
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
  // The home dashboard (ADR 0018) the picker lands on fetches the Projekt stats.
  await page.route('**/api/birds/projects/*/stats/**', (route) =>
    route.fulfill({ json: STATS }),
  );
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
  // The online Zentrale dropdown lookup (#232); offline this route is aborted and
  // the cached register stands in.
  await page.route('**/api/birds/centrals/**', (route) =>
    route.fulfill({ json: page0([AUW, SLOVAK]) }),
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
  await page.unroute('**/api/birds/projects/*/stats/**');
  await page.unroute('**/api/birds/organizations/');
  await page.unroute('**/api/birds/scientists/**');
  await page.unroute('**/api/birds/species/**');
  await page.unroute('**/api/birds/ringing-stations/**');
  await page.unroute('**/api/birds/centrals/**');
  await page.unroute('**/api/birds/rings/next-number/**');
  await page.unroute('**/api/birds/data-entries/**');
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
}

async function goOnline(page: Page): Promise<void> {
  await page.unroute('**/api/**');
  await stubApiOnline(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test.describe('Offline ausländischer Wiederfang (issue #233)', () => {
  test('records a foreign Wiederfang offline via the cached Zentrale dropdown, queues the central flat, and replays it on reconnect', async ({
    page,
  }) => {
    // Prepare online: sign in, pick the Projekt (mounts the nav bar, whose
    // Offline-Bereitschaft indicator fetches and caches the reference bundle —
    // now including the Zentralen register), then open the capture form.
    await stubApiOnline(page);
    // Pick the Projekt via the picker: mounting the navbar there caches the
    // reference bundle (now including the Zentralen register) automatically.
    await selectProject(page, PROJECT.title);
    await page.goto('/data-entry');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );
    await expectOutboxIndicator(page, 'Alle Einträge synchronisiert');

    // Lose connectivity entirely.
    await goOffline(page);

    // Beringer.
    const staff = page.locator('input[formControlName="staff"]');
    await staff.click();
    await staff.fill('Filip');
    await page.locator('mat-option', { hasText: 'Filip Reiter (FRE)' }).click();

    // Status: a Wiederfang — this is what enables the Zentrale field.
    await page.locator('mat-select[formControlName="bird_status"]').click();
    await page.locator('mat-option', { hasText: 'Wiederfang' }).click();

    // The Zentrale dropdown, served entirely from the CACHED bundle with no
    // network: searching the scheme code "SKB" surfaces the Slovak scheme, whose
    // full name + country only the cached register carries.
    const central = page.locator('[data-testid="central-input"]');
    await central.click();
    await central.fill('SKB');
    const foreignOption = page.locator('mat-option', { hasText: 'Bratislava (SKB) – Slowakei' });
    await expect(foreignOption).toBeVisible();
    await foreignOption.click();

    // Picking a foreign Zentrale switches Ringgröße to free text.
    const ringSize = page.locator('[data-testid="ring-size-freetext"]');
    await expect(ringSize).toBeVisible();

    // Species (its Empfohlene-Ringgröße prefill is suppressed while foreign).
    const species = page.locator('input[formControlName="species"]');
    await species.click();
    await species.fill('Kohl');
    await page.locator('mat-option', { hasText: 'Kohlmeise' }).click();

    // A foreign ring: a free-text Größe and an alphanumeric Ringnummer.
    await ringSize.fill('6.0');
    const ringNumber = page.locator('input[formControlName="ring_number"]');
    await ringNumber.fill('SK1A');

    // The persistent Offline indication.
    await expect(page.locator('.offline-indicator')).toContainText(
      'Offline – Einträge werden lokal gespeichert',
    );

    // Saving offline: the POST is aborted at the network level (never reaches the
    // server); the durable outbox stands in for it.
    const failedPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await page.keyboard.press('Control+s');
    await failedPost;

    await expect(page.locator('mat-error')).toHaveCount(0);
    await expectOutboxIndicator(page, '1 nicht synchronisierter Eintrag');

    // Reconnect: the app auto-syncs with no manual action (#161). The replayed
    // POST carries the Zentrale flat as the EURING scheme code string — no ID
    // mapping — alongside the foreign Größe/Nummer, the Wiederfang status and the
    // idempotency key.
    const syncedPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );
    await goOnline(page);
    const body = (await syncedPost).postDataJSON();
    expect(body.central).toBe('SKB');
    expect(body.ring_size).toBe('6.0');
    expect(body.ring_number).toBe('SK1A');
    expect(body.bird_status).toBe('w');
    expect(body.species_id).toBe(KOHLMEISE.id);
    expect(body.idempotency_key).toBeTruthy();

    // The queue empties.
    await expectOutboxIndicator(page, 'Alle Einträge synchronisiert');
  });
});
