/**
 * lib/auth.ts — Client-side auth state management.
 *
 * Stores the JWT in sessionStorage (cleared on tab close) for merchants and
 * admins. Consumers can choose localStorage (persistent) at login.
 *
 * Role is extracted from the JWT payload without re-verifying the signature
 * (server verifies on every API call — client just needs to know the role
 * to show the right portal).
 */

export type Role = 'MERCHANT' | 'CONSUMER' | 'ADMIN' | null

interface TokenPayload {
  sub:   string
  name:  string
  role?: Role
  exp:   number
}

function decode(token: string): TokenPayload | null {
  try {
    const [, payload] = token.split('.')
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export function saveToken(token: string, persistent = false) {
  if (persistent) {
    localStorage.setItem('token', token)
    sessionStorage.removeItem('token')
  } else {
    sessionStorage.setItem('token', token)
    localStorage.removeItem('token')
  }
}

export function clearToken() {
  sessionStorage.removeItem('token')
  localStorage.removeItem('token')
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem('token') ?? localStorage.getItem('token')
}

export function getRole(): Role {
  const token = getToken()
  if (!token) return null
  const payload = decode(token)
  if (!payload) return null
  if (payload.exp * 1000 < Date.now()) {
    clearToken()
    return null
  }
  return payload.role ?? 'MERCHANT'  // legacy tokens without role are MERCHANT
}

export function getSubject(): string | null {
  const token = getToken()
  if (!token) return null
  const payload = decode(token)
  return payload?.sub ?? null
}

export function getName(): string | null {
  const token = getToken()
  if (!token) return null
  const payload = decode(token)
  return payload?.name ?? null
}

export function isLoggedIn(): boolean {
  return getRole() !== null
}

/** Returns the dashboard path for the current role. */
export function dashboardPath(): string {
  const role = getRole()
  if (role === 'MERCHANT') return '/merchant/dashboard'
  if (role === 'CONSUMER') return '/consumer/dashboard'
  if (role === 'ADMIN')    return '/admin/fleet'
  return '/auth/login'
}
