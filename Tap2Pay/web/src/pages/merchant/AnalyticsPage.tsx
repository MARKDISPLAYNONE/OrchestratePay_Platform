import { useEffect, useState } from 'react'
import { merchants } from '@/lib/api'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Area, AreaChart } from 'recharts'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

export default function AnalyticsPage() {
  const [weekly, setWeekly]   = useState<any[]>([])
  const [peaks, setPeaks]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([merchants.getWeekly(), merchants.getPeakHours()])
      .then(([w, p]) => { setWeekly(w.days ?? []); setPeaks(p.hours ?? []) })
      .finally(() => setLoading(false))
  }, [])

  const tooltipStyle = { background: 'rgba(8,15,30,0.95)', border: '1px solid rgba(0,175,255,0.2)', borderRadius: 12, color: '#e2e8f0' }

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Revenue trends and peak trading hours" />

      <GlassCard className="p-6 mb-6">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-5">7-Day Revenue Trend</h2>
        {loading
          ? <div className="h-56 flex items-center justify-center text-slate-600 text-sm">Loading…</div>
          : <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={weekly}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#00AFFF" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#00AFFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `${(v / 100 / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => [`KSh ${(v / 100).toLocaleString()}`, 'Revenue']} contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="revenue" stroke="#00AFFF" strokeWidth={2} fill="url(#revenueGrad)"
                  style={{ filter: 'drop-shadow(0 0 4px rgba(0,175,255,0.5))' }} />
              </AreaChart>
            </ResponsiveContainer>
        }
      </GlassCard>

      <GlassCard className="p-6">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-5">Peak Hours (Nairobi Time)</h2>
        {loading
          ? <div className="h-56 flex items-center justify-center text-slate-600 text-sm">Loading…</div>
          : <ResponsiveContainer width="100%" height={240}>
              <BarChart data={peaks} barSize={18}>
                <XAxis dataKey="hour" tickFormatter={h => `${h}:00`} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip labelFormatter={h => `${h}:00–${h}:59`} contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#00AFFF" radius={[3, 3, 0, 0]}
                  style={{ filter: 'drop-shadow(0 0 4px rgba(0,175,255,0.35))' }} />
              </BarChart>
            </ResponsiveContainer>
        }
      </GlassCard>
    </div>
  )
}
