import axios from 'axios'

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 10_000
})

// Attach JWT to every request automatically
client.interceptors.request.use(config => {
  const token = localStorage.getItem('op_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redirect to login on 401 (expired / invalid token)
client.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('op_token')
      localStorage.removeItem('op_merchant_name')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type TxnStatus = 'PENDING' | 'STK_SENT' | 'CONFIRMED' | 'DECLINED' | 'FAILED' | 'EXPIRED'

export interface MerchantProfile {
  id: string
  name: string
  phone: string
  email: string
  active: boolean
  kra_pin: string | null
  created_at: string
}

export interface Transaction {
  id: string
  status: TxnStatus
  amount_cents: number
  mpesa_receipt: string | null
  created_at: string
  confirmed_at: string | null
}

export interface TransactionDetail {
  status: TxnStatus
  txnId: string
  mpesaRef: string | null
  amountCents: number
  merchantName: string
  consumerPhone: string
  reason: string | null
}

// ─── API surface ──────────────────────────────────────────────────────────────

export const api = {
  login: (email: string, password: string) =>
    client.post<{
      token: string
      merchantId: string
      merchantName: string
      expiresAt: number
    }>('/auth/login', { email, password, deviceId: 'web-dashboard' }),

  logout: () =>
    client.post('/auth/logout'),

  getProfile: () =>
    client.get<MerchantProfile>('/merchants/me'),

  getTransactions: (limit = 25, offset = 0) =>
    client.get<{ transactions: Transaction[]; limit: number; offset: number }>(
      '/transactions', { params: { limit, offset } }
    ),

  getTransaction: (txnId: string) =>
    client.get<TransactionDetail>(`/transactions/${txnId}/status`)
}

export default client
