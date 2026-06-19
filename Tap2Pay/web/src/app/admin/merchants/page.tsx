'use client'
import { useEffect, useState } from 'react'
import { admin }               from '@/lib/api'

type PendingMerchant = {
  id: string; name: string; email: string; phone: string
  business_reg_number: string | null; mpesa_shortcode: string | null
  created_at: string; approval_status: string
}

type OnboardedMerchant = {
  id: string; name: string; email: string; phone: string
  business_reg_number: string | null; mpesa_shortcode: string | null
  created_at: string; approval_status: string; active: boolean; live: boolean
}

type Action = 'approve' | 'reject' | 'suspend'

const STATUS_STYLES: Record<string, string> = {
  APPROVED:  'bg-green-900/40 text-green-400 border-green-800',
  REJECTED:  'bg-red-900/40 text-red-400 border-red-800',
  SUSPENDED: 'bg-yellow-900/40 text-yellow-400 border-yellow-800',
}

const ACTION_COLORS: Record<Action, string> = {
  approve: 'bg-green-600 hover:bg-green-700 text-white',
  reject:  'bg-red-600 hover:bg-red-700 text-white',
  suspend: 'bg-yellow-600 hover:bg-yellow-700 text-white',
}

export default function AdminMerchantsPage() {
  const [tab, setTab]               = useState<'pending' | 'onboarded'>('pending')
  const [pending, setPending]       = useState<PendingMerchant[]>([])
  const [onboarded, setOnboarded]   = useState<OnboardedMerchant[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [notes, setNotes]           = useState<Record<string, string>>({})
  const [acting, setActing]         = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [pendingRes, onboardedRes] = await Promise.all([
        admin.getPendingMerchants(),
        admin.getAllMerchants(),
      ])
      setPending(pendingRes.merchants ?? [])
      setOnboarded(onboardedRes.merchants ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function act(merchantId: string, action: Action) {
    setActing(merchantId)
    try {
      await admin.approveMerchant(merchantId, action, notes[merchantId])
      setPending(prev => prev.filter(m => m.id !== merchantId))
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Merchants</h1>
          <p className="text-sm text-gray-400 mt-1">
            {pending.length} pending · {onboarded.length} onboarded
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm text-gray-400 hover:text-white border border-gray-600 rounded-lg px-3 py-1.5 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 w-fit border border-gray-700">
        {(['pending', 'onboarded'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize
              ${tab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            {t === 'pending' ? `Pending (${pending.length})` : `Onboarded (${onboarded.length})`}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading && <div className="text-sm text-gray-400">Loading…</div>}

      {/* ── Pending applications ── */}
      {!loading && tab === 'pending' && (
        <>
          {pending.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-sm">No pending applications</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map(m => (
                <div key={m.id} className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="font-semibold text-white text-lg">{m.name}</div>
                      <div className="text-sm text-gray-400">{m.email}</div>
                      <div className="text-sm text-gray-400">{m.phone}</div>
                      <div className="flex gap-4 text-xs text-gray-500 mt-2">
                        {m.business_reg_number && <span>Reg: {m.business_reg_number}</span>}
                        {m.mpesa_shortcode     && <span>M-Pesa: {m.mpesa_shortcode}</span>}
                        <span>Applied: {new Date(m.created_at).toLocaleDateString('en-KE')}</span>
                      </div>
                    </div>
                    <span className="text-xs bg-yellow-900/50 text-yellow-400 border border-yellow-800 rounded-full px-2 py-0.5 shrink-0">
                      {m.approval_status}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Review notes (optional)</label>
                    <input
                      type="text"
                      placeholder="KYC verified, documents received…"
                      value={notes[m.id] ?? ''}
                      onChange={e => setNotes(prev => ({ ...prev, [m.id]: e.target.value }))}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>

                  <div className="flex gap-2">
                    {(['approve', 'reject', 'suspend'] as Action[]).map(action => (
                      <button
                        key={action}
                        disabled={acting === m.id}
                        onClick={() => act(m.id, action)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors disabled:opacity-50 ${ACTION_COLORS[action]}`}
                      >
                        {acting === m.id ? '…' : action}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Onboarded merchants ── */}
      {!loading && tab === 'onboarded' && (
        <>
          {onboarded.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-sm">No onboarded merchants yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {onboarded.map(m => (
                <div key={m.id} className="bg-gray-800 rounded-xl border border-gray-700 px-5 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${m.live ? 'bg-green-400' : 'bg-red-500'}`}
                      title={m.live ? 'Live — device active in last 5 min' : 'Offline'}
                    />
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">{m.name}</div>
                      <div className="text-xs text-gray-400 truncate">{m.email} · {m.phone}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 shrink-0 text-right">
                    <div className="text-xs text-gray-500 hidden sm:block">
                      {m.mpesa_shortcode && <div>M-Pesa {m.mpesa_shortcode}</div>}
                      <div>Joined {new Date(m.created_at).toLocaleDateString('en-KE')}</div>
                    </div>
                    <span className={`text-xs border rounded-full px-2 py-0.5 ${STATUS_STYLES[m.approval_status] ?? 'bg-gray-700 text-gray-400 border-gray-600'}`}>
                      {m.approval_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
