/**
 * Tests for src/middleware.ts — Next.js route middleware.
 *
 * Covers: admin route protection, consumer + merchant JWT-verified route
 * protection, the /admin/login bypass, unprotected paths, and the config
 * matcher.
 *
 * jose is ESM-only and can't run under Jest's CJS transform, so it is mocked
 * below. The mock focuses tests on routing logic — jose's JWT crypto is
 * well-tested upstream and doesn't need re-testing here.
 */

// Set before any module that reads process.env.JWT_SECRET is loaded.
process.env.JWT_SECRET = 'test-secret'

import { middleware, config } from '../middleware'

// ─── jose mock ────────────────────────────────────────────────────────────────

type VerifyResult = { payload: { role?: string } }
let verifyImpl: (token: string) => Promise<VerifyResult>

jest.mock('jose', () => ({
  jwtVerify: jest.fn((...args: unknown[]) => verifyImpl(args[0] as string)),
}))

// Token helpers — the mock resolves tokens that start with 'valid-<ROLE>',
// rejects tokens that start with 'forged-' or 'expired-', and throws on
// anything else so accidental leaks are caught.
function validToken(role: string): string  { return `valid-${role}` }
function expiredToken(role: string): string { return `expired-${role}` }
function forgedToken(role: string): string  { return `forged-${role}` }

beforeEach(() => {
  jest.clearAllMocks()

  verifyImpl = async (token: string) => {
    if (token.startsWith('forged-'))  throw new Error('JWTSignatureVerificationFailed')
    if (token.startsWith('expired-')) throw new Error('JWTExpired')
    if (token.startsWith('valid-'))   return { payload: { role: token.slice('valid-'.length) } }
    throw new Error(`Unexpected test token: ${token}`)
  }
})

// ─── Next/server mock ─────────────────────────────────────────────────────────

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

// ─── Admin route protection ───────────────────────────────────────────────────

describe('middleware admin route protection', () => {
  it('redirects to /admin/login when admin_auth cookie is absent', async () => {
    await middleware(makeReq('/admin/fleet'))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/admin/login')
  })

  it('calls next() when admin_auth cookie is present', async () => {
    await middleware(makeReq('/admin/fleet', { admin_auth: '1' }))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('calls next() for /admin/settings with admin_auth cookie', async () => {
    await middleware(makeReq('/admin/settings', { admin_auth: 'session-token' }))
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('does not protect /admin/login itself', async () => {
    await middleware(makeReq('/admin/login'))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('does not protect /admin/login even without cookies', async () => {
    await middleware(makeReq('/admin/login', {}))
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

// ─── Consumer route protection ────────────────────────────────────────────────

describe('middleware consumer route protection', () => {
  it('calls next() for a valid CONSUMER token', async () => {
    await middleware(makeReq('/consumer/dashboard', { token: validToken('CONSUMER') }))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('redirects to /auth/login when token cookie is absent', async () => {
    await middleware(makeReq('/consumer/profile'))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login when token has MERCHANT role', async () => {
    await middleware(makeReq('/consumer/pay/mid-001', { token: validToken('MERCHANT') }))
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login when token has ADMIN role', async () => {
    await middleware(makeReq('/consumer/loyalty', { token: validToken('ADMIN') }))
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login for a forged (unsigned) token', async () => {
    await middleware(makeReq('/consumer/dashboard', { token: forgedToken('CONSUMER') }))
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login for an expired token', async () => {
    await middleware(makeReq('/consumer/dashboard', { token: expiredToken('CONSUMER') }))
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })
})

// ─── Merchant route protection ────────────────────────────────────────────────

describe('middleware merchant route protection', () => {
  it('calls next() for a valid MERCHANT token', async () => {
    await middleware(makeReq('/merchant/dashboard', { token: validToken('MERCHANT') }))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('redirects to /auth/login when token cookie is absent', async () => {
    await middleware(makeReq('/merchant/transactions'))
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login when token has CONSUMER role', async () => {
    await middleware(makeReq('/merchant/analytics', { token: validToken('CONSUMER') }))
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login for a forged token', async () => {
    await middleware(makeReq('/merchant/dashboard', { token: forgedToken('MERCHANT') }))
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })

  it('redirects to /auth/login for an expired token', async () => {
    await middleware(makeReq('/merchant/scan', { token: expiredToken('MERCHANT') }))
    expect((mockRedirect.mock.calls[0][0] as URL).pathname).toBe('/auth/login')
  })
})

// ─── Unprotected paths ────────────────────────────────────────────────────────

describe('middleware unprotected paths', () => {
  it('calls next() for /auth/login', async () => {
    await middleware(makeReq('/auth/login'))
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('calls next() for the root path', async () => {
    await middleware(makeReq('/'))
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('calls next() for /auth/register/merchant', async () => {
    await middleware(makeReq('/auth/register/merchant'))
    expect(mockNext).toHaveBeenCalledTimes(1)
  })
})

// ─── Config export ────────────────────────────────────────────────────────────

describe('middleware config', () => {
  it('matches /admin/:path*, /consumer/:path*, and /merchant/:path*', () => {
    expect(config.matcher).toContain('/admin/:path*')
    expect(config.matcher).toContain('/consumer/:path*')
    expect(config.matcher).toContain('/merchant/:path*')
  })

  it('exports exactly three matchers', () => {
    expect(config.matcher).toHaveLength(3)
  })
})
