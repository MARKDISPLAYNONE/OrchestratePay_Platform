import { useEffect, useState } from 'react'
import { consumers } from '@/lib/api'
import { getName } from '@/lib/auth'
import Badge from '@/components/ui/Badge'
import GlassCard from '@/components/ui/GlassCard'

interface Txn { id: string; status: string; amount_cents: number; merchant_name: string; created_at: string; mpesa_receipt: string | null }

export default function ConsumerDashboard() {
  const [txns, setTxns]       = useState<Txn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [name] = useState(() => getName())

  useEffect(() => {
    consumers.getTransactions(10)
      .then(res => setTxns(res.transactions ?? []))
      .catch(() => setError('Failed to load transactions — please refresh.'))
      .finally(() => setLoading(false))
  }, [])

  const confirmed  = txns.filter(t => t.status === 'CONFIRMED')
  const totalSpent = confirmed.reduce((s, t) => s + t.amount_cents, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Hello{name ? `, ${name}` : ''}</h1>
        <p className="text-sm text-slate-500 mt-1">Here&apos;s your payment activity</p>
      </div>

      {/* Spend summary card */}
      <GlassCard glow className="p-6">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Total spent</div>
        <div className="text-4xl font-extrabold text-white">KSh {(totalSpent / 100).toLocaleString()}</div>
        <div className="text-sm text-slate-500 mt-2">{confirmed.length} confirmed payment{confirmed.length !== 1 ? 's' : ''}</div>
        <div className="mt-4 h-px" style={{ background: 'linear-gradient(90deg, rgba(0,175,255,0.4) 0%, transparent 100%)' }} />
      </GlassCard>

      {/* Recent transactions */}
      <div>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Recent payments</h2>
        {loading && <p className="text-sm text-slate-600">Loading…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="space-y-2">
          {txns.map(t => (
            <GlassCard key={t.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-200">{t.merchant_name}</div>
                <div className="text-xs text-slate-600 mt-0.5">{new Date(t.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-white">KSh {(t.amount_cents / 100).toLocaleString()}</div>
                <div className="mt-0.5"><Badge label={t.status} /></div>
              </div>
            </GlassCard>
          ))}
          {!loading && !error && txns.length === 0 && (
            <div className="text-center py-12 text-slate-600">
              <p className="text-4xl mb-3">◎</p>
              <p className="text-sm">No transactions yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
