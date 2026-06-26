import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { auth } from '@/lib/api'

const FIELDS = [
  { key: 'name',              label: 'Business name',        type: 'text',     required: true },
  { key: 'email',             label: 'Email',                type: 'email',    required: true },
  { key: 'password',          label: 'Password',             type: 'password', required: true },
  { key: 'phone',             label: 'Phone (254XXXXXXXXX)', type: 'tel',      required: true,  placeholder: '254712345678' },
  { key: 'businessRegNumber', label: 'Business reg. number', type: 'text',     required: false, placeholder: 'Optional' },
  { key: 'mpesaShortcode',    label: 'M-Pesa Till / Paybill',type: 'text',     required: false, placeholder: 'Optional' },
]

export default function MerchantRegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', businessRegNumber: '', mpesaShortcode: '' })
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      await auth.merchantRegister({
        name: form.name, email: form.email, password: form.password, phone: form.phone,
        businessRegNumber: form.businessRegNumber || undefined,
        mpesaShortcode:    form.mpesaShortcode    || undefined,
      })
      setSuccess(true)
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }

  if (success) {
    return (
      <div className="min-h-screen void-bg flex items-center justify-center p-4">
        <div className="glass-bright rounded-3xl p-10 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Application Received</h2>
          <p className="text-slate-400 text-sm mb-8">Your merchant account is pending review. We&apos;ll contact you within 1–2 business days.</p>
          <button onClick={() => navigate('/auth/login?registered=1&kyc=1')} className="btn-primary w-full py-3">
            Sign in to complete KYC
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen void-bg flex items-center justify-center p-4">
      <div className="glass-bright rounded-3xl p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <img src="/icons/Icon.png" alt="OrchestratePay" className="w-10 h-10 rounded-xl" />
          <div>
            <h1 className="text-xl font-bold text-white">Apply for merchant access</h1>
            <p className="text-xs text-slate-500">Your account is reviewed before activation</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {FIELDS.map(f => (
            <div key={f.key}>
              <label htmlFor={f.key} className="form-label">
                {f.label}{f.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              <input
                id={f.key}
                type={f.type} required={f.required} placeholder={f.placeholder}
                value={(form as any)[f.key]} onChange={set(f.key)}
                className="input-dark"
              />
            </div>
          ))}

          {error && <div role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">{error}</div>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3 mt-2">
            {loading ? 'Submitting…' : 'Submit application'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account? <Link to="/auth/login" className="text-electric hover:text-neon transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
