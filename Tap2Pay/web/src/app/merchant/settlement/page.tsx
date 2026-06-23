'use client'
import { useCallback, useEffect, useState } from 'react'
import { settlement as api } from '@/lib/api'

type AccountType = 'MPESA' | 'BANK'

interface SettlementAccount {
  accountType: AccountType
  mpesaPhone?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
}

interface Settlement {
  id: string
  periodStart: string
  periodEnd:   string
  grossAmountCents: number
  feeCents:         number
  netAmountCents:   number
  transactionCount: number
  status:       string
  payoutMethod: string
  b2cReceipt?:  string
  settledAt?:   string
  createdAt:    string
}

const STATUS_COLOR: Record<string, string> = {
  COMPLETED:  'bg-green-100 text-green-800',
  PENDING:    'bg-yellow-100 text-yellow-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  FAILED:     'bg-red-100 text-red-800',
  NO_ACCOUNT: 'bg-gray-100 text-gray-700',
}

function fmt(cents: number) {
  return `KSh ${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function SettlementPage() {
  const [settlements,  setSettlements]  = useState<Settlement[]>([])
  const [account,      setAccount]      = useState<SettlementAccount | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [success,      setSuccess]      = useState('')
  const [page,         setPage]         = useState(1)
  const [total,        setTotal]        = useState(0)
  const [accountType,  setAccountType]  = useState<AccountType>('MPESA')
  const [mpesaPhone,   setMpesaPhone]   = useState('')
  const [bankName,     setBankName]     = useState('')
  const [accountNum,   setAccountNum]   = useState('')
  const [accountName,  setAccountName]  = useState('')

  const LIMIT = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settData, accData] = await Promise.all([
        api.list(page, LIMIT),
        api.getAccount().catch(() => null),
      ])
      setSettlements(settData.settlements ?? [])
      setTotal(settData.total ?? 0)
      if (accData) {
        setAccount(accData)
        setAccountType(accData.accountType)
        setMpesaPhone(accData.mpesaPhone ?? '')
        setBankName(accData.bankName ?? '')
        setAccountNum(accData.accountNumber ?? '')
        setAccountName(accData.accountName ?? '')
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load settlement data')
    }
    setLoading(false)
  }, [page])

  useEffect(() => { load() }, [page, load])

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await api.setAccount({
        accountType,
        mpesaPhone:    accountType === 'MPESA' ? mpesaPhone : undefined,
        bankName:      accountType === 'BANK'  ? bankName   : undefined,
        accountNumber: accountType === 'BANK'  ? accountNum : undefined,
        accountName:   accountType === 'BANK'  ? accountName: undefined,
      })
      setSuccess('Settlement account saved successfully.')
      await load()
    } catch (err: any) {
      setError(err.message ?? 'Failed to save account')
    }
    setSaving(false)
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold text-gray-900">Settlement</h1>

      {/* Payout account setup */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Payout Account</h2>
        {account && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
            Current: {account.accountType === 'MPESA'
              ? `M-Pesa ${account.mpesaPhone}`
              : `${account.bankName} — ${account.accountNumber}`}
          </div>
        )}
        <form onSubmit={handleSaveAccount} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account type</label>
            <select
              value={accountType}
              onChange={e => setAccountType(e.target.value as AccountType)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank account</option>
            </select>
          </div>

          {accountType === 'MPESA' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Safaricom phone number</label>
              <input
                type="tel" placeholder="07XXXXXXXX or 254XXXXXXXXX"
                value={mpesaPhone}
                onChange={e => setMpesaPhone(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}

          {accountType === 'BANK' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank name</label>
                <input
                  type="text" placeholder="e.g. Equity Bank"
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account number</label>
                <input
                  type="text" placeholder="Account number"
                  value={accountNum}
                  onChange={e => setAccountNum(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account name</label>
                <input
                  type="text" placeholder="Name on account"
                  value={accountName}
                  onChange={e => setAccountName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </>
          )}

          {error   && <p className="text-red-600 text-sm">{error}</p>}
          {success && <p className="text-green-600 text-sm">{success}</p>}

          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save payout account'}
          </button>
        </form>
      </section>

      {/* Settlement history */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Settlement History</h2>

        {loading ? (
          <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>
        ) : settlements.length === 0 ? (
          <div className="text-gray-400 text-sm py-8 text-center">
            No settlements yet. Settlements run nightly once your payout account is set.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="pb-2 pr-4">Period</th>
                    <th className="pb-2 pr-4 text-right">Gross</th>
                    <th className="pb-2 pr-4 text-right">Fee</th>
                    <th className="pb-2 pr-4 text-right">Net</th>
                    <th className="pb-2 pr-4">Txns</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {settlements.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(s.grossAmountCents)}</td>
                      <td className="py-2 pr-4 text-right font-mono text-red-600">−{fmt(s.feeCents)}</td>
                      <td className="py-2 pr-4 text-right font-mono font-semibold">{fmt(s.netAmountCents)}</td>
                      <td className="py-2 pr-4">{s.transactionCount}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[s.status] ?? 'bg-gray-100'}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {total > LIMIT && (
              <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
                <span>{total} total settlements</span>
                <div className="flex gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40"
                  >Previous</button>
                  <button
                    disabled={page * LIMIT >= total}
                    onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40"
                  >Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
