/**
 * Tests for the merchant onboarding / registration page.
 *
 * The page is a 3-step wizard:
 *   Step 1: Account details (name, email, phone, password) — button "Continue"
 *   Step 2: Business information (KRA PIN, M-Pesa shortcode, etc.) — button "Continue"
 *   Step 3: Beneficial ownership — button "Create account"
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OnboardingPage from '@/pages/merchant/OnboardingPage'

const mockNavigate = jest.fn()

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

jest.mock('@/lib/api', () => ({
  auth: {
    merchantRegister: jest.fn(),
  },
}))

const mockMerchantRegister = jest.requireMock('@/lib/api').auth.merchantRegister as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockNavigate.mockClear()
})

// ─── Step 1 form rendering ────────────────────────────────────────────────────

describe('OnboardingPage step 1 fields', () => {
  it('renders the step 1 heading', () => {
    render(<OnboardingPage />)
    expect(screen.getByText(/account details/i)).toBeInTheDocument()
  })

  it('renders the Business name field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText(/wanjiku groceries/i)).toBeInTheDocument()
  })

  it('renders the Email address field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText('you@business.co.ke')).toBeInTheDocument()
  })

  it('renders the Phone number field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText('254712345678')).toBeInTheDocument()
  })

  it('renders the Password field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText(/minimum 8 characters/i)).toBeInTheDocument()
  })

  it('renders the Continue button on step 1', () => {
    render(<OnboardingPage />)
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument()
  })
})

// ─── Step 2 (after navigating past step 1) ───────────────────────────────────

async function advanceToStep2() {
  render(<OnboardingPage />)
  await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
  await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
  await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
  await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
  await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
}

describe('OnboardingPage step 2 fields', () => {
  it('shows the KRA PIN field on step 2', async () => {
    await advanceToStep2()
    expect(screen.getByPlaceholderText('P051234567X')).toBeInTheDocument()
  })

  it('shows the M-Pesa shortcode field on step 2', async () => {
    await advanceToStep2()
    expect(screen.getByPlaceholderText('174379')).toBeInTheDocument()
  })
})

// ─── Step 1 validation ────────────────────────────────────────────────────────

describe('OnboardingPage step 1 validation', () => {
  it('shows an error when name is empty on Continue', async () => {
    render(<OnboardingPage />)
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    expect(screen.getByText(/business name is required/i)).toBeInTheDocument()
    expect(mockMerchantRegister).not.toHaveBeenCalled()
  })

  it('shows an error when email is empty on Continue', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    expect(screen.getByText(/email is required/i)).toBeInTheDocument()
    expect(mockMerchantRegister).not.toHaveBeenCalled()
  })

  it('shows an error when phone is empty on Continue', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    expect(screen.getByText(/phone number is required/i)).toBeInTheDocument()
    expect(mockMerchantRegister).not.toHaveBeenCalled()
  })

  it('shows an error when password is too short on Continue', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument()
    expect(mockMerchantRegister).not.toHaveBeenCalled()
  })
})

// ─── Successful submission ────────────────────────────────────────────────────

describe('OnboardingPage successful submission', () => {
  beforeEach(() => {
    mockMerchantRegister.mockResolvedValue({ merchantId: 'mid-new', status: 'pending' })
  })

  async function fillAndReachStep3() {
    render(<OnboardingPage />)
    // Step 1
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    // Step 2: select business type and continue
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SOLE_TRADER')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
  }

  it('calls merchantRegister with required fields on step 3 submit', async () => {
    await fillAndReachStep3()
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(mockMerchantRegister).toHaveBeenCalledWith(expect.objectContaining({
        name:     'Test Shop',
        email:    'test@example.com',
        phone:    '254712345678',
        password: 'Password123',
      }))
    )
  })

  it('accepts KRA PIN and M-Pesa shortcode on step 2', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.type(screen.getByPlaceholderText('P051234567X'), 'P051234567A')
    await userEvent.type(screen.getByPlaceholderText('174379'), '174379')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SOLE_TRADER')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(mockMerchantRegister).toHaveBeenCalledWith(expect.objectContaining({
        kraPin: 'P051234567A',
        mpesaShortcode: '174379',
      }))
    )
  })

  it('redirects to /auth/login after successful registration', async () => {
    await fillAndReachStep3()
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/auth/login?registered=1&kyc=1')
    )
  })

  it('includes beneficialOwner and expectedMonthlyVolumeCents when filled on step 3', async () => {
    await fillAndReachStep3()
    await userEvent.type(screen.getByPlaceholderText(/John Kamau Mwangi/i), 'Jane Doe')
    await userEvent.type(screen.getByPlaceholderText(/^12345678$/), '98765432')
    await userEvent.type(screen.getByPlaceholderText(/^100$/), '51')
    // Also fill vol on step 2 (need to go back) - instead fill before step 3
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(mockMerchantRegister).toHaveBeenCalledWith(expect.objectContaining({
        beneficialOwnerName: 'Jane Doe',
        beneficialOwnerIdNumber: '98765432',
        beneficialOwnerOwnershipPct: 51,
      }))
    )
  })

  it('includes expectedMonthlyVolumeCents when vol is filled on step 2', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SOLE_TRADER')
    await userEvent.type(screen.getByPlaceholderText(/200000/i), '50000')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(mockMerchantRegister).toHaveBeenCalledWith(expect.objectContaining({
        expectedMonthlyVolumeCents: 5_000_000,
      }))
    )
  })

  it('shows "Creating account…" while the request is in-flight', async () => {
    mockMerchantRegister.mockReturnValue(new Promise(() => {}))
    await fillAndReachStep3()
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled()
  })
})

// ─── API error ────────────────────────────────────────────────────────────────

describe('OnboardingPage API error', () => {
  it('shows the API error message when registration fails', async () => {
    mockMerchantRegister.mockRejectedValue(new Error('Email already in use'))
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SOLE_TRADER')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(screen.getByText(/email already in use/i)).toBeInTheDocument()
    )
  })

  it('does not redirect on failure', async () => {
    mockMerchantRegister.mockRejectedValue(new Error('Server error'))
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SOLE_TRADER')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() => screen.getByText(/server error/i))
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

// ─── Back button ──────────────────────────────────────────────────────────────

describe('OnboardingPage back button', () => {
  it('shows "Business type is required" when step 2 Continue clicked without bizType', async () => {
    render(<OnboardingPage />)
    // Fill step 1 and advance
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Biz')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@test.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712000000')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    // Now on step 2 - click Continue without selecting bizType
    await waitFor(() => screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() =>
      expect(screen.getByText(/business type is required/i)).toBeInTheDocument()
    )
  })

  it('navigates back to step 1 when Back is clicked on step 2', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => screen.getByRole('button', { name: /^back$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    await waitFor(() =>
      expect(screen.getByText(/account details/i)).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()
  })
})

// ─── Uncovered branch: ownerIdNo empty + ownerPct empty ──────────────────────

describe('OnboardingPage — ownerName without idNo/pct (lines 64-67 branches)', () => {
  beforeEach(() => {
    mockMerchantRegister.mockResolvedValue({ merchantId: 'mid-new', status: 'pending' })
  })

  it('sends beneficialOwnerIdNumber: undefined and omits pct when those fields are empty', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SOLE_TRADER')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    // Only fill ownerName — leave ownerIdNo and ownerPct empty
    await userEvent.type(screen.getByPlaceholderText(/John Kamau Mwangi/i), 'Jane Doe')
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(mockMerchantRegister).toHaveBeenCalledWith(expect.objectContaining({
        beneficialOwnerName:     'Jane Doe',
        beneficialOwnerIdNumber: undefined,
      }))
    )
    // beneficialOwnerOwnershipPct should NOT be in the call (p = NaN → !isNaN false)
    const call = mockMerchantRegister.mock.calls[0][0]
    expect(call).not.toHaveProperty('beneficialOwnerOwnershipPct')
  })
})

// ─── Uncovered branch: error without .message ─────────────────────────────────

describe('OnboardingPage — API error without message property (line 67)', () => {
  it('shows fallback "Registration failed" when thrown error has no message', async () => {
    mockMerchantRegister.mockRejectedValue({ name: 'TypeError' }) // no .message property
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SOLE_TRADER')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(screen.getByText(/registration failed/i)).toBeInTheDocument()
    )
  })
})
// ─── Address + nature fields on step 2 (line 61 || undefined TRUE branches) ──

describe('OnboardingPage — step 2 address and nature fields', () => {
  it('sends addr1, city, nature to register when filled on step 2', async () => {
    mockMerchantRegister.mockResolvedValue({ success: true })
    render(<OnboardingPage />)
    // Step 1
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText('you@business.co.ke'), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    // Step 2
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SOLE_TRADER')
    await userEvent.type(screen.getByPlaceholderText(/shop 4.*kimathi/i), '4 Kimathi Street')
    await userEvent.type(screen.getByPlaceholderText(/nairobi/i), 'Nairobi')
    await userEvent.type(screen.getByPlaceholderText(/retail grocery/i), 'Coffee shop')
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    // Step 3 — submit
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() =>
      expect(mockMerchantRegister).toHaveBeenCalledWith(expect.objectContaining({
        businessAddressLine1: '4 Kimathi Street',
        businessAddressCity:  'Nairobi',
        natureOfBusiness:     'Coffee shop',
      }))
    )
  })
})
