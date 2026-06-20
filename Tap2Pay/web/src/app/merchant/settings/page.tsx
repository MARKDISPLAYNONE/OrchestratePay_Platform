'use client'
import { useEffect, useState } from 'react'
import { merchants }           from '@/lib/api'

export default function MerchantSettingsPage() {
  const [form, setForm] = useState({
    name: '', phone: '', mpesaShortcode: '', mpesaAccountRef: '', kraPin: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    merchants.getProfile()
      .then(p => setForm({
        name:           p.name ?? '',
        phone:          p.phone ?? '',
        mpesaShortcode: p.mpesa_shortcode ?? '',
        mpesaAccountRef: p.mpesa_account_ref ?? '',
        kraPin:         p.kra_pin ?? '',
      }))
      .finally(() => setLoading(false))
  }, [])

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      await merchants.updateProfile({
        name:           form.name           || undefined,
        phone:          form.phone          || undefined,
        mpesaShortcode: form.mpesaShortcode || undefined,
        mpesaAccountRef: form.mpesaAccountRef || undefined,
        kraPin:         form.kraPin         || undefined,
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

  const fields = [
    { key: 'name',           label: 'Business name',        placeholder: 'Wanjiku Groceries'      },
    { key: 'phone',          label: 'Contact phone',         placeholder: '254712345678'           },
    { key: 'mpesaShortcode', label: 'M-Pesa Till / Paybill', placeholder: '174379'                },
    { key: 'mpesaAccountRef',label: 'M-Pesa account ref',   placeholder: 'e.g. WanjikuShop'      },
    { key: 'kraPin',         label: 'KRA PIN',               placeholder: 'P051234567X'           },
  ] as const

  return (
    <div className="p-8 max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Update your business and payment details.</p>
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input
              type="text"
              placeholder={placeholder}
              value={form[key]}
              onChange={set(key)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit" disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
        </button>
      </form>

      {/* Danger zone */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Account info</h2>
        <div className="space-y-2 text-sm text-gray-500">
          <div>To change your email or password, contact support.</div>
          <div>To deactivate your account, contact{' '}
            <a href="mailto:support@orchestratepay.co.ke" className="text-blue-600 hover:underline">
              support@orchestratepay.co.ke
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
