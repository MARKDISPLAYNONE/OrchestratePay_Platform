import { useEffect, useState } from 'react'
import { admin } from '@/lib/api'
import Badge from '@/components/ui/Badge'
import GlassCard from '@/components/ui/GlassCard'

type PendingMerchant = { id: string; name: string; email: string; phone: string; business_reg_number: string | null; mpesa_shortcode: string | null; created_at: string; approval_status: string }
type OnboardedMerchant = PendingMerchant & { active: boolean; live: boolean }
type Action = 'approve' | 'reject' | 'suspend'

const actionStyle: Record<Action, string> = { approve: 'btn-primary', reject: 'btn-danger', suspend: 'bg-amber-600/80 hover:bg-amber-500 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors' }
const statusVariant = (s: string) => ({ APPROVED: 'confirmed', REJECTED: 'failed', SUSPENDED: 'pending' } as Record<string, string>)[s] ?? 'default'

export default function AdminMerchantsPage() {
  const [tab, setTab]             = useState<'pending' | 'onboarded'>('pending')
  const [pending, setPending]     = useState<PendingMerchant[]>([])
  const [onboarded, setOnboarded] = useState<OnboardedMerchant[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [notes, setNotes]         = useState<Record<string, string>>({})
  const [acting, setActing]       = useState<string | null>(null)

  async function load() {
    setLoading(true); setError('')
    try { const [p, o] = await Promise.all([admin.getPendingMerchants(), admin.getAllMerchants()]); setPending(p.merchants ?? []); setOnboarded(o.merchants ?? []) }
    catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function act(id: string, action: Action) {
    setActing(id)
    try { await admin.approveMerchant(id, action, notes[id]); setPending(prev => prev.filter(m => m.id !== id)) }
    catch (e: any) { setError(e.message) }
    setActing(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Merchants</h1>
          <p className="text-xs text-slate-500 mt-1">{pending.length} pending · {onboarded.length} onboarded</p>
        </div>
        <button onClick={load} className="btn-ghost px-3 py-1.5 text-xs">Refresh</button>
      </div>

      <div className="flex gap-1 p-1 bg-white/4 rounded-xl w-fit">
        {(['pending', 'onboarded'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-electric/15 text-electric' : 'text-slate-500 hover:text-slate-300'}`}>
            {t === 'pending' ? `Pending (${pending.length})` : `Onboarded (${onboarded.length})`}
          </button>
        ))}
      </div>

      {error   && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-600">Loading…</p>}

      {!loading && tab === 'pending' && (
        pending.length === 0
          ? <div className="text-center py-16 text-slate-600 text-sm">No pending applications</div>
          : <div className="space-y-4">
              {pending.map(m => (
                <GlassCard key={m.id} className="p-6 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-white text-lg">{m.name}</div>
                      <div className="text-sm text-slate-400">{m.email}</div>
                      <div className="text-sm text-slate-400">{m.phone}</div>
                      <div className="flex gap-4 text-xs text-slate-600 mt-2">
                        {m.business_reg_number && <span>Reg: {m.business_reg_number}</span>}
                        {m.mpesa_shortcode     && <span>M-Pesa: {m.mpesa_shortcode}</span>}
                        <span>Applied: {new Date(m.created_at).toLocaleDateString('en-KE')}</span>
                      </div>
                    </div>
                    <Badge label={m.approval_status} variant="pending" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Review notes (optional)</label>
                    <input type="text" placeholder="KYC verified, documents received…" value={notes[m.id] ?? ''} onChange={e => setNotes(prev => ({ ...prev, [m.id]: e.target.value }))} className="input-dark text-xs" />
                  </div>
                  <div className="flex gap-2">
                    {(['approve', 'reject', 'suspend'] as Action[]).map(action => (
                      <button key={action} disabled={acting === m.id} onClick={() => act(m.id, action)}
                        className={`${actionStyle[action]} px-4 py-2 text-xs capitalize disabled:opacity-50`}>{acting === m.id ? '…' : action}</button>
                    ))}
                  </div>
                </GlassCard>
              ))}
            </div>
      )}

      {!loading && tab === 'onboarded' && (
        onboarded.length === 0
          ? <div className="text-center py-16 text-slate-600 text-sm">No onboarded merchants yet</div>
          : <GlassCard className="overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid rgba(0,175,255,0.06)' }}>{['', 'Name', 'Contact', 'M-Pesa', 'Joined', 'Status'].map(h => <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-widest">{h}</th>)}</tr></thead>
                <tbody>{onboarded.map(m => (
                  <tr key={m.id} className="table-row-dark">
                    <td className="px-5 py-3"><div className={`w-2 h-2 rounded-full ${m.live ? 'bg-emerald-400' : 'bg-slate-700'}`} title={m.live ? 'Online' : 'Offline'} /></td>
                    <td className="px-5 py-3 font-medium text-white">{m.name}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{m.email}<br />{m.phone}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs font-mono">{m.mpesa_shortcode ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{new Date(m.created_at).toLocaleDateString('en-KE')}</td>
                    <td className="px-5 py-3"><Badge label={m.approval_status} variant={statusVariant(m.approval_status) as any} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </GlassCard>
      )}
    </div>
  )
}
