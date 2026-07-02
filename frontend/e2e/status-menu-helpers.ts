import { expect, Page } from '@playwright/test';

/**
 * Helpers for the offline-status chips that moved off the always-visible
 * toolbar into the user dropdown (the `.user-trigger` button on the right).
 *
 * The outbox chip (`.outbox-indicator`), the offline-readiness chip
 * (`.offline-readiness`) and its persistence badges now live inside a
 * `<div class="user-menu__status">` in a CDK overlay panel that is only in the
 * DOM while the dropdown is open. Specs open the dropdown, assert on a chip,
 * and close it again via these helpers.
 *
 * NOTE: these are distinct from the toolbar's transient `.offline-indicator`
 * banner ("Offline – Einträge werden lokal gespeichert"), which stayed on the
 * toolbar and is asserted directly, without opening the dropdown.
 */

/** Open the user dropdown so the collapsed offline-status chips are in the DOM. */
export async function openUserMenu(page: Page): Promise<void> {
  await page.locator('.user-trigger').click();
  await expect(page.locator('.user-menu__status')).toBeVisible();
}

/** Close the dropdown and wait for the overlay content to detach. */
export async function closeUserMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.user-menu__status')).toHaveCount(0);
}

/** Assert the collapsed outbox chip shows `text` (opens the dropdown, asserts, closes it). */
export async function expectOutboxIndicator(page: Page, text: string | RegExp): Promise<void> {
  await openUserMenu(page);
  await expect(page.locator('.outbox-indicator')).toContainText(text);
  await closeUserMenu(page);
}

/** Assert the collapsed offline-readiness chip shows `text` (opens the dropdown, asserts, closes it). */
export async function expectOfflineReadiness(page: Page, text: string | RegExp): Promise<void> {
  await openUserMenu(page);
  await expect(page.locator('.offline-readiness')).toContainText(text);
  await closeUserMenu(page);
}

/**
 * Assert the offline-readiness persistence badge for `state` is visible inside
 * the dropdown (opens the dropdown, asserts, closes it).
 */
export async function expectPersistenceBadge(
  page: Page,
  state: 'granted' | 'denied',
): Promise<void> {
  await openUserMenu(page);
  await expect(page.locator(`.offline-readiness__persistence--${state}`)).toBeVisible();
  await closeUserMenu(page);
}
