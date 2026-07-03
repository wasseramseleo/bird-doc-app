import { expect, Page, test } from '@playwright/test';
import { selectProject } from './select-project';

/**
 * E2E for the Caps-Lock warning on the capture form (#43).
 *
 * What this CAN verify in a real browser: the indicator tracks the CapsLock
 * key's own keydown (Playwright dispatches a real `key: 'CapsLock'` event), so
 * the warning sets on the first press and clears on the next — across
 * on→off→on, with no stuck/false state.
 *
 * What this CANNOT verify (stated explicitly per the issue): the true OS-level
 * Caps-Lock state. Playwright cannot toggle the physical key, and getModifierState
 * reflects the real OS state, not Playwright's synthetic key. That on/off-and-clear
 * behavior is verified manually in a real browser instead — see the PR notes.
 */

const STATION = {
  handle: 'STAMT',
  name: 'Linz, Botanischer Garten',
  organization: { id: 'o1', handle: 'IWM', name: 'IWM Linz', country: 'AT' },
};

const PROJECT = {
  id: 'p1',
  title: 'Schilfgürtel Linz',
  description: '',
  show_optional_fields: false,
  organization: STATION.organization,
  default_station: STATION,
  scientists: [],
  created: '2026-06-01T00:00:00Z',
  updated: '2026-06-01T00:00:00Z',
};

function page0<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({ json: { username: 'fre', handle: 'FRE', is_staff: false } }),
  );
  await page.route('**/api/birds/projects/', (route) => route.fulfill({ json: page0([PROJECT]) }));
  await page.route('**/api/birds/organizations/', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/scientists/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/species/**', (route) => route.fulfill({ json: page0([]) }));
  await page.route('**/api/birds/data-entries/**', (route) => route.fulfill({ json: page0([]) }));
}

test.describe('Caps-Lock warning (#43)', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
    await selectProject(page, PROJECT.title);
    await page.goto('/data-entry');
    await expect(page.locator('input[formControlName="ringing_station"]')).toHaveValue(
      STATION.name,
    );
  });

  test('sets and clears the warning across on→off→on as CapsLock is pressed', async ({ page }) => {
    const hint = page.locator('[data-testid="capslock-hint"]');

    // Focus the form first so key events land on the host.
    await page.locator('input[formControlName="staff"]').click();
    await expect(hint).toHaveCount(0);

    await page.keyboard.press('CapsLock');
    await expect(hint).toBeVisible(); // on
    await page.screenshot({ path: 'test-results/capslock-on.png' });

    await page.keyboard.press('CapsLock');
    await expect(hint).toHaveCount(0); // off (clears — not stuck)

    await page.keyboard.press('CapsLock');
    await expect(hint).toBeVisible(); // on again
  });
});
