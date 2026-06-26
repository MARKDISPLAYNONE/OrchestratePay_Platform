/**
 * Tests for src/pages/admin/LoginPage.tsx
 *
 * Covers: form rendering, show/hide secret toggle, successful login,
 * error display, loading state, back navigation.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminLoginPage from '@/pages/admin/LoginPage'

const mockNavigate = jest.fn()

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

jest.mock('@/lib/api', () => ({
  saveAdminSecret:   jest.fn(),
  verifyAdminSecret: jest.fn(),
}))

const mockSave   = jest.requireMock('@/lib/api').saveAdminSecret   as jest.Mock
const mockVerify = jest.requireMock('@/lib/api').verifyAdminSecret as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('AdminLoginPage — rendering', () => {
  it('renders the admin secret input', () => {
    render(<AdminLoginPage />)
    expect(screen.getByPlaceholderText(/ADMIN_SECRET/i)).toBeInTheDocument()
  })

  it('renders the sign in button', () => {
    render(<AdminLoginPage />)
    expect(screen.getByRole('button', { name: /sign in to admin/i })).toBeInTheDocument()
  })

  it('renders the back to login link', () => {
    render(<AdminLoginPage />)
    expect(screen.getByText(/back to login/i)).toBeInTheDocument()
  })
})

describe('AdminLoginPage — show/hide toggle', () => {
  it('input starts as password type', () => {
    render(<AdminLoginPage />)
    const input = screen.getByPlaceholderText(/ADMIN_SECRET/i) as HTMLInputElement
    expect(input.type).toBe('password')
  })

  it('toggles to text type when show button is clicked', async () => {
    render(<AdminLoginPage />)
    const toggle = screen.getByLabelText(/show/i)
    await userEvent.click(toggle)
    const input = screen.getByPlaceholderText(/ADMIN_SECRET/i) as HTMLInputElement
    expect(input.type).toBe('text')
  })

  it('toggles back to password type on second click', async () => {
    render(<AdminLoginPage />)
    const toggle = screen.getByLabelText(/show/i)
    await userEvent.click(toggle)
    await userEvent.click(screen.getByLabelText(/hide/i))
    const input = screen.getByPlaceholderText(/ADMIN_SECRET/i) as HTMLInputElement
    expect(input.type).toBe('password')
  })
})

describe('AdminLoginPage — successful login', () => {
  it('verifies, saves and navigates to /admin on success', async () => {
    mockVerify.mockResolvedValue(undefined)
    render(<AdminLoginPage />)
    await userEvent.type(screen.getByPlaceholderText(/ADMIN_SECRET/i), 'supersecret')
    await userEvent.click(screen.getByRole('button', { name: /sign in to admin/i }))
    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith('supersecret'))
    expect(mockSave).toHaveBeenCalledWith('supersecret')
    expect(mockNavigate).toHaveBeenCalledWith('/admin')
  })
})

describe('AdminLoginPage — failed login', () => {
  it('shows error message when verify rejects', async () => {
    mockVerify.mockRejectedValue(new Error('bad secret'))
    render(<AdminLoginPage />)
    await userEvent.type(screen.getByPlaceholderText(/ADMIN_SECRET/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in to admin/i }))
    await waitFor(() =>
      expect(screen.getByText(/invalid admin secret/i)).toBeInTheDocument()
    )
  })

  it('does not navigate when verify fails', async () => {
    mockVerify.mockRejectedValue(new Error('bad secret'))
    render(<AdminLoginPage />)
    await userEvent.type(screen.getByPlaceholderText(/ADMIN_SECRET/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in to admin/i }))
    await waitFor(() => screen.getByText(/invalid admin secret/i))
    expect(mockNavigate).not.toHaveBeenCalledWith('/admin')
  })
})

describe('AdminLoginPage — loading state', () => {
  it('shows Verifying… while request is in-flight', async () => {
    mockVerify.mockReturnValue(new Promise(() => {}))
    render(<AdminLoginPage />)
    await userEvent.type(screen.getByPlaceholderText(/ADMIN_SECRET/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /sign in to admin/i }))
    await waitFor(() =>
      expect(screen.getByText(/verifying/i)).toBeInTheDocument()
    )
  })
})

describe('AdminLoginPage — back button', () => {
  it('navigates to /auth/login when back is clicked', async () => {
    render(<AdminLoginPage />)
    await userEvent.click(screen.getByText(/back to login/i))
    expect(mockNavigate).toHaveBeenCalledWith('/auth/login')
  })
})
