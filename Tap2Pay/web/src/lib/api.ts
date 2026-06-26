const BASE = import.meta.env.VITE_API_URL ?? ''

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
  if (typeof window === 'undefined') return
  sessionStorage.setItem('admin_secret', secret)
  document.cookie = 'admin_auth=1; path=/; SameSite=Strict'
}

export function clearAdminSecret() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem('admin_secret')
  document.cookie = 'admin_auth=; path=/; max-age=0; SameSite=Strict'
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
    businessType?: string; businessAddressLine1?: string; businessAddressCity?: string
    natureOfBusiness?: string; expectedMonthlyVolumeCents?: number
    beneficialOwnerName?: string; beneficialOwnerIdNumber?: string
    beneficialOwnerOwnershipPct?: number; kraPin?: string
  }) => request<{ merchantId: string; status: string }>('POST', '/api/v1/auth/register', data, { auth: false }),

  consumerRegister: (data: { phone: string; email?: string; password?: string; displayName?: string }) =>
    request<{ token: string; consumerId: string }>('POST', '/api/v1/auth/consumer/register', data, { auth: false }),

  consumerLogin: (email: string, password: string) =>
    request<{ token: string; consumerId: string }>('POST', '/api/v1/auth/consumer/login', { email, password }, { auth: false }),

  googleLogin: (credential: string, role: 'merchant' | 'consumer', phone?: string) =>
    request<
      | { token: string; merchantId?: string; merchantName?: string; consumerId?: string; role: string; expiresAt: number; refreshToken: string }
      | { needsPhone: true; email: string; displayName: string }
    >('POST', '/api/v1/auth/google', { credential, role, phone }, { auth: false }),
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

  lookupByTagId: (consumerId: string) =>
    request<{ consumerId: string; displayName: string | null; maskedPhone: string }>(
      'GET', `/api/v1/consumers/c/${consumerId}`
    ),

  requestPayment: (merchantId: string, body: { amountCents: number; idempotencyKey: string; timestamp: number; currency?: string }) =>
    request<{ transactionId: string; status: string }>(
      'POST', `/api/v1/consumers/pay/${merchantId}`, body
    ),
}

// ─── Transactions ─────────────────────────────────────────────────────────────

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
  getFleet:   () => request<any>('GET', '/api/v1/devices'),
  getDevice:  (deviceId: string) => request<any>('GET', `/api/v1/admin/fleet/${deviceId}`, undefined, { auth: false, adminAuth: true }),
  getAlerts:  () => request<any>('GET', '/api/v1/admin/fleet/alerts?unresolved', undefined, { auth: false, adminAuth: true }),
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

// ─── Settlement ───────────────────────────────────────────────────────────────

export const settlement = {
  list: (page = 1, limit = 20) =>
    request<any>('GET', `/api/v1/settlements?page=${page}&limit=${limit}`),
  get: (id: string) =>
    request<any>('GET', `/api/v1/settlements/${id}`),
  getAccount: () =>
    request<any>('GET', '/api/v1/settlements/account/me'),
  setAccount: (body: {
    accountType: 'MPESA' | 'BANK'
    mpesaPhone?: string
    bankName?: string
    accountNumber?: string
    accountName?: string
  }) => request<any>('POST', '/api/v1/settlements/account', body),
}

// ─── KYC ──────────────────────────────────────────────────────────────────────

export const kyc = {
  status: () =>
    request<any>('GET', '/api/v1/kyc/status'),
  documents: () =>
    request<any>('GET', '/api/v1/kyc/documents'),
  uploadDocument: (body: { docType: string; fileUrl: string; fileName?: string }) =>
    request<any>('POST', '/api/v1/kyc/documents', body),
  businessDetails: () =>
    request<{
      business_type?: string; business_address_line1?: string; business_address_city?: string;
      nature_of_business?: string; expected_monthly_volume_cents?: number;
      beneficial_owner_name?: string; beneficial_owner_id_number?: string;
      beneficial_owner_ownership_pct?: number; kra_pin?: string;
      sanctions_status?: string; aml_risk_level?: string;
    }>('GET', '/api/v1/kyc/business-details'),
  updateBusinessDetails: (data: {
    businessType?: string; businessAddressLine1?: string; businessAddressCity?: string;
    natureOfBusiness?: string; expectedMonthlyVolumeCents?: number;
    beneficialOwnerName?: string; beneficialOwnerIdNumber?: string;
    beneficialOwnerOwnershipPct?: number; kraPin?: string;
  }) => request<Record<string, unknown>>('PUT', '/api/v1/kyc/business-details', data),
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export function verifyAdminSecret(secret: string) {
  return request<any>('GET', '/api/v1/admin/stats', undefined, {
    auth: false,
    adminAuth: false,
    extraHeaders: { 'X-Admin-Secret': secret },
  })
}

export const admin = {
  getStats: () =>
    request<any>('GET', '/api/v1/admin/stats', undefined, { auth: false, adminAuth: true }),
  getPendingMerchants: () =>
    request<any>('GET', '/api/v1/auth/admin/pending', undefined, { auth: false, adminAuth: true }),
  approveMerchant: (merchantId: string, action: string, notes?: string) =>
    request<any>('POST', `/api/v1/auth/admin/approve/${merchantId}`, { action, notes }, { auth: false, adminAuth: true }),
  getAllMerchants: () =>
    request<any>('GET', '/api/v1/admin/merchants', undefined, { auth: false, adminAuth: true }),
  getConsumers: () =>
    request<any>('GET', '/api/v1/admin/consumers', undefined, { auth: false, adminAuth: true }),
  getFleet: () =>
    request<any>('GET', '/api/v1/admin/fleet', undefined, { auth: false, adminAuth: true }),
  getFleetAlerts: () =>
    request<any>('GET', '/api/v1/admin/fleet/alerts?unresolved', undefined, { auth: false, adminAuth: true }),
  amlFlags: (status?: string) =>
    request<Array<{
      id: string; flag_type: string; status: string; details: Record<string, unknown>;
      created_at: string; merchant_name?: string; merchant_email?: string;
    }>>('GET', `/api/v1/admin/aml/flags${status ? `?status=${status}` : ''}`, undefined, { adminAuth: true }),
  updateAmlFlag: (flagId: string, data: { status: string; reviewedBy?: string; notes?: string }) =>
    request<{ id: string; status: string }>('PATCH', `/api/v1/admin/aml/flags/${flagId}`, data, { adminAuth: true }),
  screenMerchant: (merchantId: string) =>
    request<{ status: string; matches: string[]; riskLevel: string; reasons: string[] }>(
      'POST', `/api/v1/admin/kyc/${merchantId}/screen`, {}, { adminAuth: true }
    ),
}
