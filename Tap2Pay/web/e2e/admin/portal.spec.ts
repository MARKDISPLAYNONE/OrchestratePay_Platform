import { test, expect } from '@playwright/test'

/**
 * E2E tests for the admin portal.
 *
 * Covers:
 *   - Auth guard: unauthenticated access redirects to /admin/login
 *   - Admin login: form renders, invalid secret shows error, valid secret redirects
 *   - Admin dashboard: stats loaded from mocked API
 *   - Admin merchants: pending list renders, approve/reject actions work
 *   - Admin fleet: device list renders with telemetry data
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Inject the admin secret into sessionStorage and pre-stub the stats API. */
async function authenticateAdmin(page: any) {
  await page.goto('/admin/login')
  await page.evaluate(() => sessionStorage.setItem('admin_secret', 'test-admin-secret'))
}

const MOCK_STATS = {
  generatedAt: new Date().toISOString(),
  allTime:  { total: 1240, confirmed: 1105, pending: 8 },
  last24h:  { total: 47, confirmed: 42, declined: 3, failed: 2, successRate: 0.894, timeoutRate: 0.04 },
  timing:   { medianConfirmMs: 8200, p95ConfirmMs: 18500, avgConfirmMs: 9100 },
  infrastructure: { redis: 'ok', darajaCircuit: { state: 'CLOSED', failureCount: 0 } },
  hourly: [],
}

const MOCK_MERCHANTS = [
  {
    id: 'mer-001', name: 'Savanna Eats', email: 'owner@savanna.co.ke',
    phone: '+254701234567', business_reg_number: 'BN/2024/001',
    mpesa_shortcode: '174379', created_at: '2025-06-01T08:00:00Z',
    approval_status: 'PENDING',
  },
  {
    id: 'mer-002', name: 'Nakuru Crafts', email: 'info@nakurucrafts.com',
    phone: '+254722987654', business_reg_number: null,
    mpesa_shortcode: null, created_at: '2025-06-02T10:30:00Z',
    approval_status: 'PENDING',
  },
]

