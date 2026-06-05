'use client'
import { useEffect, useState } from 'react'
import { admin }               from '@/lib/api'

type Merchant = {
  id: string; name: string; email: string; phone: string
  business_reg_number: string | null; mpesa_shortcode: string | null
  created_at: string; approval_status: string
}

type Action = 'approve' | 'reject' | 'suspend'

export default function AdminMerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [notes, setNotes]         = useState<Record<string, string>>({})
  const [acting, setActing]       = useState<string | null>(null)

  async function load() {
    setLoading(true)
    admin.getPendingMerchants()
      .then(res => setMerchants(res.merchants ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function act(merchantId: string, action: Action) {
    setActing(merchantId)
    try {
      await admin.approveMerchant(merchantId, action, notes[merchantId])
      setMerchants(prev => prev.filter(m => m.id !== merchantId))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActing(null)
    }
  }

  const actionColors: Record<Action, string> = {
    approve: 'bg-green-600 hover:bg-green-700 text-white',
    reject:  'bg-red-600 hover:bg-red-700 text-white',
    suspend: 'bg-yellow-600 hover:bg-yellow-700 text-white',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Merchant Applications</h1>
          <p className="text-sm text-gray-400 mt-1">Review and approve new merchant registrations</p>
        </div>
        <button
          onClick={load}
          className="text-sm text-gray-400 hover:text-white border border-gray-600 rounded-lg px-3 py-1.5 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading && <div className="text-sm text-gray-400">Loading applications…</div>}

      {!loading && merchants.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-sm">No pending applications</p>
        </div>
      )}

      <div className="space-y-4">
        {merchants.map(m => (
          <div key={m.id} className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            {/* Merchant info */}
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

            {/* Notes */}
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

            {/* Actions */}
            <div className="flex gap-2">
              {(['approve', 'reject', 'suspend'] as Action[]).map(action => (
                <button
                  key={action}
                  disabled={acting === m.id}
                  onClick={() => act(m.id, action)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors disabled:opacity-50 ${actionColors[action]}`}
                >
                  {acting === m.id ? '…' : action}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
