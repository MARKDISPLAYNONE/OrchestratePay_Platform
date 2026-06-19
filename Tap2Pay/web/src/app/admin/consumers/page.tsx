'use client'
import { useEffect, useState } from 'react'
import { admin }               from '@/lib/api'

type Consumer = {
  id: string; phone: string; email: string | null
  display_name: string | null; active: boolean
  created_at: string; transaction_count: number
}

export default function AdminConsumersPage() {
  const [consumers, setConsumers] = useState<Consumer[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  useEffect(() => {
    admin.getConsumers()
      .then(r => setConsumers(r.consumers ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-400 text-sm">Loading consumers…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Consumers</h1>
        <p className="text-sm text-gray-400 mt-1">{consumers.length} registered</p>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {consumers.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-sm">No consumers registered yet</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-700">
              <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <th className="px-5 py-3 text-left">Name / Phone</th>
                <th className="px-5 py-3 text-left">Email</th>
                <th className="px-5 py-3 text-left">Joined</th>
                <th className="px-5 py-3 text-right">Transactions</th>
                <th className="px-5 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {consumers.map(c => (
                <tr key={c.id} className="hover:bg-gray-700/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="font-medium text-white">{c.display_name ?? '—'}</div>
                    <div className="text-xs text-gray-400 font-mono">{c.phone}</div>
                  </td>
                  <td className="px-5 py-3 text-gray-400">{c.email ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-400">
                    {new Date(c.created_at).toLocaleDateString('en-KE')}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-medium ${c.transaction_count > 0 ? 'text-white' : 'text-gray-500'}`}>
                      {c.transaction_count}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${c.active ? 'bg-green-400' : 'bg-red-500'}`}
                      title={c.active ? 'Active' : 'Inactive'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
