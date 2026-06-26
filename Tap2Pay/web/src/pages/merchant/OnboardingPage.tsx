import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '@/lib/api'

const BUSINESS_TYPES = [
  { value: 'SOLE_TRADER',     label: 'Sole Trader / Individual' },
  { value: 'PARTNERSHIP',     label: 'Partnership' },
  { value: 'LIMITED_COMPANY', label: 'Limited Company' },
  { value: 'NGO',             label: 'NGO / Non-Profit' },
  { value: 'COOPERATIVE',     label: 'Cooperative Society' },
  { value: 'OTHER',           label: 'Other' },
]

type Step = 1 | 2 | 3

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} className="input-dark" />
    </div>
  )
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep]         = useState<Step>(1)
  const [submitting, setSubmit] = useState(false)
  const [error, setError]       = useState('')

  // Step 1
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [phone, setPhone]       = useState('')
  const [password, setPassword] = useState('')

  // Step 2
  const [bizType, setBizType]   = useState('')
  const [addr1, setAddr1]       = useState('')
  const [city, setCity]         = useState('')
  const [nature, setNature]     = useState('')
  const [vol, setVol]           = useState('')
  const [kra, setKra]           = useState('')
  const [shortcode, setShortcode] = useState('')

  // Step 3
  const [ownerName, setOwnerName]   = useState('')
  const [ownerIdNo, setOwnerIdNo]   = useState('')
  const [ownerPct, setOwnerPct]     = useState('')

  function next() {
    setError('')
    if (step === 1) { if (!name.trim()) { setError('Business name is required'); return } if (!email.trim()) { setError('Email is required'); return } if (!phone.trim()) { setError('Phone number is required'); return } if (password.length < 8) { setError('Password must be at least 8 characters'); return } }
    if (step === 2 && !bizType) { setError('Business type is required'); return }
    if (step < 3) setStep((step + 1) as Step)
  }

  async function handleSubmit() {
    setError(''); setSubmit(true)
    try {
      const payload: Parameters<typeof auth.merchantRegister>[0] = { name: name.trim(), email: email.trim(), password, phone: phone.trim(), mpesaShortcode: shortcode.trim() || undefined, businessType: bizType || undefined, businessAddressLine1: addr1.trim() || undefined, businessAddressCity: city.trim() || undefined, natureOfBusiness: nature.trim() || undefined, kraPin: kra.trim() || undefined }
      const v = parseInt(vol)
      if (!isNaN(v) && v > 0) payload.expectedMonthlyVolumeCents = v * 100
      if (ownerName.trim()) { payload.beneficialOwnerName = ownerName.trim(); payload.beneficialOwnerIdNumber = ownerIdNo.trim() || undefined; const p = parseInt(ownerPct); if (!isNaN(p)) payload.beneficialOwnerOwnershipPct = p }
      await auth.merchantRegister(payload)
      navigate('/auth/login?registered=1&kyc=1')
    } catch (e: any) { setError(e.message ?? 'Registration failed') } finally { setSubmit(false) }
  }

  const stepTitles: Record<Step, string> = { 1: 'Account details', 2: 'Business information', 3: 'Beneficial ownership' }

  return (
    <div className="void-bg min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/icons/Icon.png" alt="OrchestratePay" className="w-14 h-14 rounded-2xl mx-auto mb-3" style={{ filter: 'drop-shadow(0 0 12px rgba(0,175,255,0.4))' }} />
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="text-sm text-slate-500 mt-1">Step {step} of 3 — {stepTitles[step]}</p>
        </div>

        {/* Progress */}
        <div className="flex gap-1.5 mb-8">
          {([1, 2, 3] as Step[]).map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-300 ${s <= step ? 'bg-electric' : 'bg-white/10'}`} />
          ))}
        </div>

        <div className="glass rounded-2xl p-8 space-y-4">
          {step === 1 && (
            <>
              <Field label="Business name *" value={name} onChange={setName} placeholder="Wanjiku Groceries" />
              <Field label="Email address *" type="email" value={email} onChange={setEmail} placeholder="you@business.co.ke" />
              <Field label="Phone number *" type="tel" value={phone} onChange={setPhone} placeholder="254712345678" />
              <Field label="Password *" type="password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" />
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Business type *</label>
                <select value={bizType} onChange={e => setBizType(e.target.value)} className="input-dark">
                  <option value="">Select business type…</option>
                  {BUSINESS_TYPES.map(bt => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
                </select>
              </div>
              <Field label="Business address" value={addr1} onChange={setAddr1} placeholder="Shop 4, Kimathi Street" />
              <Field label="City" value={city} onChange={setCity} placeholder="Nairobi" />
              <Field label="Nature of business" value={nature} onChange={setNature} placeholder="Retail grocery store" />
              <Field label="Expected monthly revenue (KES)" type="number" value={vol} onChange={setVol} placeholder="200000" />
              <Field label="KRA PIN" value={kra} onChange={setKra} placeholder="P051234567X" />
              <Field label="M-Pesa Till / Paybill" value={shortcode} onChange={setShortcode} placeholder="174379" />
            </>
          )}

          {step === 3 && (
            <>
              <div className="px-3 py-2.5 rounded-xl text-xs text-amber-400 border border-amber-500/20 bg-amber-500/5">
                CBK AML regulations require disclosure of all individuals who own 10% or more of this business.
              </div>
              <Field label="Beneficial owner full name" value={ownerName} onChange={setOwnerName} placeholder="John Kamau Mwangi" />
              <Field label="Owner&apos;s National ID / Passport number" value={ownerIdNo} onChange={setOwnerIdNo} placeholder="12345678" />
              <Field label="Ownership percentage (%)" type="number" value={ownerPct} onChange={setOwnerPct} placeholder="100" />
              <p className="text-xs text-slate-600">Leave blank if you are the sole owner.</p>
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            {step > 1 && <button type="button" onClick={() => { setError(''); setStep((step - 1) as Step) }} className="btn-ghost flex-1 py-3">Back</button>}
            {step < 3
              ? <button type="button" onClick={next} className="btn-primary flex-1 py-3">Continue</button>
              : <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1 py-3 disabled:opacity-50">{submitting ? 'Creating account…' : 'Create account'}</button>
            }
          </div>

          {step === 3 && (
            <button type="button" onClick={handleSubmit} disabled={submitting} className="w-full text-xs text-slate-600 hover:text-slate-400 transition-colors">
              Skip beneficial ownership and submit
            </button>
          )}
        </div>

        <p className="text-center text-sm text-slate-600 mt-6">
          Already have an account?{' '}
          <a href="/auth/login" className="text-electric hover:text-neon transition-colors">Sign in</a>
        </p>
      </div>
    </div>
  )
}
