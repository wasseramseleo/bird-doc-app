import { expect, Page, test } from '@playwright/test';
import { expectPersistenceBadge } from './status-menu-helpers';

/**
 * E2E for the persistent-storage request (issue #166, PRD #152, acceptance
 * criterion 3): a real browser assertion that the app actually calls the
 * Storage Manager API to ask the browser not to evict its offline outbox
 * under storage pressure. `navigator.storage.persist()` is stubbed via
 * `addInitScript` (deterministic, no dependency on the real browser's
 * site-engagement heuristics) and its call is observed once the nav bar --
 * home of the Offline-Bereitschaft indicator that surfaces the resulting
 * granted/denied state -- has rendered for a signed-in Mitglied.
 */

async function stubPersistApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __persistCalls: number }).__persistCalls = 0;
    if (!navigator.storage) return;
    navigator.storage.persist = () => {
      (window as unknown as { __persistCalls: number }).__persistCalls++;
      return Promise.resolve(true);
    };
  });
}

async function stubAuth(page: Page): Promise<void> {
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({
      json: {
        username: 'fre',
        handle: 'FRE',
        is_staff: false,
        active_organization_rolle: 'mitglied',
        active_organization: null,
      },
    }),
  );
  await page.route('**/api/birds/projects/', (route) =>
    route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }),
  );
}

test.describe('Persistent storage request (issue #166)', () => {
  test('requests persistent storage from the browser once signed in', async ({ page }) => {
    await stubPersistApi(page);
    await stubAuth(page);

    await page.goto('/');
    await expect(page.locator('app-nav-bar')).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls))
      .toBeGreaterThan(0);
  });

  test('reflects the granted persistence state in the readiness indicator', async ({ page }) => {
    await stubPersistApi(page);
    await stubAuth(page);

    await page.goto('/');
    await expect(page.locator('app-nav-bar')).toBeVisible();

    await expectPersistenceBadge(page, 'granted');
  });

  test('reflects a denied persistence state in the readiness indicator', async ({ page }) => {
    await page.addInitScript(() => {
      if (!navigator.storage) return;
      navigator.storage.persist = () => Promise.resolve(false);
    });
    await stubAuth(page);

    await page.goto('/');
    await expect(page.locator('app-nav-bar')).toBeVisible();

    await expectPersistenceBadge(page, 'denied');
  });
});

test.describe('Guided PWA install affordance (issue #166)', () => {
  test('is absent until the browser offers a guided install', async ({ page }) => {
    await stubAuth(page);

    await page.goto('/');
    await expect(page.locator('app-nav-bar')).toBeVisible();

    await expect(page.locator('.pwa-install')).toHaveCount(0);
  });

  test('appears and replays the guided install prompt once the browser offers it', async ({
    page,
  }) => {
    await stubAuth(page);

    await page.goto('/');
    await expect(page.locator('app-nav-bar')).toBeVisible();

    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: () => {
          (window as unknown as { __installPrompted: boolean }).__installPrompted = true;
          return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });
      window.dispatchEvent(event);
    });

    const installButton = page.locator('.pwa-install');
    await expect(installButton).toBeVisible();

    await installButton.click();

    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __installPrompted?: boolean }).__installPrompted),
      )
      .toBe(true);
    await expect(installButton).toHaveCount(0);
  });
});
