'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/api'

const BUSINESS_TYPES = [
  { value: 'SOLE_TRADER',       label: 'Sole Trader / Individual' },
  { value: 'PARTNERSHIP',       label: 'Partnership' },
  { value: 'LIMITED_COMPANY',   label: 'Limited Company' },
  { value: 'NGO',               label: 'NGO / Non-Profit' },
  { value: 'COOPERATIVE',       label: 'Cooperative Society' },
  { value: 'OTHER',             label: 'Other' },
]

type Step = 1 | 2 | 3

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Step 1
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [phone,    setPhone]    = useState('')
  const [password, setPassword] = useState('')

  // Step 2
  const [businessType,               setBusinessType]               = useState('')
  const [businessAddressLine1,       setBusinessAddressLine1]       = useState('')
  const [businessAddressCity,        setBusinessAddressCity]        = useState('')
  const [natureOfBusiness,           setNatureOfBusiness]           = useState('')
  const [expectedMonthlyVolumeCents, setExpectedMonthlyVolumeCents] = useState('')
  const [kraPin,                     setKraPin]                     = useState('')
  const [mpesaShortcode,             setMpesaShortcode]             = useState('')

  // Step 3
  const [beneficialOwnerName,         setBeneficialOwnerName]         = useState('')
  const [beneficialOwnerIdNumber,     setBeneficialOwnerIdNumber]     = useState('')
  const [beneficialOwnerOwnershipPct, setBeneficialOwnerOwnershipPct] = useState('')

  function validateStep1() {
    if (!name.trim())  { setError('Business name is required'); return false }
    if (!email.trim()) { setError('Email is required'); return false }
    if (!phone.trim()) { setError('Phone number is required'); return false }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return false }
    return true
  }

  function validateStep2() {
    if (!businessType) { setError('Business type is required'); return false }
    return true
  }

  async function handleSubmit() {
    setError('')
    setSubmitting(true)
    try {
      const payload: Parameters<typeof auth.merchantRegister>[0] = {
        name:            name.trim(),
        email:           email.trim(),
        password,
        phone:           phone.trim(),
        mpesaShortcode:  mpesaShortcode.trim() || undefined,
        businessType:    businessType || undefined,
        businessAddressLine1: businessAddressLine1.trim() || undefined,
        businessAddressCity:  businessAddressCity.trim()  || undefined,
        natureOfBusiness:     natureOfBusiness.trim()     || undefined,
        kraPin:               kraPin.trim()               || undefined,
      }
      const vol = parseInt(expectedMonthlyVolumeCents)
      if (!isNaN(vol) && vol > 0) payload.expectedMonthlyVolumeCents = vol * 100  // KES → cents
      if (beneficialOwnerName.trim()) {
        payload.beneficialOwnerName         = beneficialOwnerName.trim()
        payload.beneficialOwnerIdNumber     = beneficialOwnerIdNumber.trim() || undefined
        const pct = parseInt(beneficialOwnerOwnershipPct)
        if (!isNaN(pct)) payload.beneficialOwnerOwnershipPct = pct
      }
      await auth.merchantRegister(payload)
      router.push('/auth/login?registered=1&kyc=1')
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  function handleNext() {
    setError('')
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    if (step < 3) setStep((step + 1) as Step)
  }

  const stepTitles: Record<Step, string> = {
    1: 'Account details',
    2: 'Business information',
    3: 'Beneficial ownership',
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-8 w-full max-w-md space-y-6">

        {/* Progress */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            {([1,2,3] as Step[]).map(s => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-blue-500' : 'bg-gray-200'}`} />
            ))}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{stepTitles[step]}</h1>
          <p className="text-sm text-gray-500 mt-1">Step {step} of 3</p>
        </div>

        <div className="space-y-4">
          {/* ── Step 1 ── */}
          {step === 1 && (
            <>
              <Field label="Business name *" value={name} onChange={setName} placeholder="Wanjiku Groceries" />
              <Field label="Email address *" type="email" value={email} onChange={setEmail} placeholder="you@business.co.ke" />
              <Field label="Phone number *" type="tel" value={phone} onChange={setPhone} placeholder="254712345678" />
              <Field label="Password *" type="password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" />
            </>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business type *</label>
                <select
                  value={businessType}
                  onChange={e => setBusinessType(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select business type…</option>
                  {BUSINESS_TYPES.map(bt => (
                    <option key={bt.value} value={bt.value}>{bt.label}</option>
                  ))}
                </select>
              </div>
              <Field label="Business address" value={businessAddressLine1} onChange={setBusinessAddressLine1} placeholder="Shop 4, Kimathi Street" />
              <Field label="City" value={businessAddressCity} onChange={setBusinessAddressCity} placeholder="Nairobi" />
              <Field label="Nature of business" value={natureOfBusiness} onChange={setNatureOfBusiness} placeholder="Retail grocery store" />
              <Field
                label="Expected monthly revenue (KES)"
                type="number"
                value={expectedMonthlyVolumeCents}
                onChange={setExpectedMonthlyVolumeCents}
                placeholder="e.g. 200000"
              />
              <Field
                label="KRA PIN"
                value={kraPin}
                onChange={setKraPin}
                placeholder="P051234567X"
              />
              <Field
                label="M-Pesa Till / Paybill"
                value={mpesaShortcode}
                onChange={setMpesaShortcode}
                placeholder="174379"
              />
            </>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                CBK AML regulations require disclosure of all individuals who own 10% or more of this business.
              </div>
              <Field label="Beneficial owner full name" value={beneficialOwnerName} onChange={setBeneficialOwnerName} placeholder="John Kamau Mwangi" />
              <Field label="Owner&apos;s National ID / Passport number" value={beneficialOwnerIdNumber} onChange={setBeneficialOwnerIdNumber} placeholder="12345678" />
              <Field label="Ownership percentage (%)" type="number" value={beneficialOwnerOwnershipPct} onChange={setBeneficialOwnerOwnershipPct} placeholder="100" />
              <p className="text-xs text-gray-400">Leave blank if you are a sole trader and the business is solely owned by you as the account holder.</p>
            </>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={() => { setError(''); setStep((step - 1) as Step) }}
                className="flex-1 border border-gray-300 text-gray-700 font-medium rounded-lg py-2.5 text-sm hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Creating account…' : 'Create account'}
              </button>
            )}
          </div>

          {step === 3 && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full text-sm text-gray-400 hover:text-gray-600"
            >
              Skip beneficial ownership and submit
            </button>
          )}
        </div>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <a href="/auth/login" className="text-blue-600 hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, type = 'text'
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}
