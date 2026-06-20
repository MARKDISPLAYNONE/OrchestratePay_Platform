import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginClient from '../LoginClient'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/lib/api', () => ({
  auth: {
    merchantLogin: jest.fn(),
    consumerLogin:  jest.fn(),
  },
}))

jest.mock('@/lib/auth', () => ({
  saveToken: jest.fn(),
}))

const mockMerchantLogin = jest.requireMock('@/lib/api').auth.merchantLogin as jest.Mock
const mockConsumerLogin  = jest.requireMock('@/lib/api').auth.consumerLogin  as jest.Mock
const mockSaveToken      = jest.requireMock('@/lib/auth').saveToken            as jest.Mock

function emailInput()    { return document.querySelector('input[type="email"]')    as HTMLInputElement }
// Use autocomplete attribute to find the password input regardless of whether it's been toggled to type=text
function passwordInput() { return document.querySelector('input[autocomplete="current-password"]') as HTMLInputElement }

describe('LoginClient', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── Initial render ────────────────────────────────────────────────────────

  it('renders with merchant mode active by default', () => {
    render(<LoginClient />)
    expect(screen.getByRole('button', { name: /^merchant$/i })).toHaveClass('bg-blue-600')
    expect(screen.getByRole('link', { name: /apply for access/i })).toBeInTheDocument()
  })

  it('shows email and password inputs', () => {
    render(<LoginClient />)
    expect(emailInput()).toBeInTheDocument()
    expect(passwordInput()).toBeInTheDocument()
  })

  it('shows sign in button', () => {
    render(<LoginClient />)
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
  })

  // ── Mode toggle ────────────────────────────────────────────────────────────

  it('switches to consumer mode when consumer tab is clicked', async () => {
    render(<LoginClient />)
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    expect(screen.getByRole('button', { name: /^consumer$/i })).toHaveClass('bg-blue-600')
    expect(screen.getByRole('link', { name: /create account/i })).toBeInTheDocument()
  })

  it('shows "Apply for access" link in merchant mode', () => {
    render(<LoginClient />)
    expect(screen.getByRole('link', { name: /apply for access/i })).toBeInTheDocument()
  })

  it('shows "Create account" link in consumer mode', async () => {
    render(<LoginClient />)
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    expect(screen.getByRole('link', { name: /create account/i })).toBeInTheDocument()
  })

  it('clears error when mode is toggled', async () => {
    mockMerchantLogin.mockRejectedValue(new Error('Invalid credentials'))
    render(<LoginClient />)
    await userEvent.type(emailInput(), 'bad@test.com')
    await userEvent.type(passwordInput(), 'wrong1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument()
  })

  // ── Password visibility toggle ────────────────────────────────────────────

  it('password toggle reveals the password in plain text', async () => {
    render(<LoginClient />)
    await userEvent.type(passwordInput(), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    // After toggle the input type changes; re-query because the element is the same DOM node
    expect(passwordInput()).toHaveAttribute('type', 'text')
  })

  it('password toggle button has accessible aria-label', () => {
    render(<LoginClient />)
    expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument()
  })

  // ── Loading state ─────────────────────────────────────────────────────────

  it('disables submit button while request is in-flight', async () => {
    mockMerchantLogin.mockReturnValue(new Promise(() => {}))
    render(<LoginClient />)
    await userEvent.type(emailInput(), 'test@test.com')
    await userEvent.type(passwordInput(), 'password123!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    const btn = screen.getByRole('button', { name: /signing in/i })
    expect(btn).toBeDisabled()
  })

  it('shows "Signing in…" text while loading', async () => {
    mockMerchantLogin.mockReturnValue(new Promise(() => {}))
    render(<LoginClient />)
    await userEvent.type(emailInput(), 'test@test.com')
    await userEvent.type(passwordInput(), 'password123!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(screen.getByRole('button', { name: /signing in/i })).toBeInTheDocument()
  })

  // ── Successful login ──────────────────────────────────────────────────────

  it('redirects to /merchant/dashboard on successful merchant login', async () => {
    mockMerchantLogin.mockResolvedValue({ token: 'tok.123', merchantId: 'mid', merchantName: 'Test Merchant' })
    render(<LoginClient />)
    await userEvent.type(emailInput(), 'merchant@test.com')
    await userEvent.type(passwordInput(), 'validPassword1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/merchant/dashboard'))
    expect(mockSaveToken).toHaveBeenCalledWith('tok.123', false)
  })

  it('redirects to /consumer/dashboard on successful consumer login', async () => {
    mockConsumerLogin.mockResolvedValue({ token: 'ctok.456', consumerId: 'cid' })
    render(<LoginClient />)
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    await userEvent.type(emailInput(), 'consumer@test.com')
    await userEvent.type(passwordInput(), 'validPassword1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/consumer/dashboard'))
    expect(mockSaveToken).toHaveBeenCalledWith('ctok.456', true)
  })

  it('saves token with isConsumer=false for merchant login', async () => {
    mockMerchantLogin.mockResolvedValue({ token: 'mtoken', merchantId: 'mid', merchantName: 'M' })
    render(<LoginClient />)
    await userEvent.type(emailInput(), 'm@test.com')
    await userEvent.type(passwordInput(), 'pass1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockSaveToken).toHaveBeenCalled())
    expect(mockSaveToken).toHaveBeenCalledWith('mtoken', false)
  })

  it('saves token with isConsumer=true for consumer login', async () => {
    mockConsumerLogin.mockResolvedValue({ token: 'ctoken', consumerId: 'cid' })
    render(<LoginClient />)
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    await userEvent.type(emailInput(), 'c@test.com')
    await userEvent.type(passwordInput(), 'pass1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockSaveToken).toHaveBeenCalled())
    expect(mockSaveToken).toHaveBeenCalledWith('ctoken', true)
  })

  // ── Error display ─────────────────────────────────────────────────────────

  it('shows error message returned by the API', async () => {
    mockMerchantLogin.mockRejectedValue(new Error('Invalid email or password'))
    render(<LoginClient />)
    await userEvent.type(emailInput(), 'bad@test.com')
    await userEvent.type(passwordInput(), 'wrongpassword1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() =>
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument()
    )
  })

  it('re-enables submit button after a failed request', async () => {
    mockMerchantLogin.mockRejectedValue(new Error('Invalid credentials'))
    render(<LoginClient />)
    await userEvent.type(emailInput(), 'bad@test.com')
    await userEvent.type(passwordInput(), 'wrong1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled())
  })
})
