/**
 * @jest-environment node
 *
 * Tests for lib/api.ts that require a Node (non-browser) environment.
 *
 * In jsdom, `typeof window` is always 'object', so the SSR guard branches
 * (`if (typeof window === 'undefined') return`) can never be taken.
 * Running these tests in Node covers those branches for saveAdminSecret,
 * clearAdminSecret, hasAdminSecret, and the private getToken() (reached
 * via public API methods that internally call request()).
 */

import { saveAdminSecret, clearAdminSecret, hasAdminSecret, auth } from '../api'

beforeEach(() => {
  // Mock the global fetch so request() can complete in Node environment
  ;(global as any).fetch = jest.fn().mockResolvedValue({
    ok:     true,
    status: 200,
    json:   () => Promise.resolve({}),
  })
})

afterEach(() => {
  delete (global as any).fetch
})

describe('api SSR guards (no window)', () => {
  it('typeof window is undefined in this environment', () => {
    expect(typeof window).toBe('undefined')
  })

  it('saveAdminSecret returns early without throwing', () => {
    expect(() => saveAdminSecret('secret')).not.toThrow()
  })

  it('clearAdminSecret returns early without throwing', () => {
    expect(() => clearAdminSecret()).not.toThrow()
  })

  it('hasAdminSecret returns false (getAdminSecret hits SSR guard)', () => {
    expect(hasAdminSecret()).toBe(false)
  })

  it('getToken() SSR guard: request() omits Authorization when window is undefined', async () => {
    // auth.merchantLogin → request() → getToken() → typeof window === 'undefined' → null
    // So no Authorization header is sent — covers the true branch of the SSR guard.
    await auth.merchantLogin('test@test.com', 'pass', 'dev')
    const headers = ((global as any).fetch as jest.Mock).mock.calls[0][1].headers
    expect(headers['Authorization']).toBeUndefined()
  })
})
