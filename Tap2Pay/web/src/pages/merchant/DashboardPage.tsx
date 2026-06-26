import { useEffect, useState } from 'react'
import { merchants } from '@/lib/api'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import KpiCard from '@/components/ui/KpiCard'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

interface WeeklyData { day: string; revenue: number; count: number }

export default function MerchantDashboard() {
  const [weekly, setWeekly]   = useState<WeeklyData[]>([])
  const [sources, setSources] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    Promise.all([merchants.getWeekly(), merchants.getSources()])
      .then(([w, s]) => { setWeekly(w.days ?? []); setSources(s.sources ?? []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const totalRevenue = weekly.reduce((s, d) => s + d.revenue, 0)
  const totalTxns    = weekly.reduce((s, d) => s + d.count, 0)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="7-day performance overview" />

      {error && <div className="mb-6 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <KpiCard title="7-day Revenue" value={`KSh ${(totalRevenue / 100).toLocaleString()}`} accent />
        <KpiCard title="7-day Transactions" value={totalTxns.toLocaleString()} />
        <KpiCard title="Avg Transaction" value={totalTxns > 0 ? `KSh ${Math.round(totalRevenue / totalTxns / 100).toLocaleString()}` : '—'} />
      </div>

      {/* Revenue chart */}
      <GlassCard className="p-6 mb-6">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-5">Daily Revenue (KSh)</h2>
        {loading
          ? <div className="h-48 flex items-center justify-center text-slate-600 text-sm">Loading…</div>
          : <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekly} barSize={28}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `${(v / 100 / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: number) => [`KSh ${(v / 100).toLocaleString()}`, 'Revenue']}
                  contentStyle={{ background: 'rgba(8,15,30,0.95)', border: '1px solid rgba(0,175,255,0.2)', borderRadius: 12, color: '#e2e8f0' }}
                />
                <Bar dataKey="revenue" fill="#00AFFF" radius={[4, 4, 0, 0]}
                  style={{ filter: 'drop-shadow(0 0 6px rgba(0,175,255,0.4))' }} />
              </BarChart>
            </ResponsiveContainer>
        }
      </GlassCard>

      {/* Payment sources */}
      <GlassCard className="p-6">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-5">Payment Sources (7 days)</h2>
        {loading
          ? <div className="h-20 flex items-center justify-center text-slate-600 text-sm">Loading…</div>
          : <div className="space-y-3">
              {sources.map(s => (
                <div key={s.source} className="flex items-center gap-3">
                  <div className="text-sm font-medium w-28 text-slate-400">{s.source}</div>
                  <div className="flex-1 bg-white/5 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-gradient-to-r from-electric to-blue-600"
                      style={{ width: `${s.pct ?? 0}%`, boxShadow: '0 0 6px rgba(0,175,255,0.5)' }} />
                  </div>
                  <div className="text-xs text-slate-500 w-14 text-right">{s.count} txns</div>
                </div>
              ))}
              {sources.length === 0 && <p className="text-sm text-slate-600">No transactions yet.</p>}
            </div>
        }
      </GlassCard>
    </div>
  )
}
