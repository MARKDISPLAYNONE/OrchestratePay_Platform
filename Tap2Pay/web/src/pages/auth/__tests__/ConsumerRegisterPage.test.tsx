/**
 * Tests for src/pages/auth/ConsumerRegisterPage.tsx
 *
 * Covers: form field rendering, successful registration, error display,
 * loading state, navigation to /consumer/dashboard, and link to sign-in.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConsumerRegisterPage from '@/pages/auth/ConsumerRegisterPage'

const mockNavigate = jest.fn()

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
}))

jest.mock('@/lib/api', () => ({
  auth: { consumerRegister: jest.fn() },
}))

jest.mock('@/lib/auth', () => ({
  saveToken: jest.fn(),
}))

const mockRegister  = jest.requireMock('@/lib/api').auth.consumerRegister as jest.Mock
const mockSaveToken = jest.requireMock('@/lib/auth').saveToken              as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('ConsumerRegisterPage — rendering', () => {
  it('renders the phone input', () => {
    render(<ConsumerRegisterPage />)
    expect(screen.getByPlaceholderText('254712345678')).toBeInTheDocument()
  })

  it('renders the display name input', () => {
    render(<ConsumerRegisterPage />)
    expect(screen.getByPlaceholderText(/jane kamau/i)).toBeInTheDocument()
  })

  it('renders the email input', () => {
    render(<ConsumerRegisterPage />)
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument()
  })

  it('renders the password input', () => {
    render(<ConsumerRegisterPage />)
    expect(screen.getByPlaceholderText(/min 8 characters/i)).toBeInTheDocument()
  })

  it('renders the create account button', () => {
    render(<ConsumerRegisterPage />)
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
  })

  it('renders the sign in link', () => {
    render(<ConsumerRegisterPage />)
    expect(screen.getByText(/sign in/i)).toBeInTheDocument()
  })
})

describe('ConsumerRegisterPage — successful registration', () => {
  it('saves token and navigates to /consumer/dashboard', async () => {
    mockRegister.mockResolvedValue({ token: 'cons-tok-001' })
    render(<ConsumerRegisterPage />)
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.type(screen.getByPlaceholderText(/jane kamau/i), 'Alice')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(mockSaveToken).toHaveBeenCalledWith('cons-tok-001', true)
    )
    expect(mockNavigate).toHaveBeenCalledWith('/consumer/dashboard')
  })

  it('calls consumerRegister with form values', async () => {
    mockRegister.mockResolvedValue({ token: 'tok' })
    render(<ConsumerRegisterPage />)
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254798765432')
    await userEvent.type(screen.getByPlaceholderText(/jane kamau/i), 'Bob')
    await userEvent.type(screen.getByPlaceholderText(/you@example.com/i), 'bob@test.com')
    await userEvent.type(screen.getByPlaceholderText(/min 8 characters/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({
        phone:       '254798765432',
        displayName: 'Bob',
        email:       'bob@test.com',
        password:    'password123',
      }))
    )
  })
})

describe('ConsumerRegisterPage — error state', () => {
  it('shows error message when register fails', async () => {
    mockRegister.mockRejectedValue(new Error('Phone already registered'))
    render(<ConsumerRegisterPage />)
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(screen.getByText(/phone already registered/i)).toBeInTheDocument()
    )
  })
})

describe('ConsumerRegisterPage — loading state', () => {
  it('shows Creating account… while request is in-flight', async () => {
    mockRegister.mockReturnValue(new Promise(() => {}))
    render(<ConsumerRegisterPage />)
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(screen.getByText(/creating account/i)).toBeInTheDocument()
    )
  })

  it('disables button while loading', async () => {
    mockRegister.mockReturnValue(new Promise(() => {}))
    render(<ConsumerRegisterPage />)
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() =>
      expect(screen.getByText(/creating account/i).closest('button')).toBeDisabled()
    )
  })
})
