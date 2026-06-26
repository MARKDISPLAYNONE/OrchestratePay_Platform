/**
 * Tests for the consumer pay page.
 *
 * Covers: form rendering, amount conversion (KSh → cents),
 * successful payment flow, error display, and "make another payment" reset.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConsumerPayPage from '@/pages/consumer/PayPage'

jest.mock('@/lib/api', () => ({
  consumers: {
    requestPayment: jest.fn(),
  },
}))

const mockRequestPayment = jest.requireMock('@/lib/api').consumers.requestPayment as jest.Mock

// crypto.randomUUID is used for idempotency key generation
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: jest.fn().mockReturnValue('550e8400-e29b-41d4-a716-446655440000'),
  },
})

beforeEach(() => jest.clearAllMocks())

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('ConsumerPayPage rendering', () => {
  it('renders the Pay heading', () => {
    render(<ConsumerPayPage />)
    expect(screen.getByRole('heading', { name: /^pay$/i })).toBeInTheDocument()
  })

  it('renders the Merchant ID input', () => {
    render(<ConsumerPayPage />)
    expect(screen.getByLabelText(/merchant id/i)).toBeInTheDocument()
  })

  it('renders the Amount input', () => {
    render(<ConsumerPayPage />)
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument()
  })

  it('renders the send payment button', () => {
    render(<ConsumerPayPage />)
    expect(screen.getByRole('button', { name: /send payment request/i })).toBeInTheDocument()
  })

  it('does not show the success screen initially', () => {
    render(<ConsumerPayPage />)
    expect(screen.queryByText(/check your phone/i)).not.toBeInTheDocument()
  })
})

// ─── Successful payment ───────────────────────────────────────────────────────

describe('ConsumerPayPage successful payment', () => {
  async function fillAndPay(merchantId = 'mid-abc', amount = '100') {
    render(<ConsumerPayPage />)
    await userEvent.type(screen.getByLabelText(/merchant id/i), merchantId)
    await userEvent.type(screen.getByLabelText(/amount/i), amount)
    await userEvent.click(screen.getByRole('button', { name: /send payment request/i }))
  }

  it('calls requestPayment with the correct merchantId', async () => {
    mockRequestPayment.mockResolvedValue({ transactionId: 'txn-1', status: 'STK_SENT' })
    await fillAndPay('merchant-xyz', '50')
    await waitFor(() =>
      expect(mockRequestPayment).toHaveBeenCalledWith(
        'merchant-xyz',
        expect.any(Object)
      )
    )
  })

  it('converts KSh amount to cents correctly (100 KSh = 10000 cents)', async () => {
    mockRequestPayment.mockResolvedValue({ transactionId: 'txn-1', status: 'STK_SENT' })
    await fillAndPay('mid-1', '100')
    await waitFor(() => {
      const call = mockRequestPayment.mock.calls[0][1]
      expect(call.amountCents).toBe(10_000)
    })
  })

  it('converts fractional amount correctly (1.50 KSh = 150 cents)', async () => {
    mockRequestPayment.mockResolvedValue({ transactionId: 'txn-1', status: 'STK_SENT' })
    await fillAndPay('mid-1', '1.50')
    await waitFor(() => {
      const call = mockRequestPayment.mock.calls[0][1]
      expect(call.amountCents).toBe(150)
    })
  })

  it('includes a 32-char idempotency key in the request', async () => {
    mockRequestPayment.mockResolvedValue({ transactionId: 'txn-1', status: 'STK_SENT' })
    await fillAndPay('mid-1', '50')
    await waitFor(() => {
      const call = mockRequestPayment.mock.calls[0][1]
      expect(call.idempotencyKey).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  it('shows the "check your phone" success screen after payment', async () => {
    mockRequestPayment.mockResolvedValue({ transactionId: 'txn-1', status: 'STK_SENT' })
    await fillAndPay()
    await waitFor(() =>
      expect(screen.getByText(/check your phone/i)).toBeInTheDocument()
    )
  })

  it('shows the M-Pesa PIN prompt message', async () => {
    mockRequestPayment.mockResolvedValue({ transactionId: 'txn-1', status: 'STK_SENT' })
    await fillAndPay()
    await waitFor(() =>
      expect(screen.getByText(/enter your pin/i)).toBeInTheDocument()
    )
  })

  it('shows "Make another payment" button after success', async () => {
    mockRequestPayment.mockResolvedValue({ transactionId: 'txn-1', status: 'STK_SENT' })
    await fillAndPay()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /make another payment/i })).toBeInTheDocument()
    )
  })

  it('resets form when "Make another payment" is clicked', async () => {
    mockRequestPayment.mockResolvedValue({ transactionId: 'txn-1', status: 'STK_SENT' })
    await fillAndPay()
    await waitFor(() => screen.getByRole('button', { name: /make another payment/i }))
    await userEvent.click(screen.getByRole('button', { name: /make another payment/i }))
    expect(screen.getByRole('heading', { name: /^pay$/i })).toBeInTheDocument()
    expect(screen.queryByText(/check your phone/i)).not.toBeInTheDocument()
  })
})

// ─── Loading state ────────────────────────────────────────────────────────────

describe('ConsumerPayPage loading state', () => {
  it('disables and shows Sending… while the request is in-flight', async () => {
    mockRequestPayment.mockReturnValue(new Promise(() => {}))
    render(<ConsumerPayPage />)
    await userEvent.type(screen.getByLabelText(/merchant id/i), 'mid-1')
    await userEvent.type(screen.getByLabelText(/amount/i), '50')
    await userEvent.click(screen.getByRole('button', { name: /send payment request/i }))
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled()
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('ConsumerPayPage error handling', () => {
  it('shows the error message when payment fails', async () => {
    mockRequestPayment.mockRejectedValue(new Error('Merchant not found'))
    render(<ConsumerPayPage />)
    await userEvent.type(screen.getByLabelText(/merchant id/i), 'bad-merchant')
    await userEvent.type(screen.getByLabelText(/amount/i), '50')
    await userEvent.click(screen.getByRole('button', { name: /send payment request/i }))
    await waitFor(() =>
      expect(screen.getByText(/merchant not found/i)).toBeInTheDocument()
    )
  })

  it('re-enables button after a failed payment', async () => {
    mockRequestPayment.mockRejectedValue(new Error('Error'))
    render(<ConsumerPayPage />)
    await userEvent.type(screen.getByLabelText(/merchant id/i), 'm')
    await userEvent.type(screen.getByLabelText(/amount/i), '10')
    await userEvent.click(screen.getByRole('button', { name: /send payment request/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send payment request/i })).not.toBeDisabled()
    )
  })

  it('does not show the success screen after a failed payment', async () => {
    mockRequestPayment.mockRejectedValue(new Error('Error'))
    render(<ConsumerPayPage />)
    await userEvent.type(screen.getByLabelText(/merchant id/i), 'm')
    await userEvent.type(screen.getByLabelText(/amount/i), '10')
    await userEvent.click(screen.getByRole('button', { name: /send payment request/i }))
    await waitFor(() => screen.getByRole('button', { name: /send payment request/i }))
    expect(screen.queryByText(/check your phone/i)).not.toBeInTheDocument()
  })

  it('shows fallback error text when rejection has no message property', async () => {
    mockRequestPayment.mockRejectedValue({})
    render(<ConsumerPayPage />)
    await userEvent.type(screen.getByLabelText(/merchant id/i), 'merch-1')
    await userEvent.type(screen.getByLabelText(/amount/i), '50')
    await userEvent.click(screen.getByRole('button', { name: /send payment request/i }))
    await waitFor(() =>
      expect(screen.getByText(/payment failed — please try again/i)).toBeInTheDocument()
    )
  })
})
