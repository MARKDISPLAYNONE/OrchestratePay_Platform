'use client'
import { useEffect, useState } from 'react'
import { merchants }           from '@/lib/api'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface WeeklyData { day: string; revenue: number; count: number }

export default function MerchantDashboard() {
  const [weekly, setWeekly]     = useState<WeeklyData[]>([])
  const [sources, setSources]   = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => {
    Promise.all([merchants.getWeekly(), merchants.getSources()])
      .then(([w, s]) => {
        setWeekly(w.days ?? [])
        setSources(s.sources ?? [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const totalRevenue = weekly.reduce((sum, d) => sum + d.revenue, 0)
  const totalTxns    = weekly.reduce((sum, d) => sum + d.count, 0)

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <KpiCard title="7-day revenue" value={`KSh ${(totalRevenue / 100).toLocaleString()}`} />
        <KpiCard title="7-day transactions" value={totalTxns.toLocaleString()} />
        <KpiCard
          title="Avg transaction"
          value={totalTxns > 0 ? `KSh ${Math.round(totalRevenue / totalTxns / 100).toLocaleString()}` : '—'}
        />
      </div>

      {/* Revenue chart */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Daily revenue (KSh)</h2>
        {loading ? (
          <div className="h-40 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weekly} barSize={28}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${(v / 100).toLocaleString()}`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`KSh ${(v / 100).toLocaleString()}`, 'Revenue']} />
              <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Payment sources */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Payment sources (7 days)</h2>
        <div className="space-y-2">
          {sources.map(s => (
            <div key={s.source} className="flex items-center gap-3">
              <div className="text-sm font-medium w-28 text-gray-700">{s.source}</div>
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full"
                  style={{ width: `${s.pct ?? 0}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 w-12 text-right">{s.count} txns</div>
            </div>
          ))}
          {sources.length === 0 && !loading && (
            <p className="text-sm text-gray-400">No transactions yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{title}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  )
}
