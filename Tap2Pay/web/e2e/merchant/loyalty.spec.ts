import { test, expect } from '@playwright/test'

/**
 * E2E tests for the merchant loyalty programme page (/merchant/loyalty).
 *
 * Covers:
 *   - Auth guard (unauthenticated redirects to login)
 *   - New merchant (no programme) — sees setup prompt and form
 *   - Programme type toggle: POINTS ↔ STAMPS
 *   - Points mode: "Points per KSh" input visible, stamps input hidden
 *   - Stamps mode: "Stamps needed" input visible, points input hidden
 *   - Reward description field
 *   - Successful save (mocked POST) shows confirmation
 *   - API error during save shows error message
 *   - Existing programme pre-fills the form
 *
 * All backend calls are intercepted — no live server required.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

async function authenticateMerchant(page: any) {
  await page.goto('/auth/login')
  await page.evaluate(() => localStorage.setItem('token', 'test-merchant-token'))
}

async function stubMerchantMe(page: any) {
  await page.route('**/api/v1/merchants/me', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'mid-001', name: 'Test Merchant', status: 'APPROVED' }),
    })
  })
}

/** Stub loyalty GET to return no existing programme (new merchant). */
async function stubNoProgramme(page: any) {
  await page.route('**/api/v1/merchants/loyalty', async (route: any) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ programme_type: null, active: false }),
      })
    } else {
      await route.continue()
    }
  })
}

/** Stub loyalty GET to return an existing POINTS programme. */
async function stubExistingPointsProgramme(page: any) {
  await page.route('**/api/v1/merchants/loyalty', async (route: any) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          programme_type: 'POINTS',
          points_per_ksh: 2,
          stamps_for_reward: null,
          reward_description: 'Free coffee after 500 points',
          active: true,
        }),
      })
    } else {
      await route.continue()
    }
  })
}

