import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, TransactionDetail, TxnStatus } from '../api/client'

const STATUS_COLOR: Record<TxnStatus, string> = {
  CONFIRMED: '#10b981',
  STK_SENT:  '#3b82f6',
  PENDING:   '#f59e0b',
  DECLINED:  '#ef4444',
  FAILED:    '#dc2626',
  EXPIRED:   '#6b7280'
}

export default function ReceiptPage() {
  const { txnId } = useParams<{ txnId: string }>()
  const [txn, setTxn] = useState<TransactionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!txnId) return
    api.getTransaction(txnId)
      .then(res => setTxn(res.data))
      .catch(() => setError('Transaction not found or you do not have access to it.'))
      .finally(() => setLoading(false))
  }, [txnId])

  if (loading) return <p style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>Loading…</p>
  if (error || !txn) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <p style={{ color: '#dc2626', marginBottom: 16 }}>{error}</p>
      <button onClick={() => navigate('/dashboard')} style={backBtn}>← Back to Dashboard</button>
    </div>
  )

  const amountKsh = (txn.amountCents / 100).toFixed(2)
  const isConfirmed = txn.status === 'CONFIRMED'

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa', padding: 32 }}>
      <button onClick={() => navigate('/dashboard')} style={backBtn}>
        ← Back to Dashboard
      </button>

      {/* Receipt card — this area is isolated for print */}
      <div
        id="receipt-printable"
        style={{
          maxWidth: 480, margin: '24px auto', background: '#fff',
          borderRadius: 12, padding: 40, boxShadow: '0 4px 24px rgba(0,0,0,0.08)'
        }}
      >
        <h1 style={{ textAlign: 'center', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          {txn.merchantName}
        </h1>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginBottom: 28 }}>
          OrchestratePay Receipt
        </p>

        <hr style={{ borderColor: '#e5e7eb', marginBottom: 28 }} />

        {/* Amount + status */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <p style={{ fontSize: 44, fontWeight: 800, color: STATUS_COLOR[txn.status], lineHeight: 1, marginBottom: 12 }}>
            KSh {amountKsh}
          </p>
          <span style={{
            display: 'inline-block', padding: '4px 14px', borderRadius: 99,
            background: STATUS_COLOR[txn.status], color: '#fff',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase'
          }}>
            {txn.status}
          </span>
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {txn.mpesaRef    && <Row label="M-Pesa Reference"  value={txn.mpesaRef}    mono />}
          {txn.consumerPhone && <Row label="Customer Phone"  value={txn.consumerPhone} />}
          <Row label="Transaction ID" value={txn.txnId.slice(0, 18) + '…'} mono />
          {txn.reason      && <Row label="Reason"           value={txn.reason} />}
        </div>

        <hr style={{ borderColor: '#e5e7eb', margin: '28px 0 20px' }} />

        <p style={{ textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>Powered by OrchestratePay</p>
        <p style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>
          support@orchestratepay.co.ke
        </p>
      </div>

      {/* Print / save button — only for confirmed transactions */}
      {isConfirmed && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: '10px 28px', background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(37,99,235,0.3)'
            }}
          >
            Print / Save as PDF
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
      <span style={{ fontSize: 13, color: '#64748b', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

const backBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: '#2563eb', fontSize: 14, padding: 0, marginBottom: 8
}
