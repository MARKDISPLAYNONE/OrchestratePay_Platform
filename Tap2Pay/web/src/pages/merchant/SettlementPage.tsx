import { useCallback, useEffect, useState } from 'react'
import { settlement as api } from '@/lib/api'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

type AccountType = 'MPESA' | 'BANK'
interface SettlementAccount { accountType: AccountType; mpesaPhone?: string; bankName?: string; accountNumber?: string; accountName?: string }
interface Settlement { id: string; periodStart: string; periodEnd: string; grossAmountCents: number; feeCents: number; netAmountCents: number; transactionCount: number; status: string; payoutMethod: string; b2cReceipt?: string; settledAt?: string; createdAt: string }

const badgeVariant = (s: string) => ({ COMPLETED: 'confirmed', PENDING: 'pending', PROCESSING: 'blue', FAILED: 'failed', NO_ACCOUNT: 'default' } as Record<string, string>)[s] ?? 'default'
const fmt  = (c: number) => `KSh ${(c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
const fmtD = (s: string) => new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
const LIMIT = 10

export default function SettlementPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [account, setAccount]         = useState<SettlementAccount | null>(null)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [success, setSuccess]         = useState('')
  const [page, setPage]               = useState(1)
  const [total, setTotal]             = useState(0)
  const [accountType, setAccountType] = useState<AccountType>('MPESA')
  const [phone, setPhone]             = useState('')
  const [bankName, setBankName]       = useState('')
  const [accountNum, setAccountNum]   = useState('')
  const [accountName, setAccountName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([api.list(page, LIMIT), api.getAccount().catch(() => null)])
      setSettlements(s.settlements ?? []); setTotal(s.total ?? 0)
      if (a) { setAccount(a); setAccountType(a.accountType); setPhone(a.mpesaPhone ?? ''); setBankName(a.bankName ?? ''); setAccountNum(a.accountNumber ?? ''); setAccountName(a.accountName ?? '') }
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }, [page])

  useEffect(() => { load() }, [load])

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      await api.setAccount({ accountType, mpesaPhone: accountType === 'MPESA' ? phone : undefined, bankName: accountType === 'BANK' ? bankName : undefined, accountNumber: accountType === 'BANK' ? accountNum : undefined, accountName: accountType === 'BANK' ? accountName : undefined })
      setSuccess('Settlement account saved successfully.'); await load()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Settlement" subtitle="Payout account and settlement history" />

      {/* Payout account */}
      <GlassCard className="p-6">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-5">Payout Account</h2>
        {account && (
          <div className="mb-5 px-4 py-3 rounded-xl text-sm text-electric border border-electric/20 bg-electric/5">
            Current: {account.accountType === 'MPESA' ? `M-Pesa ${account.mpesaPhone}` : `${account.bankName} — ${account.accountNumber}`}
          </div>
        )}
        <form onSubmit={saveAccount} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Account type</label>
            <select value={accountType} onChange={e => setAccountType(e.target.value as AccountType)} className="input-dark">
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank account</option>
            </select>
          </div>
          {accountType === 'MPESA' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Safaricom phone number</label>
              <input type="tel" placeholder="07XXXXXXXX or 254XXXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} required className="input-dark" />
            </div>
          )}
          {accountType === 'BANK' && (
            <>
              <div><label className="block text-sm font-medium text-slate-300 mb-1.5">Bank name</label><input type="text" placeholder="e.g. Equity Bank" value={bankName} onChange={e => setBankName(e.target.value)} required className="input-dark" /></div>
              <div><label className="block text-sm font-medium text-slate-300 mb-1.5">Account number</label><input type="text" value={accountNum} onChange={e => setAccountNum(e.target.value)} required className="input-dark" /></div>
              <div><label className="block text-sm font-medium text-slate-300 mb-1.5">Account name</label><input type="text" value={accountName} onChange={e => setAccountName(e.target.value)} required className="input-dark" /></div>
            </>
          )}
          {error   && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2.5 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save payout account'}
          </button>
        </form>
      </GlassCard>

      {/* History */}
      <GlassCard className="overflow-hidden">
        <div className="px-5 py-4 text-sm font-semibold text-slate-400 uppercase tracking-widest"
          style={{ borderBottom: '1px solid rgba(0,175,255,0.08)' }}>Settlement History</div>
        {loading ? (
          <div className="py-10 text-center text-slate-600 text-sm">Loading…</div>
        ) : settlements.length === 0 ? (
          <div className="py-10 text-center text-slate-600 text-sm">No settlements yet. Settlements run nightly once your payout account is set.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(0,175,255,0.06)' }}>
                    {['Period', 'Gross', 'Fee', 'Net', 'Txns', 'Status'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {settlements.map(s => (
                    <tr key={s.id} className="table-row-dark">
                      <td className="px-5 py-3 whitespace-nowrap text-slate-300">{fmtD(s.periodStart)} – {fmtD(s.periodEnd)}</td>
                      <td className="px-5 py-3 font-mono text-slate-300">{fmt(s.grossAmountCents)}</td>
                      <td className="px-5 py-3 font-mono text-red-400">−{fmt(s.feeCents)}</td>
                      <td className="px-5 py-3 font-mono font-semibold text-white">{fmt(s.netAmountCents)}</td>
                      <td className="px-5 py-3 text-slate-400">{s.transactionCount}</td>
                      <td className="px-5 py-3"><Badge label={s.status} variant={badgeVariant(s.status) as any} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > LIMIT && (
              <div className="flex items-center justify-between px-5 py-3 text-sm text-slate-500">
                <span>{total} total</span>
                <div className="flex gap-2">
                  <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-ghost px-3 py-1 text-xs disabled:opacity-30">Previous</button>
                  <button disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)} className="btn-ghost px-3 py-1 text-xs disabled:opacity-30">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>
    </div>
  )
}
