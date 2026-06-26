import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginPage from '@/pages/auth/LoginPage'

// GoogleLogin is conditionally rendered based on this env var
process.env.VITE_GOOGLE_CLIENT_ID = 'test-client-id'

const mockNavigate = jest.fn()
let mockSearchParams: Record<string, string | null> = {}

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [{ get: (k: string) => mockSearchParams[k] ?? null }],
  Link: ({ children, to, ...rest }: any) => <a href={to} {...rest}>{children}</a>,
}))

jest.mock('@react-oauth/google', () => ({
  GoogleLogin: ({ onSuccess, onError }: { onSuccess?: (res: unknown) => void; onError?: () => void }) => (
    <>
      <button onClick={() => onSuccess?.({ credential: 'test-credential' })}>Sign in with Google</button>
      <button onClick={() => onSuccess?.({})}>Google no-credential</button>
      <button onClick={() => onError?.()}>Google sign-in error</button>
    </>
  ),
  useGoogleOAuth: () => ({}),
}))

jest.mock('@/lib/api', () => ({
  auth: {
    merchantLogin: jest.fn(),
    consumerLogin:  jest.fn(),
    googleLogin:    jest.fn(),
  },
}))

jest.mock('@/lib/auth', () => ({
  saveToken: jest.fn(),
}))

const mockMerchantLogin = jest.requireMock('@/lib/api').auth.merchantLogin as jest.Mock
const mockConsumerLogin  = jest.requireMock('@/lib/api').auth.consumerLogin  as jest.Mock
const mockGoogleLogin    = jest.requireMock('@/lib/api').auth.googleLogin    as jest.Mock
const mockSaveToken      = jest.requireMock('@/lib/auth').saveToken            as jest.Mock

function emailInput()    { return document.querySelector('input[type="email"]')    as HTMLInputElement }
// Use autocomplete attribute to find the password input regardless of whether it's been toggled to type=text
function passwordInput() { return document.querySelector('input[autocomplete="current-password"]') as HTMLInputElement }

