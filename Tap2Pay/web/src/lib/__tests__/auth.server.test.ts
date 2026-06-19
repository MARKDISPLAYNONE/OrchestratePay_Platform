/**
 * @jest-environment node
 *
 * Tests for lib/auth.ts that require a Node (non-browser) environment.
 *
 * In jsdom, `typeof window` is always 'object', so the SSR guard branches
 * (`if (typeof window === 'undefined') return null`) can never be taken.
 * Running these tests in a Node environment covers those branches.
 */

import { getToken } from '../auth'

describe('getToken SSR guard', () => {
  it('returns null when window is undefined (server-side render)', () => {
    // In @jest-environment node, typeof window === 'undefined'
    expect(typeof window).toBe('undefined')
    expect(getToken()).toBeNull()
  })
})
