'use client'
import { useEffect, useState } from 'react'
import { consumers }           from '@/lib/api'

interface Balance {
  merchant_id: string; merchant_name: string
  reward_type: 'POINTS' | 'STAMPS' | null
  points_balance: number; stamps_balance: number
  lifetime_points: number; lifetime_stamps: number
  redeem_threshold: number | null
}

export default function LoyaltyPage() {
  const [balances, setBalances] = useState<Balance[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => {
    consumers.getLoyalty()
      .then(res => setBalances(res.balances ?? []))
      .catch(() => setError('Failed to load loyalty rewards — please try again.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="py-6 space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Loyalty rewards</h1>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {!loading && !error && balances.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">🎯</p>
          <p className="text-sm">No loyalty cards yet — pay at a merchant to start earning</p>
        </div>
      )}

      {balances.map(b => {
        const isPoints = !b.reward_type || b.reward_type === 'POINTS'
        const balance  = isPoints ? b.points_balance : b.stamps_balance
        const threshold = b.redeem_threshold || 1000
        const pct = Math.min(100, Math.round((balance / threshold) * 100))

        return (
          <div key={b.merchant_id} className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="font-semibold text-gray-800">{b.merchant_name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {isPoints ? 'Points' : 'Stamps'} programme
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-green-600">{balance.toLocaleString()}</div>
                <div className="text-xs text-gray-400">{isPoints ? 'pts' : 'stamps'}</div>
              </div>
            </div>

            {/* Progress bar toward redemption */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Progress to next reward</span>
                <span>{pct}%</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-xs text-gray-400">
                {threshold - balance > 0 ? `${(threshold - balance).toLocaleString()} to go` : 'Ready to redeem!'}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
