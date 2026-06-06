import { test, expect } from '@playwright/test'

/**
 * E2E tests for the login page (/auth/login).
 *
 * Covers:
 *   - Page loads and renders key elements
 *   - Merchant/consumer mode toggle
 *   - Form validation (empty fields, invalid email)
 *   - Password visibility toggle
 *   - Sign-in button state during loading
 *   - Error message shown on bad credentials
 *   - Successful redirect on correct credentials (mocked)
 */
test.describe('Login page', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login')
    await page.waitForLoadState('networkidle')
  })

  // ─── Page structure ────────────────────────────────────────────────────────

  test('renders OrchestratePay branding', async ({ page }) => {
    await expect(page.getByText('OrchestratePay')).toBeVisible()
  })

  test('shows email and password inputs', async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('shows Sign in button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('shows merchant and consumer mode tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /merchant/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /consumer/i })).toBeVisible()
  })

  // ─── Mode toggle ───────────────────────────────────────────────────────────

  test('merchant tab is active by default', async ({ page }) => {
    const merchantBtn = page.getByRole('button', { name: /merchant/i })
    await expect(merchantBtn).toHaveClass(/bg-green-600/)
  })

  test('clicking consumer tab switches mode', async ({ page }) => {
    await page.getByRole('button', { name: /consumer/i }).click()
    const consumerBtn = page.getByRole('button', { name: /consumer/i })
    await expect(consumerBtn).toHaveClass(/bg-green-600/)
  })

  test('mode toggle shows register link appropriate to mode', async ({ page }) => {
    // Merchant mode: "Apply for access"
    await expect(page.getByRole('link', { name: /apply for access/i })).toBeVisible()

    // Consumer mode: "Create account"
    await page.getByRole('button', { name: /consumer/i }).click()
    await expect(page.getByRole('link', { name: /create account/i })).toBeVisible()
  })

  // ─── Form validation ───────────────────────────────────────────────────────

  test('HTML5 email validation rejects invalid format', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill('notanemail')
    await page.getByRole('button', { name: /sign in/i }).click()
    // Browser native validation prevents submit
    const validationMsg = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage
    )
    expect(validationMsg).not.toBe('')
  })

  test('password field is required', async ({ page }) => {
    await page.locator('input[type="email"]').fill('test@test.com')
    await page.getByRole('button', { name: /sign in/i }).click()
    const pwInput = page.locator('input[type="password"]')
    const validationMsg = await pwInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage
    )
    expect(validationMsg).not.toBe('')
  })

  // ─── Password visibility toggle ────────────────────────────────────────────

  test('password toggle changes input type from password to text', async ({ page }) => {
    await page.locator('input[type="password"]').fill('secret123')
    const toggleBtn = page.getByRole('button', { name: /show password/i })
    await toggleBtn.click()
    await expect(page.locator('input[type="text"][autocomplete="current-password"]')).toBeVisible()
  })

  test('password toggle button has accessible aria-label', async ({ page }) => {
    const toggleBtn = page.getByRole('button', { name: /show password|hide password/i })
    await expect(toggleBtn).toBeVisible()
  })

  // ─── Sign-in loading state ─────────────────────────────────────────────────

  test('sign-in button shows loading text while submitting', async ({ page }) => {
    // Intercept the login API and delay the response to observe loading state
    await page.route('**/api/v1/auth/merchant/login', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 200))
      await route.fulfill({ status: 401, body: JSON.stringify({ error: 'Invalid credentials' }) })
    })
    await page.locator('input[type="email"]').fill('test@test.com')
    await page.locator('input[type="password"]').fill('password123!')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page.getByRole('button', { name: /signing in/i })).toBeVisible()
  })

  test('sign-in button is disabled while loading', async ({ page }) => {
    await page.route('**/api/v1/auth/merchant/login', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 300))
      await route.fulfill({ status: 401, body: JSON.stringify({ error: 'Invalid credentials' }) })
    })
    await page.locator('input[type="email"]').fill('test@test.com')
    await page.locator('input[type="password"]').fill('password123!')
    await page.getByRole('button', { name: /sign in/i }).click()

    const submitBtn = page.getByRole('button', { name: /signing in/i })
    await expect(submitBtn).toBeDisabled()
  })

  // ─── Error display ─────────────────────────────────────────────────────────

  test('shows error message when credentials are invalid', async ({ page }) => {
    await page.route('**/api/v1/auth/merchant/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid email or password' }),
      })
    })
    await page.locator('input[type="email"]').fill('wrong@test.com')
    await page.locator('input[type="password"]').fill('wrongpassword1!')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page.getByText(/invalid email or password/i)).toBeVisible()
  })

  test('shows 429 lockout message when account is locked', async ({ page }) => {
    await page.route('**/api/v1/auth/merchant/login', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Account locked. Try again in 15 minutes.' }),
      })
    })
    await page.locator('input[type="email"]').fill('locked@test.com')
    await page.locator('input[type="password"]').fill('anypassword1!')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page.getByText(/account locked/i)).toBeVisible()
  })

  // ─── Successful login redirect ─────────────────────────────────────────────

  test('successful merchant login redirects to /merchant/dashboard', async ({ page }) => {
    await page.route('**/api/v1/auth/merchant/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'fake.jwt.token', merchant: { id: 'mid', name: 'Test Merchant' } }),
      })
    })
    await page.locator('input[type="email"]').fill('merchant@test.com')
    await page.locator('input[type="password"]').fill('validPassword1!')
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL('**/merchant/dashboard', { timeout: 5_000 })
    expect(page.url()).toContain('/merchant/dashboard')
  })

  test('successful consumer login redirects to /consumer/dashboard', async ({ page }) => {
    await page.getByRole('button', { name: /consumer/i }).click()
    await page.route('**/api/v1/auth/consumer/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'fake.consumer.jwt', consumer: { id: 'cid', name: 'Test Consumer' } }),
      })
    })
    await page.locator('input[type="email"]').fill('consumer@test.com')
    await page.locator('input[type="password"]').fill('validPassword1!')
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL('**/consumer/dashboard', { timeout: 5_000 })
    expect(page.url()).toContain('/consumer/dashboard')
  })
})
