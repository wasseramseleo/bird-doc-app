import { expect, Page, test } from '@playwright/test';
import { expectOutboxIndicator } from './status-menu-helpers';

/**
 * E2E for the offline durable outbox tracer bullet (issue #160, PRD #152):
 * standing at a Station with no connectivity, recording an Erstfang with the
 * full capture form enqueues a durable IndexedDB outbox entry instead of
 * POSTing, shows an always-visible pending count, and both survive a full
 * reload while still offline.
 *
 * Follows the offline-simulation pattern established by
 * `offline-cold-boot.spec.ts` (issue #156) and `offline-data-access.spec.ts`
 * (issue #159): stub `**​/api/**` while "online" (also caching the offline
 * reference bundle, so the Ringnummer suggestion works offline too), then
 * re-route every `/api/**` call to a genuine network-level failure
 * (`route.abort(...)`, `HttpErrorResponse.status === 0`) for the "offline"
 * phase.
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
// any create POST, which must never reach the server while offline.
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

test.describe('Offline durable outbox (issue #160)', () => {
  test('records an Erstfang offline into the durable outbox, shows the pending count, and both survive a reload', async ({
    page,
  }) => {
    // Prepare online: sign in, pick the Projekt (mounts the nav bar, whose
    // Offline-Bereitschaft indicator fetches and caches the reference
    // bundle automatically), then open the capture form.
    await stubApiOnline(page);
    await page.goto('/');
    await page.locator('.project-card__main', { hasText: PROJECT.title }).click();
    await expect(page).toHaveURL(/\/data-entries$/);
    await page.goto('/data-entry');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );

    // The always-visible pending count starts at zero while online.
    await expectOutboxIndicator(page, '0 nicht synchronisierte Einträge');

    await goOffline(page);
    await fillErstfang(page);
    // The offline Ringnummer suggestion (issue #159): cached last-consumed
    // "0042" + 1, selecting Kohlmeise pre-fills Ringgröße "V". By now the
    // autocomplete searches and this suggestion lookup have all failed
    // against the aborted routes, so connectivity is confirmed lost.
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('0043');

    // The persistent "Offline" indication (CONTEXT.md's **Offline** entry).
    await expect(page.locator('.offline-indicator')).toContainText(
      'Offline – Einträge werden lokal gespeichert',
    );

    // The create attempt itself is aborted at the network level (genuinely
    // offline — every /api/** route is aborted above), never reaching the
    // server; the durable outbox is what stands in for it below.
    const failedPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/birds/data-entries/'),
    );

    await page.keyboard.press('Control+s');
    await failedPost;

    // The keyboard workflow, focus order and clean-reset are identical to
    // online: species is cleared and focused, Station + Beringer preserved.
    await expect(page.locator('input[formControlName="species"]')).toBeFocused();
    await expect(page.locator('input[formControlName="ring_number"]')).toHaveValue('');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );
    await expect(page.locator('input[formControlName="staff"]')).toHaveValue(
      'Filip Reiter (FRE)',
    );
    await expect(page.locator('mat-error')).toHaveCount(0);

    // The pending count now shows the queued capture — the durable outbox
    // entry, not a server record, is what the failed POST above resulted in.
    await expectOutboxIndicator(page, '1 nicht synchronisierte Einträge');

    // Queued entries survive a full reload while still offline.
    await page.reload();

    await expect(page).toHaveURL(/\/data-entry$/);
    await expectOutboxIndicator(page, '1 nicht synchronisierte Einträge');
  });
});
