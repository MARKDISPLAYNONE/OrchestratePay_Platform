import { test, expect } from '@playwright/test'

/**
 * E2E tests for the consumer loyalty rewards page (/consumer/loyalty).
 *
 * Covers:
 *   - Auth guard (unauthenticated redirects to login)
 *   - Page structure: heading, loading state
 *   - Empty state (no loyalty cards yet)
 *   - Single POINTS card: balance shown, progress bar present
 *   - Single STAMPS card: stamps balance shown, stamp-card UI
 *   - Multiple cards from multiple merchants
 *   - Progress bar reflects percentage toward redemption threshold
 *   - "Ready to redeem!" shown when balance meets threshold
 *   - "X to go" shown when under threshold
 *   - Error state when API fails
 *
 * All backend calls are intercepted — no live server required.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BALANCE_POINTS_LOW = {
  merchant_id:   'mer-001',
  merchant_name: 'Savanna Eats',
  reward_type:   'POINTS',
  points_balance:  350,
  stamps_balance:  0,
  lifetime_points: 1200,
  lifetime_stamps: 0,
  redeem_threshold: 1000,
}

const BALANCE_POINTS_READY = {
  merchant_id:   'mer-002',
  merchant_name: 'Nakuru Crafts',
  reward_type:   'POINTS',
  points_balance:  1000,
  stamps_balance:  0,
  lifetime_points: 1000,
  lifetime_stamps: 0,
  redeem_threshold: 1000,
}

const BALANCE_STAMPS = {
  merchant_id:   'mer-003',
  merchant_name: 'Mombasa Spice Hub',
  reward_type:   'STAMPS',
  points_balance:  0,
  stamps_balance:  6,
  lifetime_points: 0,
  lifetime_stamps: 15,
  redeem_threshold: 10,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function authenticateConsumer(page: any) {
  await page.goto('/auth/login')
  await page.evaluate(() => localStorage.setItem('consumer_token', 'test-consumer-token'))
}

async function stubConsumerMe(page: any) {
  await page.route('**/api/v1/consumers/me', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'cid-001', name: 'Jane Consumer', maskedPhone: '2547****78' }),
    })
  })
}

