import { useEffect, useState } from 'react'
import { merchants } from '@/lib/api'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

export default function MerchantSettingsPage() {
  const [form, setForm] = useState({ name: '', phone: '', mpesaShortcode: '', mpesaAccountRef: '', kraPin: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    merchants.getProfile()
      .then(p => setForm({ name: p.name ?? '', phone: p.phone ?? '', mpesaShortcode: p.mpesa_shortcode ?? '', mpesaAccountRef: p.mpesa_account_ref ?? '', kraPin: p.kra_pin ?? '' }))
      .finally(() => setLoading(false))
  }, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSaving(true)
    try {
      await merchants.updateProfile({ name: form.name || undefined, phone: form.phone || undefined, mpesaShortcode: form.mpesaShortcode || undefined, mpesaAccountRef: form.mpesaAccountRef || undefined, kraPin: form.kraPin || undefined })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (err: any) { setError(err.message) } finally { setSaving(false) }
  }

  if (loading) return <div className="text-slate-600 text-sm py-8">Loading…</div>

  const fields = [
    { key: 'name'           as const, label: 'Business name',         placeholder: 'Wanjiku Groceries'  },
    { key: 'phone'          as const, label: 'Contact phone',          placeholder: '254712345678'        },
    { key: 'mpesaShortcode' as const, label: 'M-Pesa Till / Paybill',  placeholder: '174379'             },
    { key: 'mpesaAccountRef'as const, label: 'M-Pesa account ref',    placeholder: 'WanjikuShop'         },
    { key: 'kraPin'         as const, label: 'KRA PIN',                placeholder: 'P051234567X'         },
  ]

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader title="Settings" subtitle="Update your business and payment details." />

      <form onSubmit={handleSave}>
        <GlassCard className="p-6 space-y-4">
          {fields.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
              <input type="text" placeholder={placeholder} value={form[key]} onChange={set(key)} className="input-dark" />
            </div>
          ))}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full py-3 disabled:opacity-50">
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
          </button>
        </GlassCard>
      </form>

      <GlassCard className="p-6">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Account info</h2>
        <p className="text-sm text-slate-500">To change your email or password, or to deactivate your account, contact{' '}
          <a href="mailto:support@orchestratepay.co.ke" className="text-electric hover:text-neon transition-colors">support@orchestratepay.co.ke</a>
        </p>
      </GlassCard>
    </div>
  )
}
