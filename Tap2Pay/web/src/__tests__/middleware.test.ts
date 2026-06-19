/**
 * Tests for src/middleware.ts — Next.js route middleware.
 *
 * Covers all branches: admin route protection (with/without admin_auth cookie),
 * /admin/login bypass, consumer route protection (CONSUMER role vs absent/wrong role),
 * unprotected paths that fall through to NextResponse.next(), and the config matcher.
 */

import { middleware, config } from '../middleware'

jest.mock('next/server', () => ({
  NextResponse: {
    redirect: jest.fn((url: URL) => ({ type: 'redirect', redirectUrl: url })),
    next:     jest.fn(() => ({ type: 'next' })),
  },
}))

const mockRedirect = jest.requireMock('next/server').NextResponse.redirect as jest.Mock
const mockNext     = jest.requireMock('next/server').NextResponse.next     as jest.Mock

function makeReq(pathname: string, cookies: Record<string, string> = {}): any {
  return {
    nextUrl: { pathname },
    url:     `http://localhost${pathname}`,
    cookies: {
      get: (name: string) =>
        Object.prototype.hasOwnProperty.call(cookies, name)
          ? { value: cookies[name] }
          : undefined,
    },
  }
}

beforeEach(() => jest.clearAllMocks())

// ─── Admin route protection ───────────────────────────────────────────────────

describe('middleware admin route protection', () => {
  it('redirects to /admin/login when admin_auth cookie is absent', () => {
    middleware(makeReq('/admin/fleet'))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    const callUrl = mockRedirect.mock.calls[0][0] as URL
    expect(callUrl.pathname).toBe('/admin/login')
  })

  it('calls next() when admin_auth cookie is present', () => {
    middleware(makeReq('/admin/fleet', { admin_auth: '1' }))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('calls next() for /admin/settings with admin_auth cookie', () => {
    middleware(makeReq('/admin/settings', { admin_auth: 'session-token' }))
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('does not protect /admin/login itself (allows unauthenticated access)', () => {
    middleware(makeReq('/admin/login'))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('does not protect /admin/login even without cookies', () => {
    middleware(makeReq('/admin/login', {}))
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

// ─── Consumer route protection ────────────────────────────────────────────────

describe('middleware consumer route protection', () => {
  it('calls next() when auth_role is CONSUMER', () => {
    middleware(makeReq('/consumer/dashboard', { auth_role: 'CONSUMER' }))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('redirects to /auth/login when auth_role cookie is absent', () => {
    middleware(makeReq('/consumer/profile'))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    const callUrl = mockRedirect.mock.calls[0][0] as URL
    expect(callUrl.pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login when auth_role is MERCHANT (wrong role)', () => {
    middleware(makeReq('/consumer/pay/mid-001', { auth_role: 'MERCHANT' }))
    const callUrl = mockRedirect.mock.calls[0][0] as URL
    expect(callUrl.pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login when auth_role is ADMIN (wrong role)', () => {
    middleware(makeReq('/consumer/loyalty', { auth_role: 'ADMIN' }))
    const callUrl = mockRedirect.mock.calls[0][0] as URL
    expect(callUrl.pathname).toBe('/auth/login')
  })
})

// ─── Unprotected paths ────────────────────────────────────────────────────────

describe('middleware unprotected paths', () => {
  it('calls next() for /merchant/dashboard (not in matcher)', () => {
    middleware(makeReq('/merchant/dashboard'))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('calls next() for /auth/login', () => {
    middleware(makeReq('/auth/login'))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('calls next() for the root path', () => {
    middleware(makeReq('/'))
    expect(mockNext).toHaveBeenCalledTimes(1)
  })
})

// ─── Config export ────────────────────────────────────────────────────────────

describe('middleware config', () => {
  it('matches /admin/:path* and /consumer/:path*', () => {
    expect(config.matcher).toContain('/admin/:path*')
    expect(config.matcher).toContain('/consumer/:path*')
  })

  it('exports exactly two matchers', () => {
    expect(config.matcher).toHaveLength(2)
  })
})
