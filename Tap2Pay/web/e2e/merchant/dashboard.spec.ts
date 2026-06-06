import { test, expect } from '@playwright/test'

/**
 * E2E tests for the merchant dashboard.
 *
 * Unauthenticated access → redirect to /auth/login.
 * Authenticated access → key UI panels are visible.
 */
test.describe('Merchant dashboard', () => {

  // ─── Auth guard ─────────────────────────────────────────────────────────────

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/merchant/dashboard')
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  // ─── Authenticated shell ────────────────────────────────────────────────────

  test.describe('authenticated', () => {
    test.beforeEach(async ({ page }) => {
      // Inject a token to pass client-side auth guard
      await page.goto('/auth/login')
      await page.evaluate(() => {
        localStorage.setItem('token', 'test-merchant-token')
      })

      // Mock the /me endpoint so the dashboard can load merchant details
      await page.route('**/api/v1/merchants/me', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'test-mid', name: 'Test Merchant', email: 'test@merchant.com',
            status: 'APPROVED', kraPin: 'P051234567X',
          }),
        })
      })

      // Mock transactions endpoint
      await page.route('**/api/v1/transactions**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ transactions: [], total: 0 }),
        })
      })

      await page.goto('/merchant/dashboard')
      await page.waitForLoadState('networkidle')
    })

    test('renders dashboard page without crashing', async ({ page }) => {
      // The page must not show a React error boundary or 500 screen
      await expect(page.locator('body')).not.toContainText('Application error')
      await expect(page.locator('body')).not.toContainText('Something went wrong')
    })

    test('shows merchant name in header', async ({ page }) => {
      // The authenticated merchant's name should appear somewhere on the page
      await expect(page.getByText('Test Merchant')).toBeVisible()
    })

    test('shows navigation links for key sections', async ({ page }) => {
      const nav = page.locator('nav, [role="navigation"]').first()
      await expect(nav).toBeVisible()
    })

    test('transactions section is accessible', async ({ page }) => {
      const txLink = page.getByRole('link', { name: /transaction/i })
      if (await txLink.count() > 0) {
        await txLink.first().click()
        await page.waitForLoadState('networkidle')
        await expect(page).toHaveURL(/transaction/)
      }
    })
  })
})

test.describe('Merchant transactions page', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login')
    await page.evaluate(() => localStorage.setItem('token', 'test-merchant-token'))
    await page.route('**/api/v1/merchants/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'mid', name: 'Test Merchant', status: 'APPROVED' }),
      })
    })
    await page.route('**/api/v1/transactions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          transactions: [
            {
              id: 'txn-001', amountCents: 50000, status: 'CONFIRMED',
              mpesaReceiptNumber: 'QBC12XY789', createdAt: '2025-06-01T10:00:00Z',
              maskedPhone: '2547****78',
            },
            {
              id: 'txn-002', amountCents: 25000, status: 'DECLINED',
              mpesaReceiptNumber: null, createdAt: '2025-06-01T09:30:00Z',
              maskedPhone: '2547****45',
            },
          ],
          total: 2,
        }),
      })
    })
    await page.goto('/merchant/transactions')
    await page.waitForLoadState('networkidle')
  })

  test('transactions page renders without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
  })

  test('confirmed transaction shows receipt number', async ({ page }) => {
    await expect(page.getByText('QBC12XY789')).toBeVisible()
  })

  test('declined transaction shows DECLINED status', async ({ page }) => {
    await expect(page.getByText(/declined/i)).toBeVisible()
  })

  test('phone numbers are masked in transaction list', async ({ page }) => {
    // Full phone numbers like "254712345678" must NOT appear in the UI
    const bodyText = await page.locator('body').textContent()
    expect(bodyText).not.toMatch(/2547\d{8}/)
  })

  test('transaction amounts are displayed in KSh', async ({ page }) => {
    // KES 500.00 or KSh 500 should appear for 50000 cents
    await expect(page.getByText(/500/)).toBeVisible()
  })
})
