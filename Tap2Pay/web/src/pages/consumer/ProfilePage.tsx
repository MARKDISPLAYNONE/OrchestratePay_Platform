import { useEffect, useState } from 'react'
import { consumers } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'

export default function ConsumerProfilePage() {
  const [profile, setProfile]         = useState<any>(null)
  const [displayName, setDisplayName] = useState('')
  const [smsOptIn, setSmsOptIn]       = useState(false)
  const [saved, setSaved]             = useState(false)
  const [saveError, setSaveError]     = useState('')
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    consumers.getProfile().then(p => { setProfile(p); setDisplayName(p.display_name ?? ''); setSmsOptIn(Boolean(p.sms_opt_in)) }).finally(() => setLoading(false))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaveError('')
    try { await consumers.updateProfile({ displayName, smsOptIn }); setSaved(true); setTimeout(() => setSaved(false), 2500) }
    catch (err: any) { setSaveError(err.message ?? 'Failed to save — please try again.') }
  }

  if (loading) return <div className="py-6 text-sm text-slate-600">Loading…</div>

  return (
    <div className="space-y-5 max-w-sm">
      <h1 className="text-2xl font-bold text-white">Profile</h1>

      <GlassCard className="p-5 space-y-3">
        {[['Phone', profile?.phone], ['Email', profile?.email]].map(([label, val]) => val ? (
          <div key={label as string}>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{label}</div>
            <div className="text-slate-200 mt-0.5">{val}</div>
          </div>
        ) : null)}
      </GlassCard>

      <form onSubmit={save}>
        <GlassCard className="p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Preferences</h2>
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-slate-300 mb-1.5">Display name</label>
            <input id="displayName" type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Jane" className="input-dark" />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={smsOptIn}
                onChange={e => setSmsOptIn(e.target.checked)}
                className="sr-only"
                aria-label="SMS receipts"
              />
              <div className={`w-10 h-5 rounded-full transition-all ${smsOptIn ? 'bg-electric' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${smsOptIn ? 'left-5' : 'left-0.5'}`} />
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-slate-200">SMS receipts</div>
              <div className="text-xs text-slate-600">Receive a text after each payment</div>
            </div>
          </label>
          {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          <button type="submit" className="btn-primary w-full py-3">{saved ? '✓ Saved' : 'Save changes'}</button>
        </GlassCard>
      </form>
    </div>
  )
}
