import {defineConfig, devices} from '@playwright/test';

/**
 * E2E tests run against `ng serve` (dev configuration → API at
 * http://localhost:8000/api), but every test stubs the `**​/api/**` routes,
 * so no Django backend needs to be running.
 *
 * Uses the system Google Chrome (`channel: 'chrome'`) so no Playwright browser
 * download is required — matching the Karma setup that relies on
 * /usr/bin/google-chrome.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chrome',
      use: {...devices['Desktop Chrome'], channel: 'chrome'},
    },
  ],
  webServer: {
    command: './node_modules/.bin/ng serve',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
