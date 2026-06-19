'use client'
import { useEffect, useState } from 'react'
import { admin }               from '@/lib/api'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    admin.getStats()
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-400 text-sm">Loading platform stats…</div>
  if (error)   return <div className="text-red-400 text-sm">Error: {error}</div>

  const allTime  = stats?.allTime  ?? {}
  const last24h  = stats?.last24h  ?? {}
  const timing   = stats?.timing   ?? {}
  const infra    = stats?.infrastructure ?? {}

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Platform Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          Generated {new Date(stats?.generatedAt).toLocaleString('en-KE')}
        </p>
      </div>

      {/* Platform overview */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Platform</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Merchants onboarded" value={stats?.merchants?.total ?? 0} sub="Approved accounts" />
          <StatCard label="Consumers registered" value={stats?.consumers?.total ?? 0} sub="Active accounts" />
        </div>
      </div>

      {/* Infrastructure */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Infrastructure</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${infra.redis === 'ok' ? 'bg-green-400' : 'bg-red-400'}`} />
            <div>
              <div className="text-sm font-medium text-white">Redis</div>
              <div className="text-xs text-gray-400">{infra.redis ?? '—'}</div>
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${infra.darajaCircuit?.state === 'CLOSED' ? 'bg-green-400' : 'bg-yellow-400'}`} />
            <div>
              <div className="text-sm font-medium text-white">Daraja circuit</div>
              <div className="text-xs text-gray-400">{infra.darajaCircuit?.state ?? '—'} · {infra.darajaCircuit?.failureCount ?? 0} failures</div>
            </div>
          </div>
        </div>
      </div>

      {/* Last 24 hours */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Last 24 hours</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total"      value={last24h.total ?? 0} />
          <StatCard label="Confirmed"  value={last24h.confirmed ?? 0}
            sub={last24h.successRate != null ? `${(last24h.successRate * 100).toFixed(1)}% success` : undefined} />
          <StatCard label="Declined"   value={last24h.declined ?? 0} />
          <StatCard label="Failed"     value={last24h.failed ?? 0}
            sub={last24h.timeoutRate != null ? `${(last24h.timeoutRate * 100).toFixed(1)}% timeout` : undefined} />
        </div>
      </div>

      {/* All time */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">All time</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Total transactions" value={allTime.total ?? 0} />
          <StatCard label="Confirmed"          value={allTime.confirmed ?? 0} />
          <StatCard label="Pending"            value={allTime.pending ?? 0} />
        </div>
      </div>

      {/* Timing */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Payment timing (7-day)</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Median confirm"  value={timing.medianConfirmMs != null ? `${(timing.medianConfirmMs/1000).toFixed(1)}s` : '—'} />
          <StatCard label="p95 confirm"     value={timing.p95ConfirmMs    != null ? `${(timing.p95ConfirmMs/1000).toFixed(1)}s` : '—'} />
          <StatCard label="Avg confirm"     value={timing.avgConfirmMs    != null ? `${(timing.avgConfirmMs/1000).toFixed(1)}s` : '—'} />
        </div>
      </div>

      {/* Hourly chart (text sparkline) */}
      {stats?.hourly?.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Hourly activity (last 24 h)</h2>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
            <div className="flex items-end gap-1 h-16">
              {stats.hourly.map((h: any, i: number) => {
                const max = Math.max(...stats.hourly.map((x: any) => x.confirmed))
                const pct = max > 0 ? (h.confirmed / max) * 100 : 0
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-green-500 rounded-sm min-h-[2px]"
                      style={{ height: `${Math.max(2, pct)}%` }}
                      title={`${h.hour}: ${h.confirmed} confirmed`}
                    />
                  </div>
                )
              })}
            </div>
            <div className="text-xs text-gray-500 mt-2 text-center">Confirmed transactions per hour</div>
          </div>
        </div>
      )}
    </div>
  )
}
