import { test as base, expect, Page } from '@playwright/test'

/**
 * Shared auth fixtures for E2E tests.
 * Provides pre-authenticated page contexts so individual tests don't
 * have to repeat the login flow.
 */
export interface AuthFixtures {
  merchantPage: Page
  consumerPage: Page
}

export const test = base.extend<AuthFixtures>({
  merchantPage: async ({ browser }, use) => {
    const context = await browser.newContext()
    const page    = await context.newPage()

    // Inject a signed-looking JWT into localStorage so the Next.js auth guard passes.
    // In CI the token is issued by the test backend; locally we use a mock.
    await page.goto('/auth/login')
    await page.evaluate(() => {
      // Fake access token — enough for client-side route guards in dev.
      // The real API calls will still require a valid token.
      localStorage.setItem('token', process.env.TEST_MERCHANT_TOKEN ?? 'test-merchant-token-dev')
    })
    await use(page)
    await context.close()
  },

  consumerPage: async ({ browser }, use) => {
    const context = await browser.newContext()
    const page    = await context.newPage()
    await page.goto('/auth/login')
    await page.evaluate(() => {
      localStorage.setItem('consumer_token', process.env.TEST_CONSUMER_TOKEN ?? 'test-consumer-token-dev')
    })
    await use(page)
    await context.close()
  },
})

export { expect }

/** Navigate to a page and wait for hydration to settle. */
export async function gotoAndWait(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}
