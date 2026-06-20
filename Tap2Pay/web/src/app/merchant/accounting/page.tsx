'use client'
import { useEffect, useState } from 'react'
import { accounting }          from '@/lib/api'

const PLATFORMS = [
  { id: 'quickbooks', name: 'QuickBooks' },
  { id: 'xero',       name: 'Xero'       },
  { id: 'sage',       name: 'Sage'       },
  { id: 'wave',       name: 'Wave'       },
] as const

interface Integration {
  id: string; platform: string; status: string; last_sync_at: string | null
}

export default function AccountingPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [postings, setPostings]         = useState<any[]>([])
  const [loading, setLoading]           = useState(true)
  const [connecting, setConnecting]     = useState<string | null>(null)
  const [token, setToken]               = useState('')
  const [error, setError]               = useState('')

  async function load() {
    const [i, p] = await Promise.all([
      accounting.getIntegrations(),
      accounting.getPostings(undefined, 20),
    ])
    setIntegrations(i.integrations ?? [])
    setPostings(p.postings ?? [])
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  const connected = new Set(integrations.filter(i => i.status === 'ACTIVE').map(i => i.platform))

  async function connect(platform: string) {
    if (!token.trim()) {
      setError('Paste your API / access token first')
      return
    }
    setError('')
    try {
      await accounting.connect(platform, { accessToken: token.trim() })
      setToken('')
      setConnecting(null)
      await load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function disconnect(platform: string) {
    await accounting.disconnect(platform)
    await load()
  }

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Accounting integrations</h1>

      {/* Platform cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLATFORMS.map(p => {
          const isActive = connected.has(p.id)
          const isExpanded = connecting === p.id

          return (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-gray-800">{p.name}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                  ${isActive ? 'text-green-700 bg-green-50' : 'text-gray-500 bg-gray-100'}`}>
                  {isActive ? 'Connected' : 'Not connected'}
                </span>
              </div>

              {isActive ? (
                <button
                  onClick={() => disconnect(p.id)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Disconnect
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setConnecting(isExpanded ? null : p.id)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {isExpanded ? 'Cancel' : 'Connect'}
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-2">
                      <input
                        placeholder="Paste access token"
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      <button
                        onClick={() => connect(p.id)}
                        className="w-full bg-blue-600 text-white text-sm rounded-lg py-1.5"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* GL posting log */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">
          Recent GL postings
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-5 py-3 text-left">Platform</th>
              <th className="px-5 py-3 text-left">Date</th>
              <th className="px-5 py-3 text-left">Amount</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">External ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : postings.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-400">No postings yet</td></tr>
            ) : postings.map(p => (
              <tr key={p.id}>
                <td className="px-5 py-3 capitalize">{p.platform}</td>
                <td className="px-5 py-3 text-gray-500">{p.journal_date}</td>
                <td className="px-5 py-3">KSh {(p.amount_cents / 100).toLocaleString()}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                    ${p.status === 'POSTED'  ? 'text-green-700 bg-green-50'  :
                      p.status === 'FAILED'  ? 'text-red-700 bg-red-50'     :
                      p.status === 'PENDING' ? 'text-yellow-700 bg-yellow-50' :
                      'text-gray-500 bg-gray-100'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-5 py-3 font-mono text-xs text-gray-500">
                  {p.external_id ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
