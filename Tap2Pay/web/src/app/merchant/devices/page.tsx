'use client'
import { useEffect, useState } from 'react'
import { devices }             from '@/lib/api'

interface Device {
  id: string; device_serial: string; model: string | null
  app_version_code: number | null; last_seen_at: string | null
  active: boolean; unresolved_alerts: number
}

function minutesAgo(ts: string | null): string {
  if (!ts) return 'Never'
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000)
  if (diff < 1)  return 'Just now'
  if (diff < 60) return `${diff}m ago`
  return `${Math.floor(diff / 60)}h ago`
}

export default function DevicesPage() {
  const [fleet, setFleet]   = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    devices.getFleet()
      .then(res => setFleet(res))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Devices</h1>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
            <tr>
              <th className="px-5 py-3 text-left">Serial</th>
              <th className="px-5 py-3 text-left">Model</th>
              <th className="px-5 py-3 text-left">App version</th>
              <th className="px-5 py-3 text-left">Last seen</th>
              <th className="px-5 py-3 text-left">Alerts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {!loading && fleet.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No devices registered yet</td></tr>
            )}
            {fleet.map(d => (
              <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 font-mono text-xs text-gray-700">{d.device_serial}</td>
                <td className="px-5 py-3 text-gray-500">{d.model ?? '—'}</td>
                <td className="px-5 py-3 text-gray-500">{d.app_version_code ?? '—'}</td>
                <td className="px-5 py-3 text-gray-500">{minutesAgo(d.last_seen_at)}</td>
                <td className="px-5 py-3">
                  {d.unresolved_alerts > 0 ? (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full text-red-700 bg-red-50">
                      {d.unresolved_alerts} alert{d.unresolved_alerts > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
