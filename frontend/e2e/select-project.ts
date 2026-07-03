import { expect, Page } from '@playwright/test';

/**
 * Select a Projekt through the dedicated picker route.
 *
 * Since #221 (`/projekte` picker) the project-selection flow is:
 *   - `/` with no current Projekt redirects to `/projekte` (the picker,
 *     `ProjectPickerComponent`), which mounts the nav bar — so its
 *     Offline-Bereitschaft indicator fetches and caches the reference bundle.
 *   - Clicking a project card selects the Projekt and lands on its dashboard
 *     at `/` (Home), NOT `/data-entries` (ADR 0018).
 *
 * The caller must have its `**​/api/**` route stubs in place before calling this
 * (the picker and nav bar issue reference requests on mount). Callers that need
 * the capture form navigate to `/data-entry` afterwards; the persisted Projekt
 * keeps that route from redirecting back home.
 */
export async function selectProject(page: Page, projectTitle: string): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/projekte$/);
  await page.locator('.project-card__main', { hasText: projectTitle }).click();
  await expect(page).toHaveURL(/\/$/);
}