async function stubLoyalty(page: any, balances: any[]) {
  await page.route('**/api/v1/consumers/loyalty', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ balances }),
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty auth guard', () => {
  test('unauthenticated access to /consumer/loyalty redirects to login', async ({ page }) => {
    await page.goto('/consumer/loyalty')
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Page structure
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty — page structure', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)
    await stubLoyalty(page, [BALANCE_POINTS_LOW])
    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('renders without crashing', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('shows "Loyalty rewards" heading', async ({ page }) => {
    await expect(page.getByText('Loyalty rewards')).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty — empty state', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)
    await stubLoyalty(page, [])
    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('shows "No loyalty cards yet" message', async ({ page }) => {
    await expect(page.getByText(/no loyalty cards yet/i)).toBeVisible()
  })

  test('shows prompt to pay at a merchant', async ({ page }) => {
    await expect(page.getByText(/pay at a merchant to start earning/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POINTS card — under threshold
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty — POINTS card (under threshold)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)
    await stubLoyalty(page, [BALANCE_POINTS_LOW])
    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('shows merchant name', async ({ page }) => {
    await expect(page.getByText('Savanna Eats')).toBeVisible()
  })

  test('shows "Points" programme label', async ({ page }) => {
    await expect(page.getByText('Points programme')).toBeVisible()
  })

  test('shows points balance prominently', async ({ page }) => {
    await expect(page.getByText('350')).toBeVisible()
  })

  test('shows "pts" unit label', async ({ page }) => {
    await expect(page.getByText('pts')).toBeVisible()
  })

  test('shows "Progress to next reward" label', async ({ page }) => {
    await expect(page.getByText('Progress to next reward')).toBeVisible()
  })

  test('shows progress percentage (35%)', async ({ page }) => {
    // 350/1000 = 35%
    await expect(page.getByText('35%')).toBeVisible()
  })

  test('shows "X to go" counter', async ({ page }) => {
    // 1000 - 350 = 650 to go
    await expect(page.getByText(/650.*to go/i)).toBeVisible()
  })

  test('progress bar is rendered', async ({ page }) => {
    const progressBar = page.locator('.bg-green-500.h-2.rounded-full')
    await expect(progressBar.first()).toBeVisible()
  })

  test('progress bar width reflects percentage', async ({ page }) => {
    const progressBar = page.locator('.bg-green-500.h-2.rounded-full').first()
    const style = await progressBar.getAttribute('style')
    expect(style).toContain('35%')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POINTS card — ready to redeem
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty — POINTS card (ready to redeem)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)
    await stubLoyalty(page, [BALANCE_POINTS_READY])
    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('shows merchant name', async ({ page }) => {
    await expect(page.getByText('Nakuru Crafts')).toBeVisible()
  })

  test('shows points balance of 1,000', async ({ page }) => {
    await expect(page.getByText('1,000')).toBeVisible()
  })

  test('shows "Ready to redeem!" instead of "X to go"', async ({ page }) => {
    await expect(page.getByText(/ready to redeem!/i)).toBeVisible()
  })

  test('progress bar shows 100% width', async ({ page }) => {
    const progressBar = page.locator('.bg-green-500.h-2.rounded-full').first()
    const style = await progressBar.getAttribute('style')
    expect(style).toContain('100%')
  })

  test('shows 100% progress indicator', async ({ page }) => {
    await expect(page.getByText('100%')).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// STAMPS card
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty — STAMPS card', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)
    await stubLoyalty(page, [BALANCE_STAMPS])
    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('shows merchant name', async ({ page }) => {
    await expect(page.getByText('Mombasa Spice Hub')).toBeVisible()
  })

  test('shows "Stamps" programme label', async ({ page }) => {
    await expect(page.getByText('Stamps programme')).toBeVisible()
  })

  test('shows stamps balance (6)', async ({ page }) => {
    await expect(page.getByText('6')).toBeVisible()
  })

  test('shows "stamps" unit label', async ({ page }) => {
    await expect(page.getByText('stamps')).toBeVisible()
  })

  test('shows progress percentage (60%)', async ({ page }) => {
    // 6/10 = 60%
    await expect(page.getByText('60%')).toBeVisible()
  })

  test('shows "4 to go" for stamps card', async ({ page }) => {
    // 10 - 6 = 4 to go
    await expect(page.getByText(/4.*to go/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Multiple merchants
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty — multiple merchant cards', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)
    await stubLoyalty(page, [BALANCE_POINTS_LOW, BALANCE_POINTS_READY, BALANCE_STAMPS])
    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')
  })

  test('shows all three merchant names', async ({ page }) => {
    await expect(page.getByText('Savanna Eats')).toBeVisible()
    await expect(page.getByText('Nakuru Crafts')).toBeVisible()
    await expect(page.getByText('Mombasa Spice Hub')).toBeVisible()
  })

  test('shows three loyalty cards', async ({ page }) => {
    const cards = page.locator('.bg-white.rounded-2xl.border')
    expect(await cards.count()).toBe(3)
  })

  test('shows "Ready to redeem!" for the maxed-out card', async ({ page }) => {
    await expect(page.getByText(/ready to redeem!/i)).toBeVisible()
  })

  test('shows "650 to go" for the points-low card', async ({ page }) => {
    await expect(page.getByText(/650.*to go/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error state
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty — error state', () => {
  test('shows error message when API fails', async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)

    await page.route('**/api/v1/consumers/loyalty', async (route: any) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Database error' }),
      })
    })

    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/failed to load loyalty rewards/i)).toBeVisible()
  })

  test('error message has red styling', async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)

    await page.route('**/api/v1/consumers/loyalty', async (route: any) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service unavailable' }),
      })
    })

    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')

    const errorDiv = page.locator('.text-red-600')
    await expect(errorDiv).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Null reward_type (defaults to POINTS behaviour)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Consumer loyalty — null reward_type defaults to POINTS', () => {
  test('shows pts label when reward_type is null', async ({ page }) => {
    await authenticateConsumer(page)
    await stubConsumerMe(page)
    await stubLoyalty(page, [{
      merchant_id:   'mer-null',
      merchant_name: 'Legacy Merchant',
      reward_type:   null,
      points_balance:  500,
      stamps_balance:  0,
      lifetime_points: 500,
      lifetime_stamps: 0,
      redeem_threshold: null,   // will default to 1000 in component
    }])

    await page.goto('/consumer/loyalty')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Legacy Merchant')).toBeVisible()
    await expect(page.getByText('Points programme')).toBeVisible()
    await expect(page.getByText('pts')).toBeVisible()
  })
})
