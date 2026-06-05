import { Transaction, TxnStatus } from '../api/client'

const STATUS_COLOR: Record<TxnStatus, string> = {
  CONFIRMED: '#10b981',
  STK_SENT:  '#3b82f6',
  PENDING:   '#f59e0b',
  DECLINED:  '#ef4444',
  FAILED:    '#dc2626',
  EXPIRED:   '#6b7280'
}

interface Props {
  transactions: Transaction[]
  onSelect: (txn: Transaction) => void
}

export default function TransactionTable({ transactions, onSelect }: Props) {
  if (transactions.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 12, padding: 48, textAlign: 'center', color: '#94a3b8', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
        No transactions yet.
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
            {['Date / Time', 'Amount (KSh)', 'Status', 'M-Pesa Ref', ''].map(h => (
              <th key={h} style={{
                padding: '12px 16px', textAlign: 'left',
                fontSize: 11, fontWeight: 700, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '0.05em'
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map((txn, i) => (
            <tr
              key={txn.id}
              onClick={() => onSelect(txn)}
              style={{
                borderBottom: i < transactions.length - 1 ? '1px solid #f1f5f9' : 'none',
                cursor: 'pointer',
                transition: 'background 0.1s'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <td style={td}>{new Date(txn.created_at).toLocaleString()}</td>
              <td style={{ ...td, fontWeight: 600 }}>
                {(txn.amount_cents / 100).toFixed(2)}
              </td>
              <td style={td}>
                <span style={{
                  background: STATUS_COLOR[txn.status],
                  color: '#fff',
                  padding: '3px 10px',
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.03em'
                }}>
                  {txn.status}
                </span>
              </td>
              <td style={{ ...td, fontFamily: 'monospace', fontSize: 13 }}>
                {txn.mpesa_receipt ?? '—'}
              </td>
              <td style={{ ...td, color: '#2563eb', fontSize: 13 }}>View →</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const td: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: 14,
  color: '#374151',
  verticalAlign: 'middle'
}
