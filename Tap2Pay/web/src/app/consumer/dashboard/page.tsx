'use client'
import { useEffect, useState } from 'react'
import { consumers }           from '@/lib/api'
import { getName }             from '@/lib/auth'

interface Txn {
  id: string; status: string; amount_cents: number
  original_currency: string | null; mpesa_receipt: string | null
  merchant_name: string; created_at: string
}

export default function ConsumerDashboard() {
  const [txns, setTxns]       = useState<Txn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [name, setName]       = useState<string | null>(null)

  useEffect(() => {
    setName(getName())
    consumers.getTransactions(10)
      .then(res => setTxns(res.transactions ?? []))
      .catch(() => setError('Failed to load transactions — please refresh.'))
      .finally(() => setLoading(false))
  }, [])

  const confirmed   = txns.filter(t => t.status === 'CONFIRMED')
  const totalSpent  = confirmed.reduce((s, t) => s + t.amount_cents, 0)

  return (
    <div className="py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hello{name ? `, ${name}` : ''}
        </h1>
        <p className="text-gray-500 text-sm">Here&apos;s your payment activity</p>
      </div>

      {/* Summary card */}
      <div className="bg-green-600 text-white rounded-2xl p-6">
        <div className="text-sm font-medium opacity-80 mb-1">Total spent</div>
        <div className="text-3xl font-bold">KSh {(totalSpent / 100).toLocaleString()}</div>
        <div className="text-sm opacity-70 mt-1">{confirmed.length} confirmed payments</div>
      </div>

      {/* Recent transactions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent payments</h2>
        {loading && <p className="text-sm text-gray-400">Loading…</p>}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <div className="space-y-2">
          {txns.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-800">{t.merchant_name}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {new Date(t.created_at).toLocaleDateString('en-KE', {
                    day: 'numeric', month: 'short', year: 'numeric'
                  })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-gray-900">
                  KSh {(t.amount_cents / 100).toLocaleString()}
                </div>
                <div className={`text-xs mt-0.5 ${t.status === 'CONFIRMED' ? 'text-green-600' : 'text-gray-400'}`}>
                  {t.status}
                </div>
              </div>
            </div>
          ))}
          {!loading && !error && txns.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No transactions yet</p>
          )}
        </div>
      </div>
    </div>
  )
}
