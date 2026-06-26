import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { merchants } from '@/lib/api'
import Badge from '@/components/ui/Badge'
import GlassCard from '@/components/ui/GlassCard'

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span className="text-sm text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-slate-200 text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

export default function TransactionDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const [txn, setTxn]         = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!id) return
    merchants.getTransaction(id)
      .then(setTxn)
      .catch(() => setError('Transaction not found or you do not have access.'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-slate-500 text-sm py-12 text-center">Loading receipt…</div>

  if (error || !txn) {
    return (
      <div className="py-12 text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <button onClick={() => navigate(-1)} className="text-sm text-electric hover:text-neon transition-colors">← Back</button>
      </div>
    )
  }

  const amountKsh = ((txn.amountCents ?? 0) / 100).toFixed(2)
  const isConfirmed = txn.status === 'CONFIRMED'

  return (
    <div className="max-w-lg">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 mb-6 transition-colors">
        ← Back to transactions
      </button>

      <div id="receipt-printable">
        <GlassCard className="p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <img src="/icons/Icon.png" alt="OrchestratePay" className="w-12 h-12 rounded-xl mx-auto mb-3" />
            <div className="text-lg font-bold text-white">{txn.merchantName ?? '—'}</div>
            <div className="text-xs text-slate-600 mt-1">OrchestratePay Receipt</div>
          </div>

          <div className="divider-blue mb-6" />

          {/* Amount + status */}
          <div className="text-center mb-6">
            <div className="text-5xl font-extrabold text-white mb-3">KSh {amountKsh}</div>
            <Badge label={txn.status} />
          </div>

          <div className="divider-blue mb-6" />

          {/* Fields */}
          <div>
            {txn.mpesaRef      && <Row label="M-Pesa Reference"   value={txn.mpesaRef} mono />}
            {txn.consumerPhone && <Row label="Customer Phone"      value={txn.consumerPhone} />}
            <Row label="Transaction ID" value={(txn.txnId ?? '').slice(0, 18) + '…'} mono />
            {txn.reason        && <Row label="Reason"             value={txn.reason} />}
          </div>

          <div className="divider-blue my-6" />
          <div className="text-center">
            <div className="text-xs text-slate-600">Powered by OrchestratePay</div>
            <div className="text-xs text-slate-700 mt-1">support@orchestratepay.co.ke</div>
          </div>
        </GlassCard>
      </div>

      {isConfirmed && (
        <div className="mt-6 text-center">
          <button onClick={() => window.print()} className="btn-primary px-8 py-2.5">
            Print / Save as PDF
          </button>
        </div>
      )}
    </div>
  )
}
