/**
 * Tests for src/pages/PayLinkPage.tsx
 *
 * Covers: loading, merchant-not-found error, auth stage (not logged in),
 * auth submit success + error, amount stage (logged in consumer),
 * amount validation, confirming state, success, failed states.
 */
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PayLinkPage from '@/pages/PayLinkPage'

Object.defineProperty(global, 'crypto', {
  value: { randomUUID: jest.fn().mockReturnValue('550e8400-e29b-41d4-a716-446655440000') },
  configurable: true,
})

const mockLink = jest.fn(({ children }: any) => children)

jest.mock('react-router-dom', () => ({
  useParams:       jest.fn(() => ({ merchantId: 'merch-abc' })),
  useSearchParams: jest.fn(() => [new URLSearchParams()]),
  Link: (props: any) => mockLink(props) || <a href={props.to}>{props.children}</a>,
}))

jest.mock('@/lib/api', () => ({
  consumers: { getMerchantForPay: jest.fn() },
  auth:      { consumerLogin: jest.fn() },
}))

jest.mock('@/lib/auth', () => ({
  getRole:   jest.fn(),
  saveToken: jest.fn(),
}))

jest.mock('@/components/ui/GlassCard', () => ({
  __esModule: true,
  default: ({ children, className }: any) => <div className={className}>{children}</div>,
}))

const mockGetMerchant   = jest.requireMock('@/lib/api').consumers.getMerchantForPay as jest.Mock
const mockConsumerLogin  = jest.requireMock('@/lib/api').auth.consumerLogin          as jest.Mock
const mockGetRole        = jest.requireMock('@/lib/auth').getRole                    as jest.Mock
const mockSaveToken      = jest.requireMock('@/lib/auth').saveToken                  as jest.Mock
const mockUseParams      = jest.requireMock('react-router-dom').useParams            as jest.Mock

const merchantData = { merchant: { id: 'merch-abc', name: 'Savannah Bistro' } }

beforeEach(() => {
  jest.clearAllMocks()
  mockGetRole.mockReturnValue(null)
})

// ── Loading ──────────────────────────────────────────────────────────────────

describe('PayLinkPage — loading', () => {
  it('shows loading indicator before merchant resolves', () => {
    mockGetMerchant.mockReturnValue(new Promise(() => {}))
    render(<PayLinkPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

// ── Error ────────────────────────────────────────────────────────────────────

describe('PayLinkPage — merchant not found', () => {
  it('shows error when getMerchantForPay rejects', async () => {
    mockGetMerchant.mockRejectedValue(new Error('not found'))
    render(<PayLinkPage />)
    await waitFor(() =>
      expect(screen.getByText(/merchant is not available/i)).toBeInTheDocument()
    )
  })
})

// ── Auth stage ───────────────────────────────────────────────────────────────

describe('PayLinkPage — auth stage (unauthenticated)', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue(null)
  })

  it('shows sign-in form for unauthenticated user', async () => {
    render(<PayLinkPage />)
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument()
    )
  })

  it('shows the merchant name', async () => {
    render(<PayLinkPage />)
    await waitFor(() =>
      expect(screen.getAllByText(/savannah bistro/i).length).toBeGreaterThanOrEqual(1)
    )
  })

  it('navigates to amount stage after successful auth', async () => {
    mockConsumerLogin.mockResolvedValue({ token: 'tok-abc' })
    render(<PayLinkPage />)
    await waitFor(() => screen.getByPlaceholderText(/email/i))
    await userEvent.type(screen.getByPlaceholderText(/email/i), 'alice@example.com')
    await userEvent.type(screen.getByPlaceholderText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() =>
      expect(screen.getByText(/pay with m-pesa/i)).toBeInTheDocument()
    )
    expect(mockSaveToken).toHaveBeenCalledWith('tok-abc', true)
  })

  it('shows error when consumerLogin fails', async () => {
    mockConsumerLogin.mockRejectedValue(new Error('Wrong credentials'))
    render(<PayLinkPage />)
    await waitFor(() => screen.getByPlaceholderText(/email/i))
    await userEvent.type(screen.getByPlaceholderText(/email/i), 'bad@email.com')
    await userEvent.type(screen.getByPlaceholderText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() =>
      expect(screen.getByText(/wrong credentials/i)).toBeInTheDocument()
    )
  })
})

// ── Amount stage ─────────────────────────────────────────────────────────────

describe('PayLinkPage — amount stage (authenticated consumer)', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')
  })

  it('shows the amount form for authenticated consumer', async () => {
    render(<PayLinkPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /pay with m-pesa/i })).toBeInTheDocument()
    )
  })

  it('shows minimum payment error for amount < 1', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    const input = screen.getByPlaceholderText('0.00')
    fireEvent.change(input, { target: { value: '0.5' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() =>
      expect(screen.getByText(/minimum payment is ksh 1/i)).toBeInTheDocument()
    )
  })

  it('shows NaN error for non-numeric amount', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    const input = screen.getByPlaceholderText('0.00')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() =>
      expect(screen.getByText(/minimum payment is ksh 1/i)).toBeInTheDocument()
    )
  })
})

// ── Confirming state ─────────────────────────────────────────────────────────

describe('PayLinkPage — confirming state', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')

    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({ txnId: 'txn-pay-001' }),
    } as Response)
  })

  it('shows "Waiting for M-Pesa PIN" in confirming state', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    const input = screen.getByPlaceholderText('0.00')
    await userEvent.clear(input)
    await userEvent.type(input, '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/waiting for m-pesa pin/i)).toBeInTheDocument()
    )
  })
})

// ── Success state ────────────────────────────────────────────────────────────

