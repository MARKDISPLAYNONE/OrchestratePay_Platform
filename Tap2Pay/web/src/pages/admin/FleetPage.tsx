import { useEffect, useState } from 'react'
import { admin } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'

type Device = { id: string; device_serial: string; model: string | null; merchant_name: string; active: boolean; last_seen_at: string | null; battery_pct: number | null; printer_status: number | null; nfc_available: boolean | null; app_version_code: number | null; device_type: string }
type Alert  = { id: number; device_serial: string; merchant_name: string; message: string; created_at: string }

const PRINTER: Record<number, { label: string; cls: string }> = { 1: { label: 'Ready', cls: 'text-emerald-400' }, 4: { label: 'No paper', cls: 'text-amber-400' }, 5: { label: 'Overheat', cls: 'text-red-400' } }

export default function AdminFleetPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [alerts, setAlerts]   = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    Promise.all([admin.getFleet().then(r => setDevices(r.devices ?? [])), admin.getFleetAlerts().then(r => setAlerts(r.alerts ?? []))])
      .catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-slate-600 text-sm py-8">Loading fleet…</div>

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Device Fleet</h1>
        <p className="text-xs text-slate-500 mt-1">{devices.length} registered terminal{devices.length !== 1 ? 's' : ''}</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {alerts.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Unresolved alerts ({alerts.length})</h2>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className="rounded-xl px-4 py-3 border border-amber-500/20 bg-amber-500/5 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-amber-300">{a.message}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{a.device_serial} · {a.merchant_name} · {new Date(a.created_at).toLocaleString('en-KE')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {devices.length === 0
        ? <div className="text-center py-16 text-slate-600 text-sm">No devices registered yet</div>
        : <div className="grid gap-4">
            {devices.map(d => {
              const lastSeen   = d.last_seen_at ? new Date(d.last_seen_at) : null
              const minAgo     = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 60_000) : null
              const online     = minAgo != null && minAgo < 5
              const seenLabel  = lastSeen ? (minAgo === 0 ? 'Just now' : minAgo! < 60 ? `${minAgo}m ago` : lastSeen.toLocaleDateString('en-KE')) : 'Never seen'
              return (
                <GlassCard key={d.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-700'}`} style={online ? { boxShadow: '0 0 5px rgba(52,211,153,0.8)' } : {}} />
                        <span className="font-medium text-white font-mono text-sm">{d.device_serial}</span>
                        {d.model && <span className="text-xs text-slate-600">{d.model}</span>}
                      </div>
                      <div className="text-sm text-slate-400">{d.merchant_name}</div>
                      <div className="text-xs text-slate-600">{seenLabel}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs">
                      {d.battery_pct  != null && <div><span className="text-slate-600">Battery </span><span className={d.battery_pct < 20 ? 'text-red-400' : 'text-white'}>{d.battery_pct}%</span></div>}
                      {d.printer_status != null && <div><span className="text-slate-600">Printer </span><span className={PRINTER[d.printer_status]?.cls ?? 'text-slate-400'}>{PRINTER[d.printer_status]?.label ?? d.printer_status}</span></div>}
                      {d.nfc_available != null && <div><span className="text-slate-600">NFC </span><span className={d.nfc_available ? 'text-emerald-400' : 'text-red-400'}>{d.nfc_available ? 'OK' : 'Off'}</span></div>}
                      {d.app_version_code != null && <div><span className="text-slate-600">App v</span><span className="text-white">{d.app_version_code}</span></div>}
                    </div>
                  </div>
                </GlassCard>
              )
            })}
          </div>
      }
    </div>
  )
}
