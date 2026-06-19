import { test, expect } from '@playwright/test'

/**
 * E2E tests for the merchant transactions pages.
 *
 * Covers:
 *   - /merchant/transactions  — list page (table, pagination, empty/error states)
 *   - /merchant/transactions/:id — detail/receipt page
 *
 * All backend calls are intercepted with page.route() so no live server is needed.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_TRANSACTIONS = [
  {
    id: 'txn-001',
    amount_cents: 50000,
    status: 'CONFIRMED',
    mpesa_receipt: 'QBC12XY789',
    source: 'NFC_TAG',
    created_at: '2025-06-01T10:00:00Z',
  },
  {
    id: 'txn-002',
    amount_cents: 25000,
    status: 'DECLINED',
    mpesa_receipt: null,
    source: 'QR_CODE',
    created_at: '2025-06-01T09:30:00Z',
  },
  {
    id: 'txn-003',
    amount_cents: 150000,
    status: 'PENDING',
    mpesa_receipt: null,
    source: 'HCE_PHONE',
    created_at: '2025-06-01T11:15:00Z',
  },
  {
    id: 'txn-004',
    amount_cents: 75000,
    status: 'FAILED',
    mpesa_receipt: null,
    source: 'NFC_TAG',
    created_at: '2025-05-31T18:45:00Z',
  },
]

const MOCK_TXN_DETAIL = {
  txnId: 'txn-001',
  amountCents: 50000,
  status: 'CONFIRMED',
  mpesaRef: 'QBC12XY789',
  consumerPhone: '2547****78',
  merchantName: 'Test Merchant',
  source: 'NFC_TAG',
  reason: null,
  createdAt: '2025-06-01T10:00:00Z',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function authenticateMerchant(page: any) {
  await page.goto('/auth/login')
  await page.evaluate(() => localStorage.setItem('token', 'test-merchant-token'))
}

async function stubCommonRoutes(page: any) {
  await page.route('**/api/v1/merchants/me', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'mid-001', name: 'Test Merchant', status: 'APPROVED' }),
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Transactions auth guard', () => {
  test('unauthenticated access to transactions redirects to login', async ({ page }) => {
    await page.goto('/merchant/transactions')
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  test('unauthenticated access to transaction detail redirects to login', async ({ page }) => {
    await page.goto('/merchant/transactions/txn-001')
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Transactions list page
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Transactions list', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubCommonRoutes(page)

    await page.route('**/api/v1/merchants/transactions**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transactions: MOCK_TRANSACTIONS, total: MOCK_TRANSACTIONS.length }),
      })
    })

    await page.goto('/merchant/transactions')
    await page.waitForLoadState('networkidle')
  })

  test('renders without crashing', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('shows Transactions heading', async ({ page }) => {
    await expect(page.getByText('Transactions')).toBeVisible()
  })

  test('table has Time, Amount, Status, Source and M-Pesa Ref columns', async ({ page }) => {
    await expect(page.getByText('Time')).toBeVisible()
    await expect(page.getByText('Amount')).toBeVisible()
    await expect(page.getByText('Status')).toBeVisible()
    await expect(page.getByText('Source')).toBeVisible()
    await expect(page.getByText('M-Pesa Ref')).toBeVisible()
  })

  test('displays confirmed transaction receipt number', async ({ page }) => {
    await expect(page.getByText('QBC12XY789')).toBeVisible()
  })

  test('displays CONFIRMED status badge', async ({ page }) => {
    await expect(page.getByText('CONFIRMED')).toBeVisible()
  })

  test('displays DECLINED status badge', async ({ page }) => {
    await expect(page.getByText('DECLINED')).toBeVisible()
  })

  test('displays PENDING status badge', async ({ page }) => {
    await expect(page.getByText('PENDING')).toBeVisible()
  })

  test('displays FAILED status badge', async ({ page }) => {
    await expect(page.getByText('FAILED')).toBeVisible()
  })

  test('displays amounts in KSh format', async ({ page }) => {
    // 50 000 cents = KSh 500
    await expect(page.getByText(/KSh\s+500/)).toBeVisible()
    // 25 000 cents = KSh 250
    await expect(page.getByText(/KSh\s+250/)).toBeVisible()
  })

  test('shows dash for null M-Pesa receipt', async ({ page }) => {
    // DECLINED transaction has no receipt — rendered as "—"
    const bodyText = await page.locator('body').textContent()
    expect(bodyText).toContain('—')
  })

  test('clicking a transaction row navigates to detail page', async ({ page }) => {
    // Stub the detail endpoint before clicking
    await page.route('**/api/v1/merchants/transactions/txn-001', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TXN_DETAIL),
      })
    })

    const firstRow = page.locator('tbody tr').first()
    await firstRow.click()
    await page.waitForURL(/\/merchant\/transactions\/txn-\w+/, { timeout: 5_000 })
    expect(page.url()).toMatch(/\/merchant\/transactions\//)
  })

  test('pagination controls are rendered', async ({ page }) => {
    await expect(page.getByRole('button', { name: /← previous/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /next →/i })).toBeVisible()
  })

  test('Previous button is disabled on first page', async ({ page }) => {
    const prevBtn = page.getByRole('button', { name: /← previous/i })
    await expect(prevBtn).toBeDisabled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Transactions list — empty and error states
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Transactions list — edge states', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubCommonRoutes(page)
  })

  test('empty state shows "No transactions yet"', async ({ page }) => {
    await page.route('**/api/v1/merchants/transactions**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transactions: [], total: 0 }),
      })
    })
    await page.goto('/merchant/transactions')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/no transactions yet/i)).toBeVisible()
  })

  test('API error message is displayed', async ({ page }) => {
    await page.route('**/api/v1/merchants/transactions**', async (route: any) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      })
    })
    await page.goto('/merchant/transactions')
    await page.waitForLoadState('networkidle')
    // The page shows the error message from the API response
    await expect(page.getByText(/internal server error/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Transaction detail / receipt page
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Transaction detail page', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubCommonRoutes(page)

    await page.route('**/api/v1/merchants/transactions/txn-001', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TXN_DETAIL),
      })
    })

    await page.goto('/merchant/transactions/txn-001')
    await page.waitForLoadState('networkidle')
  })

  test('renders receipt without crashing', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Application error')
  })

  test('shows merchant name in receipt header', async ({ page }) => {
    await expect(page.getByText('Test Merchant')).toBeVisible()
  })

  test('shows OrchestratePay Receipt label', async ({ page }) => {
    await expect(page.getByText(/orchestratepay receipt/i)).toBeVisible()
  })

  test('shows amount in KSh', async ({ page }) => {
    await expect(page.getByText(/KSh\s+500/)).toBeVisible()
  })

  test('shows CONFIRMED status badge', async ({ page }) => {
    await expect(page.getByText('CONFIRMED')).toBeVisible()
  })

  test('shows M-Pesa reference', async ({ page }) => {
    await expect(page.getByText('QBC12XY789')).toBeVisible()
    await expect(page.getByText(/m-pesa reference/i)).toBeVisible()
  })

  test('shows masked customer phone number', async ({ page }) => {
    await expect(page.getByText('2547****78')).toBeVisible()
  })

  test('shows transaction ID field', async ({ page }) => {
    await expect(page.getByText(/transaction id/i)).toBeVisible()
  })

  test('shows Print / Save as PDF button for confirmed transactions', async ({ page }) => {
    await expect(page.getByRole('button', { name: /print|save as pdf/i })).toBeVisible()
  })

  test('back navigation link is present', async ({ page }) => {
    await expect(page.getByText(/← back to transactions/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Transaction detail — declined transaction (no receipt, no print button)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Transaction detail — declined transaction', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateMerchant(page)
    await stubCommonRoutes(page)

    await page.route('**/api/v1/merchants/transactions/txn-002', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          txnId: 'txn-002',
          amountCents: 25000,
          status: 'DECLINED',
          mpesaRef: null,
          consumerPhone: '2547****45',
          merchantName: 'Test Merchant',
          source: 'QR_CODE',
          reason: 'Consumer cancelled',
          createdAt: '2025-06-01T09:30:00Z',
        }),
      })
    })

    await page.goto('/merchant/transactions/txn-002')
    await page.waitForLoadState('networkidle')
  })

  test('shows DECLINED status', async ({ page }) => {
    await expect(page.getByText('DECLINED')).toBeVisible()
  })

  test('shows cancellation reason', async ({ page }) => {
    await expect(page.getByText(/consumer cancelled/i)).toBeVisible()
  })

  test('does not show Print button for declined transactions', async ({ page }) => {
    const printBtn = page.getByRole('button', { name: /print|save as pdf/i })
    await expect(printBtn).not.toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Transaction detail — 404 / not found
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Transaction detail — not found', () => {
  test('shows error message when transaction is not found', async ({ page }) => {
    await authenticateMerchant(page)
    await stubCommonRoutes(page)

    await page.route('**/api/v1/merchants/transactions/txn-missing', async (route: any) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Transaction not found' }),
      })
    })

    await page.goto('/merchant/transactions/txn-missing')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/transaction not found/i)).toBeVisible()
  })
})