describe('PayLinkPage — payment success', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok:   true,
        json: () => Promise.resolve({ txnId: 'txn-pay-001' }),
      } as Response)
      .mockResolvedValue({
        ok:   true,
        json: () => Promise.resolve({ status: 'CONFIRMED', mpesaRef: 'REF12345' }),
      } as Response)

    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      fn()
      return 0 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
  })

  it('shows payment confirmed screen', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/payment confirmed/i)).toBeInTheDocument()
    )
  })

  it('shows M-Pesa reference on success', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/REF12345/)).toBeInTheDocument()
    )
  })
})

// ── Failed state ─────────────────────────────────────────────────────────────

describe('PayLinkPage — payment failed', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok:   true,
        json: () => Promise.resolve({ txnId: 'txn-pay-002' }),
      } as Response)
      .mockResolvedValue({
        ok:   true,
        json: () => Promise.resolve({ status: 'DECLINED', reason: 'Insufficient funds' }),
      } as Response)

    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => {
      fn()
      return 0 as any
    })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
  })

  it('shows payment not completed screen on DECLINED', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/payment not completed/i)).toBeInTheDocument()
    )
  })

  it('shows rejection reason on failed screen', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/insufficient funds/i)).toBeInTheDocument()
    )
  })

  it('shows Try again button on failed screen', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    )
  })

  it('returns to amount stage on "Try again"', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() => screen.getByRole('button', { name: /try again/i }))
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /pay with m-pesa/i })).toBeInTheDocument()
    )
  })
})

// ── Fetch error ───────────────────────────────────────────────────────────────

describe('PayLinkPage — fetch error on pay', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'))
  })

  it('shows error message when fetch rejects', async () => {
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '50')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    )
  })
})

// ── Missing merchantId (line 43 branch) ──────────────────────────────────────

describe('PayLinkPage — missing merchantId', () => {
  it('shows error screen when merchantId is undefined', async () => {
    mockUseParams.mockReturnValueOnce({ merchantId: undefined })
    render(<PayLinkPage />)
    await waitFor(() =>
      expect(screen.getByText(/merchant is not available/i)).toBeInTheDocument()
    )
  })
})

// ── Fetch response not ok (line 64 branch) ───────────────────────────────────

describe('PayLinkPage — fetch response not ok', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')
  })

  it('shows error from data.error when response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Insufficient balance' }),
    } as Response)
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/insufficient balance/i)).toBeInTheDocument()
    )
  })

  it('shows fallback "Payment failed" when response is not ok with no error field', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response)
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/payment failed/i)).toBeInTheDocument()
    )
  })
})

// ── pollStatus nullish fallbacks (lines 75-76) ────────────────────────────────

describe('PayLinkPage — pollStatus with missing optional fields', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')
  })

  it('shows success without mpesaRef when poll returns CONFIRMED with no mpesaRef', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ txnId: 'txn-x' }) } as Response)
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'CONFIRMED' }) } as Response)
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => { fn(); return 0 as any })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() =>
      expect(screen.getByText(/payment confirmed/i)).toBeInTheDocument()
    )
  })

  it('shows "Payment not completed" when poll returns DECLINED with no reason', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ txnId: 'txn-y' }) } as Response)
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'DECLINED' }) } as Response)
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => { fn(); return 0 as any })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    await waitFor(() => {
      const matches = screen.getAllByText(/payment not completed/i)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ── 3-minute timeout fires "Payment timed out" (line 79) ─────────────────────

describe('PayLinkPage — 3-minute payment timeout callback (line 79)', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')
  })

  it('shows "Payment timed out" when the 3-minute setTimeout fires', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ txnId: 'txn-timeout' }),
    } as Response)
    // Intercept setInterval so polling doesn't fire
    jest.spyOn(global, 'setInterval').mockImplementation(() => 0 as any)
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    let timeoutCb: (() => void) | undefined
    const origSetTimeout = global.setTimeout
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      if (ms === 3 * 60_000) { timeoutCb = fn; return 0 as any }
      return origSetTimeout(fn as any, ms)
    })
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    // Wait for confirming stage
    await waitFor(() => expect(timeoutCb).toBeDefined())
    spy.mockRestore()
    await act(async () => { timeoutCb?.() })
    await waitFor(() =>
      expect(screen.getByText(/payment timed out/i)).toBeInTheDocument()
    )
  })
})

// ── pollStatus PENDING — else if FALSE branch (line 76 branch 12) ─────────────

describe('PayLinkPage — pollStatus PENDING (line 76 else-if FALSE branch)', () => {
  beforeEach(() => {
    mockGetMerchant.mockResolvedValue(merchantData)
    mockGetRole.mockReturnValue('CONSUMER')
  })

  it('stays in confirming state when poll returns PENDING (neither CONFIRMED nor DECLINED)', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ txnId: 'txn-pend' }) } as Response)
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'PENDING' }) } as Response)
    jest.spyOn(global, 'setInterval').mockImplementation((fn: any) => { ;(fn as () => void)(); return 0 as any })
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {})
    // Suppress only the 3-minute timeout so waitFor polling still works
    const origSetTimeout = global.setTimeout
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      if (ms === 3 * 60_000) return 0 as any
      return origSetTimeout(fn as any, ms)
    })
    render(<PayLinkPage />)
    await waitFor(() => screen.getByRole('button', { name: /pay with m-pesa/i }))
    await userEvent.type(screen.getByPlaceholderText('0.00'), '100')
    await userEvent.click(screen.getByRole('button', { name: /pay with m-pesa/i }))
    spy.mockRestore()
    await waitFor(() =>
      expect(screen.getByText(/waiting for m-pesa pin/i)).toBeInTheDocument()
    )
  })
})
