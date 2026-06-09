/**
 * Tests for merchant registration page.
 *
 * Covers: form rendering, required field validation, submission flow,
 * success state transition, and error display.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MerchantRegisterPage from '../page'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/lib/api', () => ({
  auth: {
    merchantRegister: jest.fn(),
  },
}))

const mockRegister = jest.requireMock('@/lib/api').auth.merchantRegister as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('MerchantRegisterPage rendering', () => {
  it('renders the page heading', () => {
    render(<MerchantRegisterPage />)
    expect(screen.getByText(/apply for merchant access/i)).toBeInTheDocument()
  })

  it('renders all required input fields', () => {
    render(<MerchantRegisterPage />)
    expect(screen.getByLabelText(/business name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument()
  })

  it('renders optional fields', () => {
    render(<MerchantRegisterPage />)
    expect(screen.getByLabelText(/business reg/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/m-pesa/i)).toBeInTheDocument()
  })

  it('renders the submit button', () => {
    render(<MerchantRegisterPage />)
    expect(screen.getByRole('button', { name: /submit application/i })).toBeInTheDocument()
  })

  it('has a sign in link', () => {
    render(<MerchantRegisterPage />)
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
  })

  it('does not show an error initially', () => {
    render(<MerchantRegisterPage />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ─── Form interaction ─────────────────────────────────────────────────────────

describe('MerchantRegisterPage form interaction', () => {
  it('updates business name field on typing', async () => {
    render(<MerchantRegisterPage />)
    const input = screen.getByLabelText(/business name/i) as HTMLInputElement
    await userEvent.type(input, 'Wanjiku Groceries')
    expect(input.value).toBe('Wanjiku Groceries')
  })

  it('updates email field on typing', async () => {
    render(<MerchantRegisterPage />)
    const input = screen.getByLabelText(/email/i) as HTMLInputElement
    await userEvent.type(input, 'wanjiku@example.com')
    expect(input.value).toBe('wanjiku@example.com')
  })

  it('shows loading text while request is in-flight', async () => {
    mockRegister.mockReturnValue(new Promise(() => {})) // never resolves
    render(<MerchantRegisterPage />)
    await userEvent.type(screen.getByLabelText(/business name/i), 'Shop')
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'pass123')
    await userEvent.type(screen.getByLabelText(/phone/i), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /submit application/i }))
    expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
  })
})

// ─── Successful submission ────────────────────────────────────────────────────

describe('MerchantRegisterPage success', () => {
  async function fillAndSubmit() {
    render(<MerchantRegisterPage />)
    await userEvent.type(screen.getByLabelText(/business name/i), 'Wanjiku Groceries')
    await userEvent.type(screen.getByLabelText(/email/i), 'wanjiku@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'Password123!')
    await userEvent.type(screen.getByLabelText(/phone/i), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /submit application/i }))
  }

  it('calls merchantRegister with required fields', async () => {
    mockRegister.mockResolvedValue({ merchantId: 'mid-1', status: 'pending' })
    await fillAndSubmit()
    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        name:     'Wanjiku Groceries',
        email:    'wanjiku@example.com',
        password: 'Password123!',
        phone:    '254712345678',
      })
    ))
  })

  it('shows success message after successful registration', async () => {
    mockRegister.mockResolvedValue({ merchantId: 'mid-1', status: 'pending' })
    await fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(/application received/i)).toBeInTheDocument()
    )
  })

  it('shows the pending review message in the success state', async () => {
    mockRegister.mockResolvedValue({ merchantId: 'mid-1', status: 'pending' })
    await fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(/pending review/i)).toBeInTheDocument()
    )
  })

  it('shows a back-to-sign-in button in the success state', async () => {
    mockRegister.mockResolvedValue({ merchantId: 'mid-1', status: 'pending' })
    await fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back to sign in/i })).toBeInTheDocument()
    )
  })

  it('navigates to /auth/login when back-to-sign-in is clicked', async () => {
    mockRegister.mockResolvedValue({ merchantId: 'mid-1', status: 'pending' })
    await fillAndSubmit()
    await waitFor(() => screen.getByRole('button', { name: /back to sign in/i }))
    await userEvent.click(screen.getByRole('button', { name: /back to sign in/i }))
    expect(mockPush).toHaveBeenCalledWith('/auth/login')
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('MerchantRegisterPage error handling', () => {
  it('displays the error message on API failure', async () => {
    mockRegister.mockRejectedValue(new Error('Email already registered'))
    render(<MerchantRegisterPage />)
    await userEvent.type(screen.getByLabelText(/business name/i), 'Shop')
    await userEvent.type(screen.getByLabelText(/email/i), 'exists@test.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'pass123')
    await userEvent.type(screen.getByLabelText(/phone/i), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /submit application/i }))
    await waitFor(() =>
      expect(screen.getByText(/email already registered/i)).toBeInTheDocument()
    )
  })

  it('re-enables submit button after a failed request', async () => {
    mockRegister.mockRejectedValue(new Error('Error'))
    render(<MerchantRegisterPage />)
    await userEvent.type(screen.getByLabelText(/business name/i), 'S')
    await userEvent.type(screen.getByLabelText(/email/i), 'e@t.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'p')
    await userEvent.type(screen.getByLabelText(/phone/i), '254700000000')
    await userEvent.click(screen.getByRole('button', { name: /submit application/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /submit application/i })).not.toBeDisabled()
    )
  })
})
