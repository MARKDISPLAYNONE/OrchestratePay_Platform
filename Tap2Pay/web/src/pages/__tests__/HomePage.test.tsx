/**
 * Tests for src/pages/HomePage.tsx
 *
 * Covers: session-storage fast path (navigates immediately without splash),
 * first-visit path (shows splash), and handleDone (sets key + navigates).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from '@/pages/HomePage'

const mockNavigate = jest.fn()

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

jest.mock('@/lib/auth', () => ({
  dashboardPath: jest.fn(() => '/merchant/dashboard'),
}))

jest.mock('@/components/SplashScreen', () => ({
  __esModule: true,
  default: ({ onDone }: { onDone: () => void }) => (
    <div>
      <span>SplashScreen</span>
      <button onClick={onDone}>Done</button>
    </div>
  ),
}))

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
})

describe('HomePage — first visit (no session key)', () => {
  it('renders the splash screen', async () => {
    render(<HomePage />)
    await waitFor(() =>
      expect(screen.getByText('SplashScreen')).toBeInTheDocument()
    )
  })

  it('does not navigate immediately', () => {
    render(<HomePage />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

describe('HomePage — returning visit (session key set)', () => {
  beforeEach(() => {
    sessionStorage.setItem('tap2pay_splash', '1')
  })

  it('navigates to the dashboard without showing the splash', () => {
    render(<HomePage />)
    expect(mockNavigate).toHaveBeenCalledWith('/merchant/dashboard', { replace: true })
  })

  it('does not render splash screen', () => {
    render(<HomePage />)
    expect(screen.queryByText('SplashScreen')).not.toBeInTheDocument()
  })
})

describe('HomePage — handleDone callback', () => {
  it('sets the session key and navigates after splash completes', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('Done'))
    await userEvent.click(screen.getByText('Done'))
    expect(sessionStorage.getItem('tap2pay_splash')).toBe('1')
    expect(mockNavigate).toHaveBeenCalledWith('/merchant/dashboard', { replace: true })
  })
})
