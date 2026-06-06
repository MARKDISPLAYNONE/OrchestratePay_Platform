import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for OrchestratePay web app.
 *
 * Test targets:
 *   - Merchant auth flow (login, register, lockout)
 *   - Merchant dashboard (analytics, transactions, settings)
 *   - Consumer portal (OTP login, P2P send, QR scan)
 *   - Admin panel (approvals, rejections)
 *
 * Run:
 *   npx playwright test           — all tests, headless
 *   npx playwright test --ui      — interactive UI mode
 *   npx playwright test auth/     — auth suite only
 *   BASE_URL=https://staging.orchestratepay.co.ke npx playwright test
 */
export default defineConfig({
  testDir:     './e2e',
  outputDir:   './e2e/results',
  fullyParallel: true,
  forbidOnly:  !!process.env.CI,
  retries:     process.env.CI ? 2 : 0,
  workers:     process.env.CI ? 2 : undefined,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL:           process.env.BASE_URL ?? 'http://localhost:3000',
    trace:             'on-first-retry',
    screenshot:        'only-on-failure',
    video:             'retain-on-failure',
    actionTimeout:     10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      use:  { ...devices['iPhone 14'] },
    },
  ],

  // Start the Next.js dev server automatically when running locally.
  // In CI the server is started as a separate job step.
  webServer: process.env.CI
    ? undefined
    : {
        command:             'npm run dev',
        url:                 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout:             120_000,
      },
})