describe('LoginClient', () => {
  beforeEach(() => { jest.clearAllMocks(); mockSearchParams = {} })

  // ── Initial render ────────────────────────────────────────────────────────

  it('renders with merchant mode active by default', () => {
    render(<LoginPage />)
    expect(screen.getByRole('button', { name: /^merchant$/i })).toHaveClass('text-white')
    expect(screen.getByRole('button', { name: /^consumer$/i })).not.toHaveClass('text-white')
    expect(screen.getByRole('link', { name: /apply for access/i })).toBeInTheDocument()
  })

  it('shows email and password inputs', () => {
    render(<LoginPage />)
    expect(emailInput()).toBeInTheDocument()
    expect(passwordInput()).toBeInTheDocument()
  })

  it('shows sign in button', () => {
    render(<LoginPage />)
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
  })

  // ── Mode toggle ────────────────────────────────────────────────────────────

  it('switches to consumer mode when consumer tab is clicked', async () => {
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    expect(screen.getByRole('button', { name: /^consumer$/i })).toHaveClass('text-white')
    expect(screen.getByRole('button', { name: /^merchant$/i })).not.toHaveClass('text-white')
    expect(screen.getByRole('link', { name: /create account/i })).toBeInTheDocument()
  })

  it('shows "Apply for access" link in merchant mode', () => {
    render(<LoginPage />)
    expect(screen.getByRole('link', { name: /apply for access/i })).toBeInTheDocument()
  })

  it('shows "Create account" link in consumer mode', async () => {
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    expect(screen.getByRole('link', { name: /create account/i })).toBeInTheDocument()
  })

  it('clears error when mode is toggled', async () => {
    mockMerchantLogin.mockRejectedValue(new Error('Invalid credentials'))
    render(<LoginPage />)
    await userEvent.type(emailInput(), 'bad@test.com')
    await userEvent.type(passwordInput(), 'wrong1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument()
  })

  // ── Password visibility toggle ────────────────────────────────────────────

  it('password toggle reveals the password in plain text', async () => {
    render(<LoginPage />)
    await userEvent.type(passwordInput(), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    // After toggle the input type changes; re-query because the element is the same DOM node
    expect(passwordInput()).toHaveAttribute('type', 'text')
  })

  it('password toggle button has accessible aria-label', () => {
    render(<LoginPage />)
    expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument()
  })

  // ── Loading state ─────────────────────────────────────────────────────────

  it('disables submit button while request is in-flight', async () => {
    mockMerchantLogin.mockReturnValue(new Promise(() => {}))
    render(<LoginPage />)
    await userEvent.type(emailInput(), 'test@test.com')
    await userEvent.type(passwordInput(), 'password123!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    const btn = screen.getByRole('button', { name: /signing in/i })
    expect(btn).toBeDisabled()
  })

  it('shows "Signing in…" text while loading', async () => {
    mockMerchantLogin.mockReturnValue(new Promise(() => {}))
    render(<LoginPage />)
    await userEvent.type(emailInput(), 'test@test.com')
    await userEvent.type(passwordInput(), 'password123!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(screen.getByRole('button', { name: /signing in/i })).toBeInTheDocument()
  })

  // ── Successful login ──────────────────────────────────────────────────────

  it('redirects to /merchant/dashboard on successful merchant login', async () => {
    mockMerchantLogin.mockResolvedValue({ token: 'tok.123', merchantId: 'mid', merchantName: 'Test Merchant' })
    render(<LoginPage />)
    await userEvent.type(emailInput(), 'merchant@test.com')
    await userEvent.type(passwordInput(), 'validPassword1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/merchant/dashboard'))
    expect(mockSaveToken).toHaveBeenCalledWith('tok.123', false)
  })

  it('redirects to /consumer/dashboard on successful consumer login', async () => {
    mockConsumerLogin.mockResolvedValue({ token: 'ctok.456', consumerId: 'cid' })
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /^consumer$/i }))
    await userEvent.type(emailInput(), 'consumer@test.com')
    await userEvent.type(passwordInput(), 'validPassword1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/consumer/dashboard'))
    expect(mockSaveToken).toHaveBeenCalledWith('ctok.456', true)
  })

  it('saves token with isConsumer=false for merchant login', async () => {
    mockMerchantLogin.mockResolvedValue({ token: 'mtoken', merchantId: 'mid', merchantName: 'M' })
    render(<LoginPage />)
    await userEvent.type(emailInput(), 'm@test.com')
    await userEvent.type(passwordInput(), 'pass1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockSaveToken).toHaveBeenCalled())
    expect(mockSaveToken).toHaveBeenCalledWith('mtoken', false)
  })

  it('saves token with isConsumer=true for consumer login', async () => {
    mockConsumerLogin.mockResolvedValue({ token: 'ctoken', consumerId: 'cid' })
    render(<LoginPage />)
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
    render(<LoginPage />)
    await userEvent.type(emailInput(), 'bad@test.com')
    await userEvent.type(passwordInput(), 'wrongpassword1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() =>
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument()
    )
  })

  it('re-enables submit button after a failed request', async () => {
    mockMerchantLogin.mockRejectedValue(new Error('Invalid credentials'))
    render(<LoginPage />)
    await userEvent.type(emailInput(), 'bad@test.com')
    await userEvent.type(passwordInput(), 'wrong1!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled())
  })

  // ── Google OAuth ──────────────────────────────────────────────────────────

  it('redirects to merchant dashboard on successful Google sign-in', async () => {
    mockGoogleLogin.mockResolvedValue({ token: 'g-tok', merchantId: 'mid', merchantName: 'G Merchant' })
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/merchant/dashboard'))
    expect(mockSaveToken).toHaveBeenCalledWith('g-tok', false)
  })

  it('shows phone collection form when Google login requires phone', async () => {
    mockGoogleLogin.mockResolvedValue({ needsPhone: true, email: 'g@test.com', displayName: 'G User' })
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => expect(screen.getByText('G User')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('254712345678')).toBeInTheDocument()
  })

  it('submits phone and redirects on Google consumer sign-up', async () => {
    mockGoogleLogin
      .mockResolvedValueOnce({ needsPhone: true, email: 'g@test.com', displayName: 'G User' })
      .mockResolvedValueOnce({ token: 'g-consumer-tok', consumerId: 'cid' })
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => screen.getByPlaceholderText('254712345678'))
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/consumer/dashboard'))
    expect(mockSaveToken).toHaveBeenCalledWith('g-consumer-tok', true)
  })

  it('shows error when Google sign-in fails', async () => {
    mockGoogleLogin.mockRejectedValue(new Error('Google auth failed'))
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => expect(screen.getByText(/google auth failed/i)).toBeInTheDocument())
  })

  it('shows "Google sign-in failed" when GoogleLogin fires onError', async () => {
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /google sign-in error/i }))
    await waitFor(() =>
      expect(screen.getByText(/google sign-in failed/i)).toBeInTheDocument()
    )
  })

  it('clears phone form and shows Google button when Back is clicked', async () => {
    mockGoogleLogin.mockResolvedValueOnce({ needsPhone: true, email: 'g@test.com', displayName: 'G User' })
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => screen.getByPlaceholderText('254712345678'))
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('254712345678')).not.toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('shows error when handleGooglePhone API call throws', async () => {
    mockGoogleLogin
      .mockResolvedValueOnce({ needsPhone: true, email: 'g@test.com', displayName: 'G User' })
      .mockRejectedValueOnce(new Error('Phone already registered'))
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => screen.getByPlaceholderText('254712345678'))
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254712345678')
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() => {
      const errors = screen.getAllByText(/phone already registered/i)
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows "Phone required" error when second googleLogin still returns needsPhone (line 61)', async () => {
    mockGoogleLogin
      .mockResolvedValueOnce({ needsPhone: true, email: 'g@test.com', displayName: 'G User' })
      .mockResolvedValueOnce({ needsPhone: true, email: 'g@test.com' })
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => screen.getByPlaceholderText('254712345678'))
    await userEvent.type(screen.getByPlaceholderText('254712345678'), '254799000001')
    await userEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() => {
      const errors = screen.getAllByText(/phone required/i)
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ─── registered banner and kycRedirect ────────────────────────────────────────

describe('LoginPage — registered=1 banner (line 130)', () => {
  it('shows "Account created! Please sign in." when registered=1 without kyc', () => {
    mockSearchParams = { registered: '1' }
    render(<LoginPage />)
    expect(screen.getByText(/account created! please sign in/i)).toBeInTheDocument()
  })

  it('shows "Account created! Log in to complete KYC." when registered=1 and kyc=1', () => {
    mockSearchParams = { registered: '1', kyc: '1' }
    render(<LoginPage />)
    expect(screen.getByText(/log in to complete kyc/i)).toBeInTheDocument()
  })
})

// ─── handleGoogleSuccess !cr.credential early return (line 42) ───────────────

describe('LoginPage — Google login with no credential (line 42)', () => {
  beforeEach(() => { jest.clearAllMocks(); mockSearchParams = {} })

  it('does nothing when credential is absent — loading never starts', async () => {
    render(<LoginPage />)
    // Click the button that fires onSuccess({}) — no credential
    await userEvent.click(screen.getByRole('button', { name: /google no-credential/i }))
    // Nothing should happen — the early return prevents any API call
    expect(mockGoogleLogin).not.toHaveBeenCalled()
    // The main Google sign-in button is still visible (page not loading)
    expect(screen.getByRole('button', { name: /^sign in with google$/i })).toBeInTheDocument()
  })
})

// ─── Google consumer login navigates to /consumer/dashboard (line 51) ────────

describe('LoginPage — Google success navigates to consumer dashboard', () => {
  it('navigates to /consumer/dashboard when mode is consumer and Google succeeds', async () => {
    mockGoogleLogin.mockResolvedValue({ token: 'consumer-token' })
    render(<LoginPage />)
    // Switch to consumer mode
    await userEvent.click(screen.getByRole('button', { name: /consumer/i }))
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/consumer/dashboard')
    )
  })
})
