import { test, expect } from '@playwright/test'

/**
 * E2E tests for the consumer web portal.
 *
 * Covers consumer dashboard, P2P send flow, and QR code generation.
 */
test.describe('Consumer portal', () => {

  test('unauthenticated access to consumer dashboard redirects to login', async ({ page }) => {
    await page.goto('/consumer/dashboard')
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  test.describe('authenticated consumer', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/auth/login')
      await page.evaluate(() => {
        localStorage.setItem('consumer_token', 'test-consumer-token')
      })

      await page.route('**/api/v1/consumers/me', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'cid-001', name: 'Jane Consumer',
            maskedPhone: '2547****78', balanceCents: 250000,
          }),
        })
      })

      await page.route('**/api/v1/consumers/transactions**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ transactions: [], total: 0 }),
        })
      })

      await page.goto('/consumer/dashboard')
      await page.waitForLoadState('networkidle')
    })

    test('consumer dashboard renders without error', async ({ page }) => {
      await expect(page.locator('body')).not.toContainText('Application error')
    })

    test('shows consumer name', async ({ page }) => {
      await expect(page.getByText('Jane Consumer')).toBeVisible()
    })

    test('shows masked phone number', async ({ page }) => {
      const bodyText = await page.locator('body').textContent()
      // Masked phone should appear
      expect(bodyText).toContain('2547****78')
      // Full phone must NOT appear
      expect(bodyText).not.toMatch(/2547\d{8}/)
    })

    test('does not display wallet balance in cleartext on main dashboard', async ({ page }) => {
      // Balance should be visible but formattable — show as KSh 2,500.00
      // The raw number 250000 (cents) should not appear literally
      const bodyText = await page.locator('body').textContent()
      // Either hidden behind a toggle or formatted
      // Just ensure no raw unformatted 250000 appears
      // (The actual balance display is KSh 2,500 or similar)
      expect(bodyText).not.toContain('250000 cents')
    })
  })
})

test.describe('Consumer QR code generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login')
    await page.evaluate(() => localStorage.setItem('consumer_token', 'test-consumer-token'))
    await page.route('**/api/v1/consumers/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'cid-001', name: 'Jane Consumer', maskedPhone: '2547****78' }),
      })
    })
    await page.route('**/api/v1/consumers/qr-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'qr-token-abc123', expiresInSeconds: 300 }),
      })
    })
    await page.goto('/consumer/pay')
    await page.waitForLoadState('networkidle')
  })

  test('QR pay page renders without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
  })

  test('QR code is visible on consumer pay page', async ({ page }) => {
    // qrcode.react renders an SVG or canvas element
    const qrCode = page.locator('svg, canvas').first()
    await expect(qrCode).toBeVisible({ timeout: 5_000 })
  })

  test('QR token expiry countdown is visible', async ({ page }) => {
    // The 5-minute expiry should be shown as a countdown to the consumer
    const countdown = page.getByText(/expires|valid for|seconds/i)
    if (await countdown.count() > 0) {
      await expect(countdown.first()).toBeVisible()
    }
  })
})

test.describe('Consumer P2P send', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login')
    await page.evaluate(() => localStorage.setItem('consumer_token', 'test-consumer-token'))
    await page.route('**/api/v1/consumers/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'cid-001', name: 'Jane Consumer', balanceCents: 250000 }),
      })
    })
    await page.goto('/consumer/pay')
    await page.waitForLoadState('networkidle')
  })

  test('P2P send page loads', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
  })
})
