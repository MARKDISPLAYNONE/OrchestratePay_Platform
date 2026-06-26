/**
 * Tests for src/components/layouts/AdminLayout.tsx
 *
 * Covers: redirect to /admin/login when no secret, sidebar nav items,
 * sign-out clears secret and navigates, /admin/login path renders Outlet.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminLayout from '@/components/layouts/AdminLayout'

const mockNavigate = jest.fn()

jest.mock('react-router-dom', () => ({
  NavLink:    ({ to, children, className }: any) => {
    const active = to === '/admin'
    return <a href={to} className={typeof className === 'function' ? className({ isActive: active }) : className}>{children}</a>
  },
  Outlet:     () => <div data-testid="outlet">Outlet content</div>,
  useNavigate: () => mockNavigate,
  useLocation: jest.fn(),
  Navigate:   ({ to }: { to: string }) => <div data-testid={`navigate-${to.replace(/\//g, '-')}`} />,
}))

const mockUseLocation = jest.requireMock('react-router-dom').useLocation as jest.Mock

jest.mock('@/lib/api', () => ({
  hasAdminSecret:  jest.fn(),
  clearAdminSecret: jest.fn(),
}))

const mockHasAdminSecret  = jest.requireMock('@/lib/api').hasAdminSecret  as jest.Mock
const mockClearAdminSecret = jest.requireMock('@/lib/api').clearAdminSecret as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockUseLocation.mockReturnValue({ pathname: '/admin' })
})

describe('AdminLayout — unauthenticated', () => {
  it('redirects to /admin/login when no secret', () => {
    mockHasAdminSecret.mockReturnValue(false)
    render(<AdminLayout />)
    expect(screen.getByTestId('navigate--admin-login')).toBeInTheDocument()
  })

  it('does not render the sidebar when unauthenticated', () => {
    mockHasAdminSecret.mockReturnValue(false)
    render(<AdminLayout />)
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })
})

describe('AdminLayout — authenticated', () => {
  beforeEach(() => {
    mockHasAdminSecret.mockReturnValue(true)
  })

  it('renders the Dashboard nav link', () => {
    render(<AdminLayout />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('renders the Merchants nav link', () => {
    render(<AdminLayout />)
    expect(screen.getByText('Merchants')).toBeInTheDocument()
  })

  it('renders the Fleet nav link', () => {
    render(<AdminLayout />)
    expect(screen.getByText('Fleet')).toBeInTheDocument()
  })

  it('renders the Consumers nav link', () => {
    render(<AdminLayout />)
    expect(screen.getByText('Consumers')).toBeInTheDocument()
  })

  it('renders the Outlet', () => {
    render(<AdminLayout />)
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('renders the Sign out button', () => {
    render(<AdminLayout />)
    expect(screen.getByText(/sign out/i)).toBeInTheDocument()
  })

  it('clears admin secret and navigates on sign out', async () => {
    render(<AdminLayout />)
    await userEvent.click(screen.getByText(/sign out/i))
    expect(mockClearAdminSecret).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/admin/login')
  })
})

describe('AdminLayout — on /admin/login path', () => {
  it('renders Outlet directly (no redirect) on /admin/login', () => {
    mockHasAdminSecret.mockReturnValue(false)
    mockUseLocation.mockReturnValue({ pathname: '/admin/login' })
    render(<AdminLayout />)
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })
})
