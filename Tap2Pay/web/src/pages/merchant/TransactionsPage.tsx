import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { merchants } from '@/lib/api'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

interface Txn { id: string; status: string; amount_cents: number; mpesa_receipt: string | null; source: string; created_at: string }
const PAGE_SIZE = 25

export default function TransactionsPage() {
  const navigate = useNavigate()
  const [txns, setTxns]       = useState<Txn[]>([])
  const [page, setPage]       = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    setLoading(true)
    merchants.getTransactions(PAGE_SIZE, page * PAGE_SIZE)
      .then(res => setTxns(res.transactions ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [page])

  return (
    <div>
      <PageHeader title="Transactions" />
      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <GlassCard className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,175,255,0.08)' }}>
              {['Time', 'Amount', 'Status', 'Source', 'M-Pesa Ref'].map(h => (
                <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-600">Loading…</td></tr>}
            {!loading && txns.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-600">No transactions yet</td></tr>}
            {txns.map(t => (
              <tr key={t.id} onClick={() => navigate(`/merchant/transactions/${t.id}`)} className="table-row-dark">
                <td className="px-5 py-3.5 text-slate-500">
                  {new Date(t.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-5 py-3.5 font-semibold text-white">KSh {(t.amount_cents / 100).toLocaleString()}</td>
                <td className="px-5 py-3.5"><Badge label={t.status} /></td>
                <td className="px-5 py-3.5 text-slate-500">{t.source}</td>
                <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{t.mpesa_receipt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>

      <div className="flex items-center justify-between mt-4 px-1">
        <p className="text-xs text-slate-600">
          {txns.length > 0 && `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + txns.length}`}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-30">← Previous</button>
          <span className="text-xs text-slate-500 px-2">Page {page + 1}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={txns.length < PAGE_SIZE}
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-30">Next →</button>
        </div>
      </div>
    </div>
  )
}
