'use client'
import { useEffect, useState } from 'react'
import { consumers }           from '@/lib/api'

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null)
  const [displayName, setDisplayName] = useState('')
  const [smsOptIn, setSmsOptIn]       = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveError, setSaveError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    consumers.getProfile()
      .then(p => {
        setProfile(p)
        setDisplayName(p.display_name ?? '')
        setSmsOptIn(Boolean(p.sms_opt_in))
      })
      .finally(() => setLoading(false))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    try {
      await consumers.updateProfile({ displayName, smsOptIn })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to save — please try again.')
    }
  }

  if (loading) return <div className="py-6 text-sm text-gray-400">Loading…</div>

  return (
    <div className="py-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="mb-4">
          <div className="text-sm text-gray-500 font-medium">Phone</div>
          <div className="text-gray-800">{profile?.phone ?? '—'}</div>
        </div>
        {profile?.email && (
          <div className="mb-4">
            <div className="text-sm text-gray-500 font-medium">Email</div>
            <div className="text-gray-800">{profile.email}</div>
          </div>
        )}
      </div>

      <form onSubmit={save} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Preferences</h2>

        <div>
          <label htmlFor="display-name" className="block text-sm font-medium text-gray-700 mb-1">Display name</label>
          <input
            id="display-name"
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. Jane"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={smsOptIn}
            onChange={e => setSmsOptIn(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded"
          />
          <div>
            <div className="text-sm font-medium text-gray-800">SMS receipts</div>
            <div className="text-xs text-gray-500">
              Receive a text confirmation after each payment
            </div>
          </div>
        </label>

        {saveError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {saveError}
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
        >
          {saved ? 'Saved ✓' : 'Save changes'}
        </button>
      </form>
    </div>
  )
}
