import { test, expect } from '@playwright/test'

/**
 * E2E tests for merchant registration (/auth/register/merchant).
 */
test.describe('Merchant registration', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/register/merchant')
    await page.waitForLoadState('networkidle')
  })

  test('registration page loads with form', async ({ page }) => {
    await expect(page.locator('form')).toBeVisible()
  })

  test('submit without required fields shows validation errors', async ({ page }) => {
    await page.getByRole('button', { name: /submit|register|apply/i }).click()
    // At least one required field error should be visible
    const emailInput = page.locator('input[type="email"]')
    const validationMsg = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage
    )
    expect(validationMsg).not.toBe('')
  })

  test('successful registration shows pending-approval message', async ({ page }) => {
    await page.route('**/api/v1/auth/merchant/register', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Registration submitted. Pending admin approval.' }),
      })
    })

    // Fill required fields
    await page.locator('input[name="businessName"], input[placeholder*="business" i]').fill('Test Shop Ltd').catch(() => {})
    await page.locator('input[type="email"]').fill('new@merchant.com')
    await page.locator('input[type="password"]').first().fill('SecurePass1!')
    await page.locator('input[type="password"]').last().fill('SecurePass1!').catch(() => {})
    await page.locator('input[name="phone"], input[placeholder*="phone" i]').fill('254712345678').catch(() => {})

    await page.getByRole('button', { name: /submit|register|apply/i }).click()

    await expect(page.getByText(/pending|approval|review/i)).toBeVisible({ timeout: 5_000 })
  })

  test('duplicate email shows conflict error', async ({ page }) => {
    await page.route('**/api/v1/auth/merchant/register', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Email already registered' }),
      })
    })
    await page.locator('input[type="email"]').fill('existing@merchant.com')
    await page.locator('input[type="password"]').first().fill('SecurePass1!')
    await page.getByRole('button', { name: /submit|register|apply/i }).click()

    await expect(page.getByText(/email already/i)).toBeVisible({ timeout: 5_000 })
  })

  test('link to login page is present', async ({ page }) => {
    const loginLink = page.getByRole('link', { name: /sign in|log in|login/i })
    await expect(loginLink).toBeVisible()
  })
})
