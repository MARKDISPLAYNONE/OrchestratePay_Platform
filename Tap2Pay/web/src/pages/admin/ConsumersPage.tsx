import { useEffect, useState } from 'react'
import { admin } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'

type Consumer = { id: string; phone: string; email: string | null; display_name: string | null; active: boolean; created_at: string; transaction_count: number }

export default function AdminConsumersPage() {
  const [list, setList]       = useState<Consumer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => { admin.getConsumers().then(r => setList(r.consumers ?? [])).catch(e => setError(e.message)).finally(() => setLoading(false)) }, [])

  if (loading) return <div className="text-slate-600 text-sm py-8">Loading consumers…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Consumers</h1>
        <p className="text-xs text-slate-500 mt-1">{list.length} registered</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {list.length === 0
        ? <div className="text-center py-16 text-slate-600 text-sm">No consumers registered yet</div>
        : <GlassCard className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,175,255,0.06)' }}>
                  {['Name / Phone', 'Email', 'Joined', 'Transactions', 'Status'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id} className="table-row-dark">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-200">{c.display_name ?? '—'}</div>
                      <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{c.email ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{new Date(c.created_at).toLocaleDateString('en-KE')}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-medium tabular-nums ${c.transaction_count > 0 ? 'text-electric' : 'text-slate-600'}`}>{c.transaction_count}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className={`w-2 h-2 rounded-full mx-auto ${c.active ? 'bg-emerald-400' : 'bg-slate-700'}`} title={c.active ? 'Active' : 'Inactive'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
      }
    </div>
  )
}
