'use client'
import { useEffect, useState } from 'react'
import { admin }               from '@/lib/api'

type Device = {
  id: string; device_serial: string; model: string | null
  merchant_name: string; active: boolean
  last_seen_at: string | null; battery_pct: number | null
  printer_status: number | null; nfc_available: boolean | null
  app_version_code: number | null; device_type: string
}

type Alert = {
  id: number; device_serial: string; merchant_name: string
  message: string; created_at: string
}

const PRINTER_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Ready',    color: 'text-green-400'  },
  4: { label: 'No paper', color: 'text-yellow-400' },
  5: { label: 'Overheat', color: 'text-red-400'    },
}

export default function AdminFleetPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [alerts, setAlerts]   = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    Promise.all([
      admin.getFleet().then(r => setDevices(r.devices ?? [])),
      admin.getFleetAlerts().then(r => setAlerts(r.alerts ?? [])),
    ])
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-400 text-sm">Loading fleet…</div>

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Device Fleet</h1>
        <p className="text-sm text-gray-400 mt-1">{devices.length} registered terminal{devices.length !== 1 ? 's' : ''}</p>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Unresolved alerts */}
      {alerts.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Unresolved alerts ({alerts.length})
          </h2>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className="bg-yellow-900/20 border border-yellow-800 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-yellow-300">{a.message}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {a.device_serial} · {a.merchant_name} · {new Date(a.created_at).toLocaleString('en-KE')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Device list */}
      {devices.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">📟</div>
          <p className="text-sm">No devices registered yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {devices.map(d => {
            const lastSeen = d.last_seen_at
              ? new Date(d.last_seen_at)
              : null
            const minutesAgo = lastSeen
              ? Math.floor((Date.now() - lastSeen.getTime()) / 60000)
              : null
            const online = minutesAgo != null && minutesAgo < 5

            return (
              <div key={d.id} className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <span className="font-medium text-white">{d.device_serial}</span>
                      {d.model && <span className="text-xs text-gray-500">{d.model}</span>}
                    </div>
                    <div className="text-sm text-gray-400">{d.merchant_name}</div>
                    <div className="text-xs text-gray-500">
                      {lastSeen
                        ? minutesAgo === 0 ? 'Just now'
                          : minutesAgo! < 60 ? `${minutesAgo}m ago`
                          : lastSeen.toLocaleDateString('en-KE')
                        : 'Never seen'}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right text-xs">
                    {d.battery_pct != null && (
                      <div>
                        <span className="text-gray-500">Battery </span>
                        <span className={d.battery_pct < 20 ? 'text-red-400' : 'text-white'}>
                          {d.battery_pct}%
                        </span>
                      </div>
                    )}
                    {d.printer_status != null && (
                      <div>
                        <span className="text-gray-500">Printer </span>
                        <span className={PRINTER_LABELS[d.printer_status]?.color ?? 'text-gray-400'}>
                          {PRINTER_LABELS[d.printer_status]?.label ?? d.printer_status}
                        </span>
                      </div>
                    )}
                    {d.nfc_available != null && (
                      <div>
                        <span className="text-gray-500">NFC </span>
                        <span className={d.nfc_available ? 'text-green-400' : 'text-red-400'}>
                          {d.nfc_available ? 'OK' : 'Off'}
                        </span>
                      </div>
                    )}
                    {d.app_version_code != null && (
                      <div>
                        <span className="text-gray-500">App v</span>
                        <span className="text-white">{d.app_version_code}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
