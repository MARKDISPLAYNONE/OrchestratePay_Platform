import { useEffect, useState } from 'react'
import { accounting } from '@/lib/api'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

const PLATFORMS = [
  { id: 'quickbooks', name: 'QuickBooks' },
  { id: 'xero',       name: 'Xero'       },
  { id: 'sage',       name: 'Sage'       },
  { id: 'wave',       name: 'Wave'       },
] as const

interface Integration { id: string; platform: string; status: string; last_sync_at: string | null }

export default function AccountingPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [postings, setPostings]         = useState<any[]>([])
  const [loading, setLoading]           = useState(true)
  const [connecting, setConnecting]     = useState<string | null>(null)
  const [token, setToken]               = useState('')
  const [error, setError]               = useState('')

  async function load() {
    const [i, p] = await Promise.all([accounting.getIntegrations(), accounting.getPostings(undefined, 20)])
    setIntegrations(i.integrations ?? []); setPostings(p.postings ?? [])
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  const connected = new Set(integrations.filter(i => i.status === 'ACTIVE').map(i => i.platform))

  async function connect(platform: string) {
    if (!token.trim()) { setError('Paste your API/access token first'); return }
    setError('')
    try { await accounting.connect(platform, { accessToken: token.trim() }); setToken(''); setConnecting(null); await load() }
    catch (e: any) { setError(e.message) }
  }

  async function disconnect(platform: string) { await accounting.disconnect(platform); await load() }

  const postBadgeVariant = (s: string) => s === 'POSTED' ? 'confirmed' : s === 'FAILED' ? 'failed' : 'pending'

  return (
    <div className="space-y-8">
      <PageHeader title="Accounting Integrations" subtitle="GL integrations and posting history" />

      {/* Platform cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLATFORMS.map(p => {
          const isActive   = connected.has(p.id)
          const isExpanded = connecting === p.id
          return (
            <GlassCard key={p.id} className="p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="font-semibold text-white">{p.name}</span>
                <Badge label={isActive ? 'Connected' : 'Not connected'} variant={isActive ? 'confirmed' : 'default'} />
              </div>
              {isActive ? (
                <button onClick={() => disconnect(p.id)} className="text-sm text-red-400 hover:text-red-300 transition-colors">Disconnect</button>
              ) : (
                <>
                  <button onClick={() => setConnecting(isExpanded ? null : p.id)}
                    className="text-sm text-electric hover:text-neon transition-colors">{isExpanded ? 'Cancel' : 'Connect'}</button>
                  {isExpanded && (
                    <div className="mt-3 space-y-2">
                      <input placeholder="Paste access token" value={token} onChange={e => setToken(e.target.value)}
                        className="input-dark text-xs" />
                      {error && <p className="text-xs text-red-400">{error}</p>}
                      <button onClick={() => connect(p.id)} className="btn-primary w-full py-1.5 text-xs">Save</button>
                    </div>
                  )}
                </>
              )}
            </GlassCard>
          )
        })}
      </div>

      {/* GL postings */}
      <GlassCard className="overflow-hidden">
        <div className="px-5 py-4 text-sm font-semibold text-slate-400 uppercase tracking-widest"
          style={{ borderBottom: '1px solid rgba(0,175,255,0.08)' }}>
          Recent GL Postings
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,175,255,0.06)' }}>
              {['Platform', 'Date', 'Amount', 'Status', 'External ID'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-600">Loading…</td></tr>}
            {!loading && postings.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-600">No postings yet</td></tr>}
            {postings.map(p => (
              <tr key={p.id} className="table-row-dark">
                <td className="px-5 py-3 capitalize text-slate-300">{p.platform}</td>
                <td className="px-5 py-3 text-slate-400">{p.journal_date}</td>
                <td className="px-5 py-3 text-white font-medium">KSh {(p.amount_cents / 100).toLocaleString()}</td>
                <td className="px-5 py-3"><Badge label={p.status} variant={postBadgeVariant(p.status) as any} /></td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.external_id ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
    </div>
  )
}
