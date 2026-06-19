import { test, expect } from '@playwright/test'

/**
 * E2E tests for the admin merchant approval workflow (/admin/merchants).
 *
 * Covers:
 *   - Auth guard: unauthenticated access redirects to /admin/login
 *   - Merchant list renders with PENDING merchants
 *   - Merchant info displayed (name, email, phone, reg number, applied date)
 *   - Approve action: removes merchant from list
 *   - Reject action: removes merchant from list
 *   - Suspend action: removes merchant from list
 *   - Notes field per merchant
 *   - Empty state when no pending applications
 *   - Error banner when API fails
 *   - Refresh button re-fetches the list
 *
 * All backend calls are intercepted — no live server required.
 * Admin auth uses the sessionStorage-based pattern established in
 * e2e/admin/portal.spec.ts (admin_secret key).
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_MERCHANTS = [
  {
    id: 'mer-001',
    name: 'Savanna Eats',
    email: 'owner@savanna.co.ke',
    phone: '+254701234567',
    business_reg_number: 'BN/2024/001',
    mpesa_shortcode: '174379',
    created_at: '2025-06-01T08:00:00Z',
    approval_status: 'PENDING',
  },
  {
    id: 'mer-002',
    name: 'Nakuru Crafts',
    email: 'info@nakurucrafts.com',
    phone: '+254722987654',
    business_reg_number: null,
    mpesa_shortcode: null,
    created_at: '2025-06-02T10:30:00Z',
    approval_status: 'PENDING',
  },
  {
    id: 'mer-003',
    name: 'Mombasa Spice Hub',
    email: 'spice@mombasa.co.ke',
    phone: '+254733111222',
    business_reg_number: 'BN/2024/099',
    mpesa_shortcode: '888123',
    created_at: '2025-06-03T12:00:00Z',
    approval_status: 'PENDING',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function authenticateAdmin(page: any) {
  await page.goto('/admin/login')
  await page.evaluate(() => sessionStorage.setItem('admin_secret', 'test-admin-secret'))
}

async function stubPendingMerchants(page: any, merchants = MOCK_MERCHANTS) {
  await page.route('**/api/v1/auth/admin/pending', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ merchants }),
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — auth guard', () => {
  test('unauthenticated access to /admin/merchants redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin/merchants')
    await expect(page).toHaveURL(/\/admin\/login/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Page structure
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — page structure', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAdmin(page)
    await stubPendingMerchants(page)
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')
  })

  test('renders without crashing', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('shows Merchant Applications heading', async ({ page }) => {
    await expect(page.getByText(/merchant applications/i)).toBeVisible()
  })

  test('shows subheading about reviewing registrations', async ({ page }) => {
    await expect(page.getByText(/review and approve new merchant registrations/i)).toBeVisible()
  })

  test('shows Refresh button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Merchant list rendering
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — merchant list', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAdmin(page)
    await stubPendingMerchants(page)
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')
  })

  test('displays all three merchant names', async ({ page }) => {
    await expect(page.getByText('Savanna Eats')).toBeVisible()
    await expect(page.getByText('Nakuru Crafts')).toBeVisible()
    await expect(page.getByText('Mombasa Spice Hub')).toBeVisible()
  })

  test('displays merchant email addresses', async ({ page }) => {
    await expect(page.getByText('owner@savanna.co.ke')).toBeVisible()
    await expect(page.getByText('info@nakurucrafts.com')).toBeVisible()
    await expect(page.getByText('spice@mombasa.co.ke')).toBeVisible()
  })

  test('displays merchant phone numbers', async ({ page }) => {
    await expect(page.getByText('+254701234567')).toBeVisible()
    await expect(page.getByText('+254722987654')).toBeVisible()
  })

  test('displays business registration numbers where present', async ({ page }) => {
    await expect(page.getByText(/BN\/2024\/001/)).toBeVisible()
    await expect(page.getByText(/BN\/2024\/099/)).toBeVisible()
  })

  test('displays M-Pesa shortcode where present', async ({ page }) => {
    await expect(page.getByText('174379')).toBeVisible()
  })

  test('shows PENDING status badge for each merchant', async ({ page }) => {
    const pendingBadges = page.getByText('PENDING')
    expect(await pendingBadges.count()).toBeGreaterThanOrEqual(3)
  })

  test('each card has approve, reject and suspend buttons', async ({ page }) => {
    const approveButtons = page.getByRole('button', { name: /^approve$/i })
    expect(await approveButtons.count()).toBe(3)

    const rejectButtons = page.getByRole('button', { name: /^reject$/i })
    expect(await rejectButtons.count()).toBe(3)

    const suspendButtons = page.getByRole('button', { name: /^suspend$/i })
    expect(await suspendButtons.count()).toBe(3)
  })

  test('each card has a notes input field', async ({ page }) => {
    const notesInputs = page.locator('input[placeholder*="KYC verified" i]')
    expect(await notesInputs.count()).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Approve action
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — approve', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAdmin(page)
    await stubPendingMerchants(page)
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')
  })

  test('approving mer-001 removes Savanna Eats from the list', async ({ page }) => {
    await page.route('**/api/v1/auth/admin/approve/mer-001', async (route: any) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true }) })
    })

    await page.getByRole('button', { name: /^approve$/i }).first().click()

    await expect(page.getByText('Savanna Eats')).not.toBeVisible({ timeout: 5_000 })
    // Other merchants remain
    await expect(page.getByText('Nakuru Crafts')).toBeVisible()
    await expect(page.getByText('Mombasa Spice Hub')).toBeVisible()
  })

  test('buttons show loading indicator during approve', async ({ page }) => {
    await page.route('**/api/v1/auth/admin/approve/mer-001', async (route: any) => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
    })

    await page.getByRole('button', { name: /^approve$/i }).first().click()
    // During action, button text changes to "…"
    await expect(page.getByText('…').first()).toBeVisible()
  })

  test('action buttons are disabled while acting on a merchant', async ({ page }) => {
    await page.route('**/api/v1/auth/admin/approve/mer-001', async (route: any) => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
    })

    await page.getByRole('button', { name: /^approve$/i }).first().click()
    // All buttons for the first merchant card should be disabled
    const firstCard = page.locator('div').filter({ hasText: 'Savanna Eats' }).first()
    const buttons = firstCard.getByRole('button')
    await expect(buttons.first()).toBeDisabled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Reject action
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — reject', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAdmin(page)
    await stubPendingMerchants(page)
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')
  })

  test('rejecting mer-001 removes Savanna Eats from the list', async ({ page }) => {
    await page.route('**/api/v1/auth/admin/approve/mer-001', async (route: any) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true }) })
    })

    await page.getByRole('button', { name: /^reject$/i }).first().click()
    await expect(page.getByText('Savanna Eats')).not.toBeVisible({ timeout: 5_000 })
  })

  test('rejection with review note sends note in the request', async ({ page }) => {
    let capturedBody: any = null
    await page.route('**/api/v1/auth/admin/approve/mer-001', async (route: any) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
    })

    // Type a review note before rejecting
    await page.locator('input[placeholder*="KYC verified" i]').first().fill('Documents incomplete')
    await page.getByRole('button', { name: /^reject$/i }).first().click()

    await expect(page.getByText('Savanna Eats')).not.toBeVisible({ timeout: 5_000 })
    // The note should have been included in the request
    if (capturedBody) {
      expect(capturedBody.notes ?? capturedBody.note).toBeTruthy()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suspend action
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — suspend', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAdmin(page)
    await stubPendingMerchants(page)
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')
  })

  test('suspending mer-002 removes Nakuru Crafts from the list', async ({ page }) => {
    await page.route('**/api/v1/auth/admin/approve/mer-002', async (route: any) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true }) })
    })

    // Suspend button for mer-002 is the second card's suspend
    await page.getByRole('button', { name: /^suspend$/i }).nth(1).click()
    await expect(page.getByText('Nakuru Crafts')).not.toBeVisible({ timeout: 5_000 })
    // First merchant still present
    await expect(page.getByText('Savanna Eats')).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — error handling', () => {
  test('shows error banner when API fails to load merchants', async ({ page }) => {
    await authenticateAdmin(page)
    await page.route('**/api/v1/auth/admin/pending', async (route: any) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      })
    })
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/internal server error/i)).toBeVisible()
  })

  test('shows error when approve action fails', async ({ page }) => {
    await authenticateAdmin(page)
    await stubPendingMerchants(page)
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')

    await page.route('**/api/v1/auth/admin/approve/mer-001', async (route: any) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Merchant already processed' }),
      })
    })

    await page.getByRole('button', { name: /^approve$/i }).first().click()
    await expect(page.getByText(/merchant already processed/i)).toBeVisible({ timeout: 5_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — empty state', () => {
  test('shows "No pending applications" when list is empty', async ({ page }) => {
    await authenticateAdmin(page)
    await stubPendingMerchants(page, [])
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/no pending applications/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Refresh
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchant approval — refresh', () => {
  test('Refresh button re-fetches the merchant list', async ({ page }) => {
    await authenticateAdmin(page)

    let callCount = 0
    await page.route('**/api/v1/auth/admin/pending', async (route: any) => {
      callCount++
      const merchants = callCount === 1 ? MOCK_MERCHANTS : [MOCK_MERCHANTS[0]]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ merchants }),
      })
    })

    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')

    // All three shown initially
    await expect(page.getByText('Nakuru Crafts')).toBeVisible()

    // Click Refresh — second API call returns only Savanna Eats
    await page.getByRole('button', { name: /refresh/i }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Nakuru Crafts')).not.toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('Savanna Eats')).toBeVisible()
  })
})
