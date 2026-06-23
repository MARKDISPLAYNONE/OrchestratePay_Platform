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
import OnboardingPage from '../page'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/lib/api', () => ({
  auth: {
    merchantRegister: jest.fn(),
  },
}))

const mockMerchantRegister = jest.requireMock('@/lib/api').auth.merchantRegister as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockPush.mockClear()
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
      expect(mockPush).toHaveBeenCalledWith('/auth/login?registered=1&kyc=1')
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
    expect(mockPush).not.toHaveBeenCalled()
  })
})