const MOCK_DEVICES = [
  {
    id: 'dev-001', device_serial: 'SUNMI-A1B2C3', model: 'Sunmi P2 Pro',
    merchant_name: 'Savanna Eats', active: true,
    last_seen_at: new Date().toISOString(), battery_pct: 82,
    printer_status: 1, nfc_available: true, app_version_code: 12,
    device_type: 'NFC_TAG',
  },
  {
    id: 'dev-002', device_serial: 'SUNMI-D4E5F6', model: 'Sunmi P2 Pro',
    merchant_name: 'Nakuru Crafts', active: true,
    last_seen_at: new Date().toISOString(), battery_pct: 15,
    printer_status: 4, nfc_available: true, app_version_code: 11,
    device_type: 'NFC_TAG',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin auth guard', () => {
  test('unauthenticated access to /admin redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('unauthenticated access to /admin/merchants redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin/merchants')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('unauthenticated access to /admin/fleet redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin/fleet')
    await expect(page).toHaveURL(/\/admin\/login/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin login page
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login')
    await page.waitForLoadState('networkidle')
  })

  test('renders OrchestratePay admin portal heading', async ({ page }) => {
    await expect(page.getByText('OrchestratePay')).toBeVisible()
    await expect(page.getByText(/admin portal/i)).toBeVisible()
  })

  test('shows admin secret input and submit button', async ({ page }) => {
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in to admin/i })).toBeVisible()
  })

  test('secret toggle changes input type to text', async ({ page }) => {
    await page.locator('input[type="password"]').fill('mysecret')
    await page.getByRole('button', { name: /show secret/i }).click()
    await expect(page.locator('input[type="text"]')).toBeVisible()
  })

  test('shows error message on invalid secret', async ({ page }) => {
    await page.route('**/api/v1/admin/stats', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }) })
    })
    await page.locator('input[type="password"]').fill('wrong-secret')
    await page.getByRole('button', { name: /sign in to admin/i }).click()
    await expect(page.getByText(/invalid admin secret/i)).toBeVisible()
  })

  test('shows loading state while verifying', async ({ page }) => {
    await page.route('**/api/v1/admin/stats', async (route) => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({ status: 401, body: JSON.stringify({ error: 'Unauthorized' }) })
    })
    await page.locator('input[type="password"]').fill('any-secret')
    await page.getByRole('button', { name: /sign in to admin/i }).click()
    await expect(page.getByRole('button', { name: /verifying/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /verifying/i })).toBeDisabled()
  })

  test('redirects to /admin on valid secret', async ({ page }) => {
    await page.route('**/api/v1/admin/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(MOCK_STATS) })
    })
    await page.locator('input[type="password"]').fill('valid-secret')
    await page.getByRole('button', { name: /sign in to admin/i }).click()
    await page.waitForURL('**/admin', { timeout: 5_000 })
    expect(page.url()).toMatch(/\/admin$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin dashboard (stats)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAdmin(page)
    await page.route('**/api/v1/admin/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(MOCK_STATS) })
    })
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
  })

  test('renders without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('shows Platform Dashboard heading', async ({ page }) => {
    await expect(page.getByText(/platform dashboard/i)).toBeVisible()
  })

  test('displays last-24h confirmed transaction count', async ({ page }) => {
    await expect(page.getByText('42')).toBeVisible()
  })

  test('displays infrastructure status for Redis', async ({ page }) => {
    await expect(page.getByText('Redis')).toBeVisible()
    await expect(page.getByText('ok')).toBeVisible()
  })

  test('displays Daraja circuit status', async ({ page }) => {
    await expect(page.getByText('Daraja circuit')).toBeVisible()
    await expect(page.getByText(/CLOSED/)).toBeVisible()
  })

  test('shows payment timing stats', async ({ page }) => {
    await expect(page.getByText('Payment timing')).toBeVisible()
  })

  test('shows error if stats API fails', async ({ page }) => {
    // Override the mock to return an error for this test
    await page.unroute('**/api/v1/admin/stats')
    await page.route('**/api/v1/admin/stats', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'Service unavailable' }) })
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/error/i)).toBeVisible()
  })

  test('sidebar navigation links are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /merchants/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /fleet/i })).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin merchants page
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin merchants page', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAdmin(page)
    await page.route('**/api/v1/auth/admin/pending', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ merchants: MOCK_MERCHANTS }) })
    })
    await page.goto('/admin/merchants')
    await page.waitForLoadState('networkidle')
  })

  test('renders Merchant Applications heading', async ({ page }) => {
    await expect(page.getByText(/merchant applications/i)).toBeVisible()
  })

  test('displays pending merchant names', async ({ page }) => {
    await expect(page.getByText('Savanna Eats')).toBeVisible()
    await expect(page.getByText('Nakuru Crafts')).toBeVisible()
  })

  test('displays merchant email and phone', async ({ page }) => {
    await expect(page.getByText('owner@savanna.co.ke')).toBeVisible()
    await expect(page.getByText('+254701234567')).toBeVisible()
  })

  test('shows approve, reject and suspend buttons for each merchant', async ({ page }) => {
    const approveButtons = page.getByRole('button', { name: /^approve$/i })
    await expect(approveButtons.first()).toBeVisible()
    const rejectButtons = page.getByRole('button', { name: /^reject$/i })
    await expect(rejectButtons.first()).toBeVisible()
    const suspendButtons = page.getByRole('button', { name: /^suspend$/i })
    await expect(suspendButtons.first()).toBeVisible()
  })

  test('approving a merchant removes it from the list', async ({ page }) => {
    await page.route('**/api/v1/auth/admin/approve/mer-001', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true }) })
    })
    await page.getByRole('button', { name: /^approve$/i }).first().click()
    await expect(page.getByText('Savanna Eats')).not.toBeVisible()
    // Second merchant remains
    await expect(page.getByText('Nakuru Crafts')).toBeVisible()
  })

  test('shows empty state when no pending applications', async ({ page }) => {
    await page.unroute('**/api/v1/auth/admin/pending')
    await page.route('**/api/v1/auth/admin/pending', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ merchants: [] }) })
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/no pending applications/i)).toBeVisible()
  })

  test('shows error banner when API fails', async ({ page }) => {
    await page.unroute('**/api/v1/auth/admin/pending')
    await page.route('**/api/v1/auth/admin/pending', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }) })
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/internal server error/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin fleet page
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin fleet page', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAdmin(page)
    await page.route('**/api/v1/admin/fleet$', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ devices: MOCK_DEVICES }) })
    })
    await page.route('**/api/v1/admin/fleet/alerts**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ alerts: [] }) })
    })
    await page.goto('/admin/fleet')
    await page.waitForLoadState('networkidle')
  })

  test('renders Device Fleet heading', async ({ page }) => {
    await expect(page.getByText(/device fleet/i)).toBeVisible()
  })

  test('displays device serial numbers', async ({ page }) => {
    await expect(page.getByText('SUNMI-A1B2C3')).toBeVisible()
    await expect(page.getByText('SUNMI-D4E5F6')).toBeVisible()
  })

  test('displays merchant names associated with devices', async ({ page }) => {
    await expect(page.getByText('Savanna Eats')).toBeVisible()
    await expect(page.getByText('Nakuru Crafts')).toBeVisible()
  })

  test('displays battery percentage for devices', async ({ page }) => {
    await expect(page.getByText(/82/)).toBeVisible()
    // Low battery device (15%) should also be shown
    await expect(page.getByText(/15/)).toBeVisible()
  })

  test('renders without crashing when fleet is empty', async ({ page }) => {
    await page.unroute('**/api/v1/admin/fleet$')
    await page.route('**/api/v1/admin/fleet$', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ devices: [] }) })
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.getByText(/0 registered terminal/i)).toBeVisible()
  })
})