/** Stub loyalty GET to return an existing STAMPS programme. */
async function stubExistingStampsProgramme(page: any) {
  await page.route('**/api/v1/merchants/loyalty', async (route: any) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          programme_type: 'STAMPS',
          points_per_ksh: null,
          stamps_for_reward: 8,
          reward_description: '10% off your next order',
          active: true,
        }),
      })
    } else {
      await route.continue()
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Merchant loyalty auth guard', () => {
  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/merchant/loyalty')
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Page structure — new merchant (no programme)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Merchant loyalty — new setup', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubNoProgramme(page)
    await page.goto('/merchant/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('renders without crashing', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('shows Loyalty Programme heading', async ({ page }) => {
    await expect(page.getByText('Loyalty Programme')).toBeVisible()
  })

  test('shows "no programme yet" onboarding message', async ({ page }) => {
    await expect(page.getByText(/don't have a loyalty programme yet/i)).toBeVisible()
  })

  test('shows Programme type label', async ({ page }) => {
    await expect(page.getByText('Programme type')).toBeVisible()
  })

  test('shows POINTS button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /points/i })).toBeVisible()
  })

  test('shows STAMPS button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /stamps/i })).toBeVisible()
  })

  test('POINTS mode is active by default', async ({ page }) => {
    const pointsBtn = page.getByRole('button', { name: /points/i })
    await expect(pointsBtn).toHaveClass(/bg-green-600/)
  })

  test('POINTS mode shows "Points per KSh spent" input', async ({ page }) => {
    await expect(page.getByText(/points per ksh spent/i)).toBeVisible()
    await expect(page.locator('input[type="number"]').first()).toBeVisible()
  })

  test('STAMPS mode shows "Stamps needed for a reward" input', async ({ page }) => {
    await page.getByRole('button', { name: /stamps/i }).click()
    await expect(page.getByText(/stamps needed for a reward/i)).toBeVisible()
  })

  test('STAMPS mode hides points per KSh input', async ({ page }) => {
    await page.getByRole('button', { name: /stamps/i }).click()
    await expect(page.getByText(/points per ksh spent/i)).not.toBeVisible()
  })

  test('switching back to POINTS mode shows points input again', async ({ page }) => {
    await page.getByRole('button', { name: /stamps/i }).click()
    await page.getByRole('button', { name: /points/i }).click()
    await expect(page.getByText(/points per ksh spent/i)).toBeVisible()
  })

  test('shows Reward description field', async ({ page }) => {
    await expect(page.getByText(/reward description/i)).toBeVisible()
    await expect(page.getByPlaceholder(/free cup of tea/i)).toBeVisible()
  })

  test('shows "Activate programme" submit button for new merchant', async ({ page }) => {
    await expect(page.getByRole('button', { name: /activate programme/i })).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Save flow — successful save
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Merchant loyalty — save flow', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubNoProgramme(page)
    await page.goto('/merchant/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('successful save shows "Saved ✓" button label', async ({ page }) => {
    await page.route('**/api/v1/merchants/loyalty', async (route: any) => {
      if (route.request().method() !== 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
      } else {
        await route.continue()
      }
    })

    // Fill points per KSh and submit
    const pointsInput = page.locator('input[type="number"]').first()
    await pointsInput.clear()
    await pointsInput.fill('1.5')
    await page.getByRole('button', { name: /activate programme/i }).click()

    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 })
  })

  test('shows "Saving…" label during submission', async ({ page }) => {
    await page.route('**/api/v1/merchants/loyalty', async (route: any) => {
      if (route.request().method() !== 'GET') {
        await new Promise(r => setTimeout(r, 300))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
      } else {
        await route.continue()
      }
    })

    await page.getByRole('button', { name: /activate programme/i }).click()
    await expect(page.getByRole('button', { name: /saving/i })).toBeVisible()
  })

  test('save button is disabled while saving', async ({ page }) => {
    await page.route('**/api/v1/merchants/loyalty', async (route: any) => {
      if (route.request().method() !== 'GET') {
        await new Promise(r => setTimeout(r, 300))
        await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
      } else {
        await route.continue()
      }
    })

    await page.getByRole('button', { name: /activate programme/i }).click()
    const savingBtn = page.getByRole('button', { name: /saving/i })
    await expect(savingBtn).toBeDisabled()
  })

  test('API error during save shows error message', async ({ page }) => {
    await page.route('**/api/v1/merchants/loyalty', async (route: any) => {
      if (route.request().method() !== 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Database error' }),
        })
      } else {
        await route.continue()
      }
    })

    await page.getByRole('button', { name: /activate programme/i }).click()
    await expect(page.getByText(/database error/i)).toBeVisible({ timeout: 5_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Existing POINTS programme — pre-filled form
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Merchant loyalty — existing POINTS programme', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubExistingPointsProgramme(page)
    await page.goto('/merchant/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('renders existing programme without crashing', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
  })

  test('does not show "no programme" onboarding banner', async ({ page }) => {
    await expect(page.getByText(/don't have a loyalty programme yet/i)).not.toBeVisible()
  })

  test('pre-fills points per KSh from existing programme', async ({ page }) => {
    const pointsInput = page.locator('input[type="number"]').first()
    await expect(pointsInput).toHaveValue('2')
  })

  test('pre-fills reward description', async ({ page }) => {
    await expect(page.getByPlaceholder(/free cup of tea/i)).toHaveValue('Free coffee after 500 points')
  })

  test('shows "Update programme" button instead of "Activate programme"', async ({ page }) => {
    await expect(page.getByRole('button', { name: /update programme/i })).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Existing STAMPS programme — pre-filled form
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Merchant loyalty — existing STAMPS programme', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubExistingStampsProgramme(page)
    await page.goto('/merchant/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('STAMPS button is active (green) for stamps programme', async ({ page }) => {
    const stampsBtn = page.getByRole('button', { name: /stamps/i })
    await expect(stampsBtn).toHaveClass(/bg-green-600/)
  })

  test('shows stamps-needed input pre-filled with 8', async ({ page }) => {
    await expect(page.getByText(/stamps needed for a reward/i)).toBeVisible()
    const stampsInput = page.locator('input[type="number"]').first()
    await expect(stampsInput).toHaveValue('8')
  })

  test('pre-fills reward description for stamps programme', async ({ page }) => {
    await expect(page.getByPlaceholder(/free cup of tea/i)).toHaveValue('10% off your next order')
  })

  test('shows "Update programme" button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /update programme/i })).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// STAMPS mode constraints
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Merchant loyalty — STAMPS mode constraints', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubNoProgramme(page)
    await page.goto('/merchant/loyalty')
    await page.waitForLoadState('networkidle')
    // Switch to stamps mode
    await page.getByRole('button', { name: /stamps/i }).click()
  })

  test('stamps input has min=2', async ({ page }) => {
    const input = page.locator('input[type="number"]').first()
    await expect(input).toHaveAttribute('min', '2')
  })

  test('stamps input has max=100', async ({ page }) => {
    const input = page.locator('input[type="number"]').first()
    await expect(input).toHaveAttribute('max', '100')
  })

  test('stamps description explains 10th-purchase reward', async ({ page }) => {
    await expect(page.getByText(/every 10th purchase earns the reward/i)).toBeVisible()
  })
})
