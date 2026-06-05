/**
 * lib/api.ts — Typed API client for the OrchestratePay backend.
 *
 * Uses native fetch. The base URL is configured via NEXT_PUBLIC_API_URL.
 * The JWT token is read from sessionStorage (web sessions) or localStorage.
 *
 * All methods throw ApiError on non-2xx responses so callers can catch and
 * display user-facing error messages.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem('token') ?? localStorage.getItem('token')
}

function getAdminSecret(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem('admin_secret')
}

export function saveAdminSecret(secret: string) {
  if (typeof window !== 'undefined') sessionStorage.setItem('admin_secret', secret)
}

export function clearAdminSecret() {
  if (typeof window !== 'undefined') sessionStorage.removeItem('admin_secret')
}

export function hasAdminSecret(): boolean {
  return !!getAdminSecret()
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { auth?: boolean; contentType?: string; adminAuth?: boolean; extraHeaders?: Record<string, string> }
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': opts?.contentType ?? 'application/json',
    ...opts?.extraHeaders,
  }

  if (opts?.auth !== false) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  if (opts?.adminAuth) {
    const secret = getAdminSecret()
    if (secret) headers['X-Admin-Secret'] = secret
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as any
    throw new ApiError(res.status, err.error ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  merchantLogin: (email: string, password: string, deviceId: string) =>
    request<{ token: string; merchantId: string; merchantName: string; expiresAt: number }>(
      'POST', '/api/v1/auth/login', { email, password, deviceId }
    ),

  merchantRegister: (data: {
    name: string; email: string; password: string; phone: string
    businessRegNumber?: string; mpesaShortcode?: string
  }) => request<{ merchantId: string; status: string }>('POST', '/api/v1/auth/register', data, { auth: false }),

  consumerRegister: (data: { phone: string; email?: string; password?: string; displayName?: string }) =>
    request<{ token: string; consumerId: string }>('POST', '/api/v1/auth/consumer/register', data, { auth: false }),

  consumerLogin: (email: string, password: string) =>
    request<{ token: string; consumerId: string }>('POST', '/api/v1/auth/consumer/login', { email, password }, { auth: false }),
}

// ─── Merchant ─────────────────────────────────────────────────────────────────

export const merchants = {
  getProfile:      () => request<any>('GET', '/api/v1/merchants/me'),
  updateProfile:   (data: { name?: string; phone?: string; mpesaShortcode?: string; mpesaAccountRef?: string; kraPin?: string }) =>
    request<any>('PUT', '/api/v1/merchants/me', data),
  getWeekly:       () => request<any>('GET', '/api/v1/merchants/me/analytics/weekly'),
  getPeakHours:    () => request<any>('GET', '/api/v1/merchants/me/analytics/peak-hours'),
  getSources:      () => request<any>('GET', '/api/v1/merchants/me/analytics/sources'),
  getTransactions: (limit = 25, offset = 0) =>
    request<any>('GET', `/api/v1/transactions?limit=${limit}&offset=${offset}`),
  getTransaction:  (txnId: string) =>
    request<any>('GET', `/api/v1/transactions/${txnId}/status`),
  getLoyaltyProgramme: () => request<any>('GET', '/api/v1/loyalty/programme'),
  saveLoyaltyProgramme: (data: {
    programme_type: string; points_per_ksh?: number
    stamps_for_reward?: number; reward_description?: string
  }) => request<any>('POST', '/api/v1/loyalty/programme', data),
}

// ─── Consumer ─────────────────────────────────────────────────────────────────

export const consumers = {
  getProfile:      () => request<any>('GET', '/api/v1/consumers/me'),
  updateProfile:   (data: { displayName?: string; smsOptIn?: boolean }) =>
    request<any>('PUT', '/api/v1/consumers/me', data),
  getTransactions: (limit = 50, offset = 0) =>
    request<any>('GET', `/api/v1/consumers/me/transactions?limit=${limit}&offset=${offset}`),
  getLoyalty:      () => request<any>('GET', '/api/v1/consumers/me/loyalty'),
  getMerchantForPay: (merchantId: string) =>
    request<any>('GET', `/api/v1/consumers/pay/${merchantId}`, undefined, { auth: false }),

  // Merchant-auth: look up a consumer by ID from their self-written NFC tag
  lookupByTagId: (consumerId: string) =>
    request<{ consumerId: string; displayName: string | null; maskedPhone: string }>(
      'GET', `/api/v1/consumers/c/${consumerId}`
    ),

  requestPayment: (merchantId: string, body: { amountCents: number; idempotencyKey: string; timestamp: number; currency?: string }) =>
    request<{ transactionId: string; status: string }>(
      'POST', `/api/v1/consumers/pay/${merchantId}`, body
    ),
}

// ─── Transactions (merchant-initiated) ────────────────────────────────────────

export const transactions = {
  initiate: (body: {
    merchantId:    string
    amountCents:   number
    source:        string
    idempotencyKey: string
    timestamp:     number
    consumerTagId?: string
    tagId?:        string
  }) => request<{ status: string; txnId: string }>('POST', '/api/v1/transactions', body),

  getStatus: (txnId: string) =>
    request<{ status: string; txnId: string; mpesaRef?: string; amountCents?: number; reason?: string }>(
      'GET', `/api/v1/transactions/${txnId}/status`
    ),
}

// ─── FX Rates ─────────────────────────────────────────────────────────────────

export const fx = {
  getRates: () => request<any>('GET', '/api/v1/fx/rates', undefined, { auth: false }),
}

// ─── Devices / Fleet ──────────────────────────────────────────────────────────

export const devices = {
  getFleet:   () => request<any>('GET', '/api/v1/admin/fleet'),
  getDevice:  (deviceId: string) => request<any>('GET', `/api/v1/admin/fleet/${deviceId}`),
  getAlerts:  () => request<any>('GET', '/api/v1/admin/fleet/alerts?unresolved'),
}

// ─── Accounting ───────────────────────────────────────────────────────────────

export const accounting = {
  getIntegrations: () => request<any>('GET', '/api/v1/accounting/integrations'),
  connect: (platform: string, data: any) =>
    request<any>('POST', `/api/v1/accounting/integrations/${platform}/connect`, data),
  disconnect: (platform: string) =>
    request<any>('DELETE', `/api/v1/accounting/integrations/${platform}`),
  getPostings: (status?: string, limit = 50) =>
    request<any>('GET', `/api/v1/accounting/gl-postings?limit=${limit}${status ? `&status=${status}` : ''}`),
  retryPosting: (id: string) =>
    request<any>('POST', `/api/v1/accounting/gl-postings/${id}/retry`),
}

// ─── Loyalty ──────────────────────────────────────────────────────────────────

export const loyalty = {
  getProgramme: () => request<any>('GET', '/api/v1/loyalty/programme'),
  getBalance:   () => request<any>('GET', '/api/v1/loyalty/balance'),
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export const admin = {
  getStats: () =>
    request<any>('GET', '/api/v1/admin/stats', undefined, { auth: false, adminAuth: true }),

  getPendingMerchants: () =>
    request<any>('GET', '/api/v1/auth/admin/pending', undefined, { auth: false, adminAuth: true }),

  approveMerchant: (merchantId: string, action: string, notes?: string) =>
    request<any>('POST', `/api/v1/auth/admin/approve/${merchantId}`, { action, notes }, { auth: false, adminAuth: true }),

  getFleet: () =>
    request<any>('GET', '/api/v1/admin/fleet', undefined, { auth: false, adminAuth: true }),

  getFleetAlerts: () =>
    request<any>('GET', '/api/v1/admin/fleet/alerts?unresolved', undefined, { auth: false, adminAuth: true }),
}
