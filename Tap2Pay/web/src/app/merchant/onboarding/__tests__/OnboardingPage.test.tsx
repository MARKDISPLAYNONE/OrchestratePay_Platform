/**
 * Tests for the merchant onboarding / registration page.
 *
 * Covers: form renders all required fields, KRA PIN field presence,
 * validation errors on empty required fields, successful submission
 * redirects to /auth/login, and API error display.
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

// ─── Form rendering ───────────────────────────────────────────────────────────

describe('OnboardingPage form fields', () => {
  it('renders the page heading', () => {
    render(<OnboardingPage />)
    expect(screen.getByText(/create your merchant account/i)).toBeInTheDocument()
  })

  it('renders the Business name field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText(/wanjiku groceries/i)).toBeInTheDocument()
  })

  it('renders the Email address field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText(/you@example\.com/i)).toBeInTheDocument()
  })

  it('renders the Phone number field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText('254712345678')).toBeInTheDocument()
  })

  it('renders the Password field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText(/minimum 8 characters/i)).toBeInTheDocument()
  })

  it('renders the KRA PIN field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText('P051234567X')).toBeInTheDocument()
  })

  it('renders the M-Pesa shortcode field', () => {
    render(<OnboardingPage />)
    expect(screen.getByPlaceholderText('174379')).toBeInTheDocument()
  })

  it('renders the submit button', () => {
    render(<OnboardingPage />)
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
  })
})

// ─── Validation errors ────────────────────────────────────────────────────────

describe('OnboardingPage validation', () => {
  it('shows an error when name is empty on submit', async () => {
    render(<OnboardingPage />)
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByText(/business name is required/i)).toBeInTheDocument()
    expect(mockMerchantRegister).not.toHaveBeenCalled()
  })

  it('shows an error when email is empty on submit', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByText(/email is required/i)).toBeInTheDocument()
    expect(mockMerchantRegister).not.toHaveBeenCalled()
  })

  it('shows an error when phone is empty on submit', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByText(/phone number is required/i)).toBeInTheDocument()
    expect(mockMerchantRegister).not.toHaveBeenCalled()
  })

  it('shows an error when password is empty on submit', async () => {
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByText(/password is required/i)).toBeInTheDocument()
    expect(mockMerchantRegister).not.toHaveBeenCalled()
  })
})

// ─── Successful submission ────────────────────────────────────────────────────

describe('OnboardingPage successful submission', () => {
  beforeEach(() => {
    mockMerchantRegister.mockResolvedValue({ merchantId: 'mid-new', status: 'pending' })
  })

  async function fillAndSubmit() {
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
  }

  it('calls merchantRegister with required fields', async () => {
    render(<OnboardingPage />)
    await fillAndSubmit()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(mockMerchantRegister).toHaveBeenCalledWith(expect.objectContaining({
        name:     'Test Shop',
        email:    'test@example.com',
        phone:    '254712345678',
        password: 'Password123',
      }))
    )
  })

  it('accepts input in the KRA PIN field without preventing submission', async () => {
    render(<OnboardingPage />)
    await fillAndSubmit()
    await userEvent.type(screen.getByPlaceholderText('P051234567X'), 'P051234567A')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(mockMerchantRegister).toHaveBeenCalledTimes(1))
  })

  it('includes mpesaShortcode in the payload when provided', async () => {
    render(<OnboardingPage />)
    await fillAndSubmit()
    await userEvent.type(screen.getByPlaceholderText('174379'), '174379')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(mockMerchantRegister).toHaveBeenCalledWith(expect.objectContaining({
        mpesaShortcode: '174379',
      }))
    )
  })

  it('redirects to /auth/login after successful registration', async () => {
    render(<OnboardingPage />)
    await fillAndSubmit()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/auth/login?registered=1')
    )
  })

  it('shows "Creating account…" while the request is in-flight', async () => {
    mockMerchantRegister.mockReturnValue(new Promise(() => {}))
    render(<OnboardingPage />)
    await fillAndSubmit()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled()
  })
})

// ─── API error ────────────────────────────────────────────────────────────────

describe('OnboardingPage API error', () => {
  it('shows the API error message when registration fails', async () => {
    mockMerchantRegister.mockRejectedValue(new Error('Email already in use'))
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(screen.getByText(/email already in use/i)).toBeInTheDocument()
    )
  })

  it('does not redirect on failure', async () => {
    mockMerchantRegister.mockRejectedValue(new Error('Server error'))
    render(<OnboardingPage />)
    await userEvent.type(screen.getByPlaceholderText(/wanjiku groceries/i), 'Test Shop')
    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com')
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => screen.getByText(/server error/i))
    expect(mockPush).not.toHaveBeenCalled()
  })
})
