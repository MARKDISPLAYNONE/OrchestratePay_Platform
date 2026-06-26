import { useEffect, useState } from 'react'
import { devices } from '@/lib/api'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

interface Device { id: string; device_serial: string; model: string | null; app_version_code: number | null; last_seen_at: string | null; active: boolean; unresolved_alerts: number }

function minutesAgo(ts: string | null) {
  if (!ts) return 'Never'
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000)
  if (d < 1) return 'Just now'; if (d < 60) return `${d}m ago`; return `${Math.floor(d / 60)}h ago`
}

export default function DevicesPage() {
  const [fleet, setFleet]   = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => { devices.getFleet().then(setFleet).catch(e => setError(e.message)).finally(() => setLoading(false)) }, [])

  return (
    <div>
      <PageHeader title="Devices" subtitle="Your registered terminal fleet" />
      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}
      <GlassCard className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,175,255,0.08)' }}>
              {['Serial', 'Model', 'App Version', 'Last Seen', 'Alerts'].map(h => (
                <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-600">Loading…</td></tr>}
            {!loading && fleet.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-600">No devices registered yet</td></tr>}
            {fleet.map(d => (
              <tr key={d.id} className="table-row-dark">
                <td className="px-5 py-3.5 font-mono text-xs text-slate-400">{d.device_serial}</td>
                <td className="px-5 py-3.5 text-slate-400">{d.model ?? '—'}</td>
                <td className="px-5 py-3.5 text-slate-400">{d.app_version_code ?? '—'}</td>
                <td className="px-5 py-3.5 text-slate-400">{minutesAgo(d.last_seen_at)}</td>
                <td className="px-5 py-3.5">
                  {d.unresolved_alerts > 0
                    ? <Badge label={`${d.unresolved_alerts} alert${d.unresolved_alerts > 1 ? 's' : ''}`} variant="failed" />
                    : <span className="text-slate-700">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
    </div>
  )
}
