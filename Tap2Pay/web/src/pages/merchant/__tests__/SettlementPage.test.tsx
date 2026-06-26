/**
 * Tests for src/pages/merchant/SettlementPage.tsx
 *
 * Covers: loading, empty history, settlement list, MPESA/BANK account forms,
 * save account success/error, pagination, current account display.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettlementPage from '@/pages/merchant/SettlementPage'

jest.mock('@/lib/api', () => ({
  settlement: {
    list:       jest.fn(),
    getAccount: jest.fn(),
    setAccount: jest.fn(),
  },
}))

jest.mock('@/components/ui/Badge',      () => ({ __esModule: true, default: ({ label }: any) => <span>{label}</span> }))
jest.mock('@/components/ui/PageHeader', () => ({ __esModule: true, default: ({ title }: any) => <h1>{title}</h1> }))
jest.mock('@/components/ui/GlassCard', () => ({
  __esModule: true,
  default: ({ children, className }: any) => <div className={className}>{children}</div>,
}))

const mockList       = jest.requireMock('@/lib/api').settlement.list       as jest.Mock
const mockGetAccount = jest.requireMock('@/lib/api').settlement.getAccount as jest.Mock
const mockSetAccount = jest.requireMock('@/lib/api').settlement.setAccount as jest.Mock

const settlement1 = {
  id:              's-001',
  periodStart:     '2024-05-01T00:00:00Z',
  periodEnd:       '2024-05-07T23:59:59Z',
  grossAmountCents: 500_000,
  feeCents:         15_000,
  netAmountCents:   485_000,
  transactionCount: 20,
  status:          'COMPLETED',
  payoutMethod:    'MPESA',
  settledAt:       '2024-05-08T08:00:00Z',
  createdAt:       '2024-05-08T07:00:00Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAccount.mockRejectedValue(new Error('no account'))
})

describe('SettlementPage — heading', () => {
  it('renders the Settlement heading', async () => {
    mockList.mockResolvedValue({ settlements: [], total: 0 })
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText('Settlement')).toBeInTheDocument()
    )
  })
})

describe('SettlementPage — loading', () => {
  it('shows loading indicator while fetching', () => {
    mockList.mockReturnValue(new Promise(() => {}))
    render(<SettlementPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

describe('SettlementPage — load error', () => {
  it('shows error when list fetch rejects', async () => {
    mockList.mockRejectedValue(new Error('Server error'))
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText(/server error/i)).toBeInTheDocument()
    )
  })
})

describe('SettlementPage — empty history', () => {
  it('shows "No settlements yet" when list is empty', async () => {
    mockList.mockResolvedValue({ settlements: [], total: 0 })
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText(/no settlements yet/i)).toBeInTheDocument()
    )
  })
})

describe('SettlementPage — settlement list', () => {
  beforeEach(() => {
    mockList.mockResolvedValue({ settlements: [settlement1], total: 1 })
  })

  it('renders the COMPLETED badge', async () => {
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText('COMPLETED')).toBeInTheDocument()
    )
  })

  it('renders gross amount formatted', async () => {
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText(/5,000\.00/)).toBeInTheDocument()
    )
  })

  it('renders transaction count', async () => {
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText('20')).toBeInTheDocument()
    )
  })

  it('uses default badge variant for unknown settlement status', async () => {
    mockList.mockResolvedValue({ settlements: [{ ...settlement1, status: 'UNKNOWN_STATUS' }], total: 1 })
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText('UNKNOWN_STATUS')).toBeInTheDocument()
    )
  })
})

describe('SettlementPage — account with null optional fields', () => {
  it('pre-fills empty strings when account fields are null', async () => {
    mockGetAccount.mockResolvedValue({ accountType: 'BANK', bankName: null, accountNumber: null, accountName: null, mpesaPhone: null })
    mockList.mockResolvedValue({ settlements: [], total: 0 })
    render(<SettlementPage />)
    await waitFor(() => {
      const inputs = document.querySelectorAll('input')
      inputs.forEach(input => expect(input.value).toBe(''))
    })
  })
})

describe('SettlementPage — existing account displayed', () => {
  it('shows current MPESA account', async () => {
    mockGetAccount.mockResolvedValue({ accountType: 'MPESA', mpesaPhone: '254712345678' })
    mockList.mockResolvedValue({ settlements: [], total: 0 })
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText(/M-Pesa 254712345678/)).toBeInTheDocument()
    )
  })

  it('shows current BANK account', async () => {
    mockGetAccount.mockResolvedValue({ accountType: 'BANK', bankName: 'Equity Bank', accountNumber: '1234567890' })
    mockList.mockResolvedValue({ settlements: [], total: 0 })
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText(/Equity Bank — 1234567890/)).toBeInTheDocument()
    )
  })
})

describe('SettlementPage — MPESA account form', () => {
  beforeEach(() => {
    mockList.mockResolvedValue({ settlements: [], total: 0 })
  })

  it('shows phone input for MPESA type by default', async () => {
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/07XXXXXXXX/)).toBeInTheDocument()
    )
  })

  it('saves MPESA account and shows success', async () => {
    mockSetAccount.mockResolvedValue({})
    render(<SettlementPage />)
    await waitFor(() => screen.getByPlaceholderText(/07XXXXXXXX/))
    await userEvent.type(screen.getByPlaceholderText(/07XXXXXXXX/), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /save payout account/i }))
    await waitFor(() =>
      expect(screen.getByText(/settlement account saved successfully/i)).toBeInTheDocument()
    )
  })

  it('shows error when save fails', async () => {
    mockSetAccount.mockRejectedValue(new Error('Invalid phone'))
    render(<SettlementPage />)
    await waitFor(() => screen.getByPlaceholderText(/07XXXXXXXX/))
    await userEvent.type(screen.getByPlaceholderText(/07XXXXXXXX/), 'bad')
    await userEvent.click(screen.getByRole('button', { name: /save payout account/i }))
    await waitFor(() =>
      expect(screen.getByText(/invalid phone/i)).toBeInTheDocument()
    )
  })
})

describe('SettlementPage — BANK account form', () => {
  beforeEach(() => {
    mockList.mockResolvedValue({ settlements: [], total: 0 })
  })

  it('shows bank fields when BANK type is selected', async () => {
    render(<SettlementPage />)
    await waitFor(() => screen.getByRole('combobox'))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'BANK')
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/equity bank/i)).toBeInTheDocument()
    )
  })

  it('accepts typing in bank name, account number, and account name fields', async () => {
    render(<SettlementPage />)
    await waitFor(() => screen.getByRole('combobox'))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'BANK')
    await waitFor(() => screen.getByPlaceholderText(/equity bank/i))
    await userEvent.type(screen.getByPlaceholderText(/equity bank/i), 'Equity Bank')
    expect(screen.getByDisplayValue('Equity Bank')).toBeInTheDocument()
    const textboxes = screen.getAllByRole('textbox')
    await userEvent.type(textboxes[1], '1234567890')
    await userEvent.type(textboxes[2], 'John Doe')
    expect(screen.getByDisplayValue('1234567890')).toBeInTheDocument()
  })

  it('saves BANK account and shows success (covers line 46 BANK ternary TRUE branches)', async () => {
    mockSetAccount.mockResolvedValue({})
    render(<SettlementPage />)
    await waitFor(() => screen.getByRole('combobox'))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'BANK')
    await waitFor(() => screen.getByPlaceholderText(/equity bank/i))
    await userEvent.type(screen.getByPlaceholderText(/equity bank/i), 'Equity Bank')
    const textboxes = screen.getAllByRole('textbox')
    await userEvent.type(textboxes[1], '1234567890')
    await userEvent.type(textboxes[2], 'John Doe')
    await userEvent.click(screen.getByRole('button', { name: /save payout account/i }))
    await waitFor(() =>
      expect(mockSetAccount).toHaveBeenCalledWith(expect.objectContaining({
        accountType: 'BANK',
        bankName: 'Equity Bank',
        accountNumber: '1234567890',
        accountName: 'John Doe',
        mpesaPhone: undefined,
      }))
    )
  })
})

describe('SettlementPage — pagination', () => {
  it('does not show pagination when total <= 10', async () => {
    mockList.mockResolvedValue({ settlements: [settlement1], total: 1 })
    render(<SettlementPage />)
    await waitFor(() => screen.getByText('COMPLETED'))
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
  })

  it('shows pagination when total > 10', async () => {
    const settlements = Array.from({ length: 10 }, (_, i) => ({ ...settlement1, id: `s-${i}` }))
    mockList.mockResolvedValue({ settlements, total: 25 })
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument()
    )
  })

  it('Previous is disabled on page 1', async () => {
    const settlements = Array.from({ length: 10 }, (_, i) => ({ ...settlement1, id: `s-${i}` }))
    mockList.mockResolvedValue({ settlements, total: 25 })
    render(<SettlementPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    })
  })

  it('navigates to next page', async () => {
    const settlements = Array.from({ length: 10 }, (_, i) => ({ ...settlement1, id: `s-${i}` }))
    mockList.mockResolvedValue({ settlements, total: 25 })
    render(<SettlementPage />)
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(2, 10)
    )
  })

  it('handles missing settlements and total keys in list response', async () => {
    mockList.mockResolvedValue({})
    render(<SettlementPage />)
    await waitFor(() =>
      expect(screen.getByText(/no settlements yet/i)).toBeInTheDocument()
    )
  })

  it('enables and clicks Previous after advancing to page 2', async () => {
    const settlements = Array.from({ length: 10 }, (_, i) => ({ ...settlement1, id: `s-${i}` }))
    mockList.mockResolvedValue({ settlements, total: 25 })
    render(<SettlementPage />)
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      const prevBtn = screen.getByRole('button', { name: /previous/i })
      expect(prevBtn).not.toBeDisabled()
    })
    await userEvent.click(screen.getByRole('button', { name: /previous/i }))
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(1, 10)
    )
  })
})
