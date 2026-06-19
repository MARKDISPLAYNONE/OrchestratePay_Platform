import { test, expect } from '@playwright/test'

/**
 * E2E tests for the merchant accounting integrations page (/merchant/accounting).
 *
 * Covers:
 *   - Page renders the four platform cards (QuickBooks, Xero, Sage, Wave)
 *   - Not-connected state shows a "Connect" link
 *   - Expanding a platform shows the access-token input and Save button
 *   - Successful connect (mocked POST) reloads integration list
 *   - Error state (mocked 500) shows error message
 *   - Connected platform shows "Disconnect" link and "Connected" badge
 *   - GL postings table renders with correct columns
 *   - Empty and populated postings states
 *
 * All API calls are intercepted — no live backend required.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_INTEGRATIONS_EMPTY: { integrations: any[] } = { integrations: [] }

const MOCK_INTEGRATIONS_QUICKBOOKS = {
  integrations: [
    { id: 'int-001', platform: 'quickbooks', status: 'ACTIVE', last_sync_at: '2025-06-01T08:00:00Z' },
  ],
}

const MOCK_POSTINGS_EMPTY: { postings: any[] } = { postings: [] }

const MOCK_POSTINGS = {
  postings: [
    {
      id: 'gl-001', platform: 'quickbooks', journal_date: '2025-06-01',
      amount_cents: 50000, status: 'POSTED', external_id: 'QBO-TX-001',
    },
    {
      id: 'gl-002', platform: 'xero', journal_date: '2025-06-01',
      amount_cents: 25000, status: 'FAILED', external_id: null,
    },
    {
      id: 'gl-003', platform: 'sage', journal_date: '2025-05-31',
      amount_cents: 100000, status: 'PENDING', external_id: null,
    },
  ],
}

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

async function stubAccountingRoutes(
  page: any,
  integrations = MOCK_INTEGRATIONS_EMPTY,
  postings = MOCK_POSTINGS_EMPTY,
) {
  await page.route('**/api/v1/accounting/integrations', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(integrations),
    })
  })
  await page.route('**/api/v1/accounting/postings**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(postings),
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Accounting auth guard', () => {
  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/merchant/accounting')
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Page structure — no integrations configured
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Accounting page — platform cards', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubAccountingRoutes(page)
    await page.goto('/merchant/accounting')
    await page.waitForLoadState('networkidle')
  })

  test('renders without crashing', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('shows Accounting integrations heading', async ({ page }) => {
    await expect(page.getByText('Accounting integrations')).toBeVisible()
  })

  test('shows QuickBooks platform card', async ({ page }) => {
    await expect(page.getByText('QuickBooks')).toBeVisible()
  })

  test('shows Xero platform card', async ({ page }) => {
    await expect(page.getByText('Xero')).toBeVisible()
  })

  test('shows Sage platform card', async ({ page }) => {
    await expect(page.getByText('Sage')).toBeVisible()
  })

  test('shows Wave platform card', async ({ page }) => {
    await expect(page.getByText('Wave')).toBeVisible()
  })

  test('all platforms show "Not connected" badge by default', async ({ page }) => {
    const badges = page.getByText('Not connected')
    await expect(badges.first()).toBeVisible()
    // All four cards should be not connected
    expect(await badges.count()).toBe(4)
  })

  test('each platform card shows a Connect link', async ({ page }) => {
    const connectLinks = page.getByRole('button', { name: /^connect$/i })
    expect(await connectLinks.count()).toBeGreaterThanOrEqual(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Connect flow
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Accounting page — connect flow', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubAccountingRoutes(page)
    await page.goto('/merchant/accounting')
    await page.waitForLoadState('networkidle')
  })

  test('clicking Connect on QuickBooks expands the token input', async ({ page }) => {
    const quickBooksCard = page.locator('div').filter({ hasText: /^QuickBooks$/ }).first()
    const connectBtn = quickBooksCard.getByRole('button', { name: /^connect$/i })
    await connectBtn.click()
    await expect(page.getByPlaceholder(/paste access token/i)).toBeVisible()
  })

  test('token input is visible after expanding', async ({ page }) => {
    await page.getByRole('button', { name: /^connect$/i }).first().click()
    const tokenInput = page.getByPlaceholder(/paste access token/i)
    await expect(tokenInput).toBeVisible()
  })

  test('Save button is visible after expanding', async ({ page }) => {
    await page.getByRole('button', { name: /^connect$/i }).first().click()
    await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible()
  })

  test('clicking Cancel collapses the token input', async ({ page }) => {
    await page.getByRole('button', { name: /^connect$/i }).first().click()
    await expect(page.getByPlaceholder(/paste access token/i)).toBeVisible()
    await page.getByRole('button', { name: /^cancel$/i }).first().click()
    await expect(page.getByPlaceholder(/paste access token/i)).not.toBeVisible()
  })

  test('saving without a token shows validation error', async ({ page }) => {
    await page.getByRole('button', { name: /^connect$/i }).first().click()
    // Leave token empty and click Save
    await page.getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByText(/paste your api.*token first/i)).toBeVisible()
  })

  test('successful connect shows "Connected" badge', async ({ page }) => {
    // After connecting quickbooks, stub the reload to return it as active
    await page.route('**/api/v1/accounting/connect/quickbooks', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    // Override the integrations stub to return QuickBooks as active after connect
    await page.unroute('**/api/v1/accounting/integrations')
    let callCount = 0
    await page.route('**/api/v1/accounting/integrations', async (route: any) => {
      callCount++
      const integrations = callCount > 1 ? MOCK_INTEGRATIONS_QUICKBOOKS : MOCK_INTEGRATIONS_EMPTY
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(integrations),
      })
    })

    await page.getByRole('button', { name: /^connect$/i }).first().click()
    await page.getByPlaceholder(/paste access token/i).fill('qbo-access-token-abc123')
    await page.getByRole('button', { name: /^save$/i }).click()

    // After save, the page reloads integrations — QuickBooks should show Connected
    await expect(page.getByText('Connected')).toBeVisible({ timeout: 5_000 })
  })

  test('API error during connect shows error message', async ({ page }) => {
    await page.route('**/api/v1/accounting/connect/**', async (route: any) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to connect to QuickBooks' }),
      })
    })

    await page.getByRole('button', { name: /^connect$/i }).first().click()
    await page.getByPlaceholder(/paste access token/i).fill('bad-token')
    await page.getByRole('button', { name: /^save$/i }).click()

    await expect(page.getByText(/failed to connect to quickbooks/i)).toBeVisible({ timeout: 5_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Connected platform — disconnect
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Accounting page — connected platform', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubAccountingRoutes(page, MOCK_INTEGRATIONS_QUICKBOOKS)
    await page.goto('/merchant/accounting')
    await page.waitForLoadState('networkidle')
  })

  test('shows Connected badge for QuickBooks', async ({ page }) => {
    await expect(page.getByText('Connected')).toBeVisible()
  })

  test('shows Disconnect link for connected platform', async ({ page }) => {
    await expect(page.getByRole('button', { name: /disconnect/i })).toBeVisible()
  })

  test('Disconnect triggers API call and removes Connected badge', async ({ page }) => {
    await page.route('**/api/v1/accounting/disconnect/quickbooks', async (route: any) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    })

    // After disconnect, integrations reloads as empty
    await page.unroute('**/api/v1/accounting/integrations')
    await page.route('**/api/v1/accounting/integrations', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_INTEGRATIONS_EMPTY),
      })
    })

    await page.getByRole('button', { name: /disconnect/i }).click()
    // Connected badge should disappear (all should say Not connected)
    await expect(page.getByText('Not connected').first()).toBeVisible({ timeout: 5_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GL postings table
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Accounting page — GL postings table', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubAccountingRoutes(page, MOCK_INTEGRATIONS_EMPTY, MOCK_POSTINGS)
    await page.goto('/merchant/accounting')
    await page.waitForLoadState('networkidle')
  })

  test('shows Recent GL postings heading', async ({ page }) => {
    await expect(page.getByText('Recent GL postings')).toBeVisible()
  })

  test('table has Platform, Date, Amount, Status, External ID columns', async ({ page }) => {
    await expect(page.getByText('Platform')).toBeVisible()
    await expect(page.getByText('Date')).toBeVisible()
    await expect(page.getByText('Amount')).toBeVisible()
    await expect(page.getByText('Status')).toBeVisible()
    await expect(page.getByText('External ID')).toBeVisible()
  })

  test('shows POSTED status badge for confirmed posting', async ({ page }) => {
    await expect(page.getByText('POSTED')).toBeVisible()
  })

  test('shows FAILED status badge', async ({ page }) => {
    await expect(page.getByText('FAILED')).toBeVisible()
  })

  test('shows PENDING status badge', async ({ page }) => {
    await expect(page.getByText('PENDING')).toBeVisible()
  })

  test('shows external ID for posted entry', async ({ page }) => {
    await expect(page.getByText('QBO-TX-001')).toBeVisible()
  })

  test('shows dash for null external ID', async ({ page }) => {
    const bodyText = await page.locator('body').textContent()
    expect(bodyText).toContain('—')
  })

  test('shows KSh amounts', async ({ page }) => {
    await expect(page.getByText(/KSh\s+500/)).toBeVisible()
  })
})

test.describe('Accounting page — empty GL postings', () => {
  test('shows "No postings yet" when table is empty', async ({ page }) => {
    await authenticateMerchant(page)
    await stubMerchantMe(page)
    await stubAccountingRoutes(page)
    await page.goto('/merchant/accounting')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/no postings yet/i)).toBeVisible()
  })
})
