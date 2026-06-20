'use client'
import { useEffect, useState } from 'react'
import { merchants }           from '@/lib/api'

type Programme = {
  programme_type:    string | null
  points_per_ksh:    number | null
  stamps_for_reward: number | null
  reward_description: string | null
  active:            boolean
}

export default function MerchantLoyaltyPage() {
  const [prog, setProg]         = useState<Programme | null>(null)
  const [type, setType]         = useState<'POINTS' | 'STAMPS'>('POINTS')
  const [pointsPerKsh, setPointsPerKsh]       = useState('1')
  const [stampsForReward, setStampsForReward] = useState('10')
  const [description, setDescription]         = useState('')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    merchants.getLoyaltyProgramme()
      .then(p => {
        if (p && p.programme_type) {
          setProg(p)
          setType(p.programme_type)
          setPointsPerKsh(p.points_per_ksh?.toString() ?? '1')
          setStampsForReward(p.stamps_for_reward?.toString() ?? '10')
          setDescription(p.reward_description ?? '')
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      await merchants.saveLoyaltyProgramme({
        programme_type:    type,
        points_per_ksh:    type === 'POINTS' ? parseFloat(pointsPerKsh) : undefined,
        stamps_for_reward: type === 'STAMPS' ? parseInt(stampsForReward) : undefined,
        reward_description: description || undefined,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  return (
    <div className="p-8 max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Loyalty Programme</h1>
        <p className="text-sm text-gray-500 mt-1">
          Reward customers for repeat purchases — choose points or stamps.
        </p>
      </div>

      {!prog && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">
          You don't have a loyalty programme yet. Set one up below — it activates immediately.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Programme type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Programme type</label>
          <div className="flex gap-3">
            {(['POINTS', 'STAMPS'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-colors
                  ${type === t
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-blue-400'}`}
              >
                <div className="text-xl mb-1">{t === 'POINTS' ? '⭐' : '🔖'}</div>
                {t === 'POINTS' ? 'Points' : 'Stamps'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {type === 'POINTS'
              ? 'Customers earn points on every purchase. Redeem when they reach a threshold.'
              : 'Customers collect a stamp per visit. Reward after a set number of stamps.'}
          </p>
        </div>

        {/* Programme-specific config */}
        {type === 'POINTS' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Points per KSh spent
            </label>
            <input
              type="number" min="0.01" step="0.01" required
              value={pointsPerKsh}
              onChange={e => setPointsPerKsh(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              e.g. 1 → customer earns 1 point per KSh 1 spent
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stamps needed for a reward
            </label>
            <input
              type="number" min="2" max="100" required
              value={stampsForReward}
              onChange={e => setStampsForReward(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              e.g. 10 → every 10th purchase earns the reward
            </p>
          </div>
        )}

        {/* Reward description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reward description <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Free cup of tea, 10% discount…"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit" disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : prog ? 'Update programme' : 'Activate programme'}
        </button>
      </form>
    </div>
  )
}
