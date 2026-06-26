import { useEffect, useState } from 'react'
import { merchants } from '@/lib/api'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

type ProgrammeType = 'POINTS' | 'STAMPS'

export default function MerchantLoyaltyPage() {
  const [prog, setProg]       = useState<any>(null)
  const [type, setType]       = useState<ProgrammeType>('POINTS')
  const [ptsPerKsh, setPts]   = useState('1')
  const [stamps, setStamps]   = useState('10')
  const [desc, setDesc]       = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    merchants.getLoyaltyProgramme()
      .then(p => { if (p?.programme_type) { setProg(p); setType(p.programme_type); setPts(p.points_per_ksh?.toString() ?? '1'); setStamps(p.stamps_for_reward?.toString() ?? '10'); setDesc(p.reward_description ?? '') } })
      .catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSaving(true)
    try {
      await merchants.saveLoyaltyProgramme({ programme_type: type, points_per_ksh: type === 'POINTS' ? parseFloat(ptsPerKsh) : undefined, stamps_for_reward: type === 'STAMPS' ? parseInt(stamps) : undefined, reward_description: desc || undefined })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (err: any) { setError(err.message) } finally { setSaving(false) }
  }

  if (loading) return <div className="text-slate-600 text-sm py-8">Loading…</div>

  return (
    <div className="max-w-lg">
      <PageHeader title="Loyalty Programme" subtitle="Reward customers for repeat purchases." />

      {!prog && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm text-electric border border-electric/20 bg-electric/5">
          You don&apos;t have a loyalty programme yet — set one up below and it activates immediately.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Type toggle */}
        <GlassCard className="p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Programme Type</p>
          <div className="grid grid-cols-2 gap-3">
            {(['POINTS', 'STAMPS'] as const).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`py-4 rounded-xl border text-sm font-medium transition-all ${type === t ? 'bg-electric/10 border-electric/40 text-electric shadow-glow-sm' : 'border-white/5 text-slate-500 hover:border-white/15'}`}>
                <div className="text-2xl mb-1">{t === 'POINTS' ? '★' : '◈'}</div>
                {t === 'POINTS' ? 'Points' : 'Stamps'}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-3">
            {type === 'POINTS' ? 'Customers earn points on every purchase.' : 'Customers collect a stamp per visit — reward after N stamps.'}
          </p>
        </GlassCard>

        {/* Config */}
        <GlassCard className="p-5 space-y-4">
          {type === 'POINTS' ? (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Points per KSh spent</label>
              <input type="number" min="0.01" step="0.01" required value={ptsPerKsh} onChange={e => setPts(e.target.value)} className="input-dark" />
              <p className="text-xs text-slate-600 mt-1.5">1 → customer earns 1 point per KSh 1</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Stamps needed for a reward</label>
              <input type="number" min="2" max="100" required value={stamps} onChange={e => setStamps(e.target.value)} className="input-dark" />
              <p className="text-xs text-slate-600 mt-1.5">Every Nth purchase earns the reward</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Reward description <span className="text-slate-600 font-normal">(optional)</span></label>
            <input type="text" placeholder="e.g. Free cup of tea, 10% discount…" value={desc} onChange={e => setDesc(e.target.value)} className="input-dark" />
          </div>
        </GlassCard>

        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary w-full py-3 disabled:opacity-50">
          {saving ? 'Saving…' : saved ? '✓ Saved' : prog ? 'Update Programme' : 'Activate Programme'}
        </button>
      </form>
    </div>
  )
}
