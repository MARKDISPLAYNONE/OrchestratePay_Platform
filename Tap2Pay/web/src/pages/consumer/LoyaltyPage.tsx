import { useEffect, useState } from 'react'
import { consumers } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'

interface Balance { merchant_id: string; merchant_name: string; reward_type: 'POINTS' | 'STAMPS' | null; points_balance: number; stamps_balance: number; redeem_threshold: number | null }

export default function ConsumerLoyaltyPage() {
  const [balances, setBalances] = useState<Balance[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => {
    consumers.getLoyalty().then(res => setBalances(res.balances ?? [])).catch(() => setError('Failed to load loyalty rewards — please try again.')).finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-white">Loyalty rewards</h1>

      {loading && <p className="text-sm text-slate-600">Loading…</p>}
      {error   && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && balances.length === 0 && (
        <div className="text-center py-16 space-y-3 text-slate-600">
          <div className="w-16 h-16 rounded-full bg-electric/5 border border-electric/10 flex items-center justify-center mx-auto text-2xl">◎</div>
          <p className="text-sm">No loyalty cards yet — pay at a merchant to start earning</p>
        </div>
      )}

      {balances.map(b => {
        const isPoints  = !b.reward_type || b.reward_type === 'POINTS'
        const balance   = isPoints ? b.points_balance : b.stamps_balance
        const threshold = b.redeem_threshold || 1000
        const pct       = Math.min(100, Math.round((balance / threshold) * 100))
        const toGo      = Math.max(0, threshold - balance)

        return (
          <GlassCard key={b.merchant_id} className="p-5">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="font-semibold text-slate-100">{b.merchant_name}</div>
                <div className="text-xs text-slate-600 mt-0.5">{isPoints ? 'Points' : 'Stamps'} programme</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold text-electric">{balance.toLocaleString()}</div>
                <div className="text-xs text-slate-600">{isPoints ? 'pts' : 'stamps'}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Progress to next reward</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden bg-white/5">
                <div className="h-full rounded-full bg-electric transition-all" style={{ width: `${pct}%`, boxShadow: '0 0 6px rgba(0,175,255,0.6)' }} />
              </div>
              <div className="text-xs text-slate-600">{toGo > 0 ? `${toGo.toLocaleString()} to go` : 'Ready to redeem!'}</div>
            </div>
          </GlassCard>
        )
      })}
    </div>
  )
}
