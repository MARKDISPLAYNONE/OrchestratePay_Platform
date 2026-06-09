/**
 * Tests for lib/auth.ts — client-side JWT state management.
 *
 * jsdom provides in-memory localStorage and sessionStorage so we can test
 * the storage strategy without mocking. Each test starts from a clean state.
 */

import {
  saveToken, clearToken, getToken,
  getRole, getSubject, getName, isLoggedIn, dashboardPath,
} from '../auth'

// ─── Test helpers ────────────────────────────────────────────────────────────

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function makeToken(payload: {
  sub?: string; name?: string; role?: string; exp?: number
}): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const body   = b64url({
    sub:  payload.sub  ?? 'user-1',
    name: payload.name ?? 'Test User',
    role: payload.role ?? 'MERCHANT',
    exp:  payload.exp  ?? Math.floor(Date.now() / 1000) + 3600,
  })
  return `${header}.${body}.fakesig`
}

function futureExp()  { return Math.floor(Date.now() / 1000) + 3600 }
function expiredExp() { return Math.floor(Date.now() / 1000) - 1    }

// ─── Setup/teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

// ─── saveToken ────────────────────────────────────────────────────────────────

describe('saveToken', () => {
  it('stores in sessionStorage by default', () => {
    saveToken('my.token')
    expect(sessionStorage.getItem('token')).toBe('my.token')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('stores in localStorage when persistent = true', () => {
    saveToken('my.token', true)
    expect(localStorage.getItem('token')).toBe('my.token')
    expect(sessionStorage.getItem('token')).toBeNull()
  })

  it('removes sessionStorage copy when saving persistently', () => {
    sessionStorage.setItem('token', 'old-session-token')
    saveToken('new.token', true)
    expect(sessionStorage.getItem('token')).toBeNull()
  })

  it('removes localStorage copy when saving to session', () => {
    localStorage.setItem('token', 'old-local-token')
    saveToken('new.token', false)
    expect(localStorage.getItem('token')).toBeNull()
  })
})

// ─── clearToken ───────────────────────────────────────────────────────────────

describe('clearToken', () => {
  it('removes token from sessionStorage', () => {
    sessionStorage.setItem('token', 'tok')
    clearToken()
    expect(sessionStorage.getItem('token')).toBeNull()
  })

  it('removes token from localStorage', () => {
    localStorage.setItem('token', 'tok')
    clearToken()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('clears both storages at once', () => {
    sessionStorage.setItem('token', 'a')
    localStorage.setItem('token', 'b')
    clearToken()
    expect(sessionStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('is safe to call with no token stored', () => {
    expect(() => clearToken()).not.toThrow()
  })
})

// ─── getToken ─────────────────────────────────────────────────────────────────

describe('getToken', () => {
  it('returns null when nothing is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('returns sessionStorage token if present', () => {
    sessionStorage.setItem('token', 'session-tok')
    expect(getToken()).toBe('session-tok')
  })

  it('falls back to localStorage when session is empty', () => {
    localStorage.setItem('token', 'local-tok')
    expect(getToken()).toBe('local-tok')
  })

  it('prefers sessionStorage over localStorage', () => {
    sessionStorage.setItem('token', 'session-tok')
    localStorage.setItem('token', 'local-tok')
    expect(getToken()).toBe('session-tok')
  })
})

// ─── getRole ──────────────────────────────────────────────────────────────────

describe('getRole', () => {
  it('returns null when no token is stored', () => {
    expect(getRole()).toBeNull()
  })

  it('returns MERCHANT for a merchant token', () => {
    saveToken(makeToken({ role: 'MERCHANT' }))
    expect(getRole()).toBe('MERCHANT')
  })

  it('returns CONSUMER for a consumer token', () => {
    saveToken(makeToken({ role: 'CONSUMER' }))
    expect(getRole()).toBe('CONSUMER')
  })

  it('returns ADMIN for an admin token', () => {
    saveToken(makeToken({ role: 'ADMIN' }))
    expect(getRole()).toBe('ADMIN')
  })

  it('defaults to MERCHANT for legacy tokens without a role field', () => {
    const header = b64url({ alg: 'HS256' })
    const body   = b64url({ sub: 'mid', name: 'Old Merchant', exp: futureExp() })
    saveToken(`${header}.${body}.sig`)
    expect(getRole()).toBe('MERCHANT')
  })

  it('returns null and clears token for an expired token', () => {
    saveToken(makeToken({ exp: expiredExp() }))
    expect(getRole()).toBeNull()
    expect(getToken()).toBeNull()
  })

  it('clears token from both storages on expiry', () => {
    localStorage.setItem('token', makeToken({ exp: expiredExp() }))
    getRole()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('returns null for a malformed token', () => {
    saveToken('not.a.jwt')
    expect(getRole()).toBeNull()
  })
})

// ─── getSubject ───────────────────────────────────────────────────────────────

describe('getSubject', () => {
  it('returns null when no token is stored', () => {
    expect(getSubject()).toBeNull()
  })

  it('returns the sub claim from the token', () => {
    saveToken(makeToken({ sub: 'merchant-abc-123' }))
    expect(getSubject()).toBe('merchant-abc-123')
  })

  it('returns null when the token payload has no sub field', () => {
    // Token with valid JSON payload but no sub claim
    const header = b64url({ alg: 'HS256' })
    const body   = b64url({ name: 'Test', role: 'MERCHANT', exp: futureExp() }) // no sub
    saveToken(`${header}.${body}.sig`)
    expect(getSubject()).toBeNull()
  })
})

// ─── getName ──────────────────────────────────────────────────────────────────

describe('getName', () => {
  it('returns null when no token is stored', () => {
    expect(getName()).toBeNull()
  })

  it('returns the name claim from the token', () => {
    saveToken(makeToken({ name: 'Wanjiku Groceries' }))
    expect(getName()).toBe('Wanjiku Groceries')
  })

  it('returns null when the token payload has no name field', () => {
    // Token with valid JSON payload but no name claim
    const header = b64url({ alg: 'HS256' })
    const body   = b64url({ sub: 'mid-1', role: 'MERCHANT', exp: futureExp() }) // no name
    saveToken(`${header}.${body}.sig`)
    expect(getName()).toBeNull()
  })
})

// ─── isLoggedIn ───────────────────────────────────────────────────────────────

describe('isLoggedIn', () => {
  it('returns false when no token is stored', () => {
    expect(isLoggedIn()).toBe(false)
  })

  it('returns true for a valid, non-expired token', () => {
    saveToken(makeToken({}))
    expect(isLoggedIn()).toBe(true)
  })

  it('returns false for an expired token', () => {
    saveToken(makeToken({ exp: expiredExp() }))
    expect(isLoggedIn()).toBe(false)
  })
})

// ─── dashboardPath ────────────────────────────────────────────────────────────

describe('dashboardPath', () => {
  it('returns /auth/login when not logged in', () => {
    expect(dashboardPath()).toBe('/auth/login')
  })

  it('returns /merchant/dashboard for a merchant', () => {
    saveToken(makeToken({ role: 'MERCHANT' }))
    expect(dashboardPath()).toBe('/merchant/dashboard')
  })

  it('returns /consumer/dashboard for a consumer', () => {
    saveToken(makeToken({ role: 'CONSUMER' }))
    expect(dashboardPath()).toBe('/consumer/dashboard')
  })

  it('returns /admin/fleet for an admin', () => {
    saveToken(makeToken({ role: 'ADMIN' }))
    expect(dashboardPath()).toBe('/admin/fleet')
  })
})
