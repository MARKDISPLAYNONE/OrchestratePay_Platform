'use client'
import { useEffect, useState } from 'react'
import { useRouter }           from 'next/navigation'
import { merchants }           from '@/lib/api'

interface Txn {
  id: string; status: string; amount_cents: number
  mpesa_receipt: string | null; source: string; created_at: string
}

const PAGE_SIZE = 25

const STATUS_COLOURS: Record<string, string> = {
  CONFIRMED: 'text-green-700 bg-green-50',
  DECLINED:  'text-red-700 bg-red-50',
  FAILED:    'text-red-700 bg-red-50',
  STK_SENT:  'text-yellow-700 bg-yellow-50',
  PENDING:   'text-gray-600 bg-gray-100',
  EXPIRED:   'text-gray-500 bg-gray-100',
}

export default function TransactionsPage() {
  const router = useRouter()
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
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Transactions</h1>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-5 py-3 text-left">Time</th>
              <th className="px-5 py-3 text-left">Amount</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">Source</th>
              <th className="px-5 py-3 text-left">M-Pesa Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {!loading && txns.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No transactions yet</td></tr>
            )}
            {txns.map(t => (
              <tr
                key={t.id}
                onClick={() => router.push(`/merchant/transactions/${t.id}`)}
                className="hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <td className="px-5 py-3 text-gray-500">
                  {new Date(t.created_at).toLocaleString('en-KE', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                  })}
                </td>
                <td className="px-5 py-3 font-semibold text-gray-900">
                  KSh {(t.amount_cents / 100).toLocaleString()}
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOURS[t.status] ?? 'text-gray-600 bg-gray-100'}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-500">{t.source}</td>
                <td className="px-5 py-3 font-mono text-xs text-gray-500">
                  {t.mpesa_receipt ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-gray-400">
          {txns.length > 0 ? `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + txns.length}` : ''}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-500 px-1">Page {page + 1}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={txns.length < PAGE_SIZE}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}
