import { useEffect, useState } from 'react'
import { admin } from '@/lib/api'
import KpiCard from '@/components/ui/KpiCard'
import GlassCard from '@/components/ui/GlassCard'

export default function AdminDashboard() {
  const [stats, setStats]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => { admin.getStats().then(setStats).catch(e => setError(e.message)).finally(() => setLoading(false)) }, [])

  if (loading) return <div className="text-slate-600 text-sm py-8">Loading platform stats…</div>
  if (error)   return <div className="text-red-400 text-sm py-8">Error: {error}</div>

  const allTime = stats?.allTime  ?? {}
  const last24h = stats?.last24h  ?? {}
  const timing  = stats?.timing   ?? {}
  const infra   = stats?.infrastructure ?? {}

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white">Platform Dashboard</h1>
        <p className="text-xs text-slate-600 mt-1">Generated {new Date(stats?.generatedAt).toLocaleString('en-KE')}</p>
      </div>

      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Platform</h2>
        <div className="grid grid-cols-2 gap-4">
          <KpiCard title="Merchants" value={stats?.merchants?.total ?? 0} sub="Approved accounts" />
          <KpiCard title="Consumers" value={stats?.consumers?.total ?? 0} sub="Active accounts" />
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Infrastructure</h2>
        <div className="grid grid-cols-2 gap-4">
          <GlassCard className="p-4 flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${infra.redis === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} style={infra.redis === 'ok' ? { boxShadow: '0 0 6px rgba(52,211,153,0.8)' } : {}} />
            <div><div className="text-sm font-medium text-white">Redis</div><div className="text-xs text-slate-600">{infra.redis ?? '—'}</div></div>
          </GlassCard>
          <GlassCard className="p-4 flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${infra.darajaCircuit?.state === 'CLOSED' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <div><div className="text-sm font-medium text-white">Daraja circuit</div><div className="text-xs text-slate-600">{infra.darajaCircuit?.state ?? '—'} · {infra.darajaCircuit?.failureCount ?? 0} failures</div></div>
          </GlassCard>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Last 24 hours</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="Total"     value={last24h.total     ?? 0} />
          <KpiCard title="Confirmed" value={last24h.confirmed ?? 0} sub={last24h.successRate != null ? `${(last24h.successRate * 100).toFixed(1)}% success` : undefined} accent />
          <KpiCard title="Declined"  value={last24h.declined  ?? 0} />
          <KpiCard title="Failed"    value={last24h.failed    ?? 0} sub={last24h.timeoutRate != null ? `${(last24h.timeoutRate * 100).toFixed(1)}% timeout` : undefined} />
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">All time</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiCard title="Total transactions" value={allTime.total     ?? 0} />
          <KpiCard title="Confirmed"          value={allTime.confirmed ?? 0} accent />
          <KpiCard title="Pending"            value={allTime.pending   ?? 0} />
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Payment timing (7-day)</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiCard title="Median confirm" value={timing.medianConfirmMs != null ? `${(timing.medianConfirmMs / 1000).toFixed(1)}s` : '—'} />
          <KpiCard title="p95 confirm"    value={timing.p95ConfirmMs    != null ? `${(timing.p95ConfirmMs / 1000).toFixed(1)}s`    : '—'} />
          <KpiCard title="Avg confirm"    value={timing.avgConfirmMs    != null ? `${(timing.avgConfirmMs / 1000).toFixed(1)}s`    : '—'} />
        </div>
      </section>

      {stats?.hourly?.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Hourly activity (last 24 h)</h2>
          <GlassCard className="p-5">
            <div className="flex items-end gap-1 h-20">
              {stats.hourly.map((h: any, i: number) => {
                const max = Math.max(...stats.hourly.map((x: any) => x.confirmed))
                const pct = max > 0 ? (h.confirmed / max) * 100 : 0
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${h.hour}: ${h.confirmed} confirmed`}>
                    <div className="w-full rounded-sm min-h-[2px] transition-all" style={{ height: `${Math.max(2, pct)}%`, background: 'linear-gradient(180deg, #00AFFF 0%, rgba(0,175,255,0.3) 100%)', boxShadow: pct > 50 ? '0 0 4px rgba(0,175,255,0.5)' : 'none' }} />
                  </div>
                )
              })}
            </div>
            <div className="text-xs text-slate-600 mt-2 text-center">Confirmed transactions per hour</div>
          </GlassCard>
        </section>
      )}
    </div>
  )
}
