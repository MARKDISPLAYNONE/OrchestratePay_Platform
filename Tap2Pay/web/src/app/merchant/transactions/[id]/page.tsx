'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { merchants }            from '@/lib/api'

const STATUS_COLOUR: Record<string, string> = {
  CONFIRMED: '#16a34a',
  STK_SENT:  '#2563eb',
  PENDING:   '#d97706',
  DECLINED:  '#dc2626',
  FAILED:    '#dc2626',
  EXPIRED:   '#6b7280',
}

export default function ReceiptPage() {
  const { id }    = useParams<{ id: string }>()
  const router    = useRouter()
  const [txn, setTxn]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    if (!id) return
    merchants.getTransaction(id)
      .then(setTxn)
      .catch(() => setError('Transaction not found or you do not have access to it.'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading receipt…</div>

  if (error || !txn) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={() => router.back()} className="text-sm text-blue-600 hover:underline">
          ← Back to transactions
        </button>
      </div>
    )
  }

  const colour    = STATUS_COLOUR[txn.status] ?? '#6b7280'
  const amountKsh = ((txn.amountCents ?? 0) / 100).toFixed(2)
  const isConfirmed = txn.status === 'CONFIRMED'

  return (
    <div className="p-8 max-w-lg">
      <button
        onClick={() => router.back()}
        className="text-sm text-gray-500 hover:text-gray-800 mb-6 flex items-center gap-1 transition-colors"
      >
        ← Back to transactions
      </button>

      {/* Receipt card */}
      <div id="receipt-printable" className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-xl font-bold text-gray-900">{txn.merchantName ?? '—'}</div>
          <div className="text-xs text-gray-400 mt-1">OrchestratePay Receipt</div>
        </div>

        <hr className="border-gray-100 mb-6" />

        {/* Amount + status badge */}
        <div className="text-center mb-6">
          <div className="text-5xl font-extrabold mb-3" style={{ color: colour }}>
            KSh {amountKsh}
          </div>
          <span
            className="inline-block px-3 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wide"
            style={{ backgroundColor: colour }}
          >
            {txn.status}
          </span>
        </div>

        <hr className="border-gray-100 mb-6" />

        {/* Fields */}
        <div className="space-y-3">
          {txn.mpesaRef && (
            <Row label="M-Pesa Reference" value={txn.mpesaRef} mono />
          )}
          {txn.consumerPhone && (
            <Row label="Customer Phone" value={txn.consumerPhone} />
          )}
          <Row label="Transaction ID" value={txn.txnId?.slice(0, 18) + '…'} mono />
          {txn.reason && (
            <Row label="Reason" value={txn.reason} />
          )}
        </div>

        <hr className="border-gray-100 my-6" />

        <div className="text-center space-y-1">
          <div className="text-xs text-gray-400">Powered by OrchestratePay</div>
          <div className="text-xs text-gray-300">support@orchestratepay.co.ke</div>
        </div>
      </div>

      {/* Print button — confirmed only */}
      {isConfirmed && (
        <div className="mt-6 text-center">
          <button
            onClick={() => window.print()}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
          >
            Print / Save as PDF
          </button>
        </div>
      )}

      {/* Print styles — hides everything except the receipt card */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #receipt-printable { display: block !important; }
          #receipt-printable { box-shadow: none; border: none; }
        }
      `}</style>
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-gray-900 text-right ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}
