'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/api'

export default function MerchantRegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '', email: '', password: '', phone: '',
    businessRegNumber: '', mpesaShortcode: '',
  })
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await auth.merchantRegister({
        name:               form.name,
        email:              form.email,
        password:           form.password,
        phone:              form.phone,
        businessRegNumber:  form.businessRegNumber || undefined,
        mpesaShortcode:     form.mpesaShortcode || undefined,
      })
      setSuccess(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Application Received</h2>
          <p className="text-gray-600 text-sm mb-6">
            Your merchant account is pending review. We will contact you within 1–2 business days.
          </p>
          <button onClick={() => router.push('/auth/login')}
            className="text-green-600 text-sm hover:underline">
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  const fields: { key: string; label: string; type?: string; required?: boolean; placeholder?: string }[] = [
    { key: 'name',               label: 'Business name',         required: true  },
    { key: 'email',              label: 'Email',                  type: 'email', required: true },
    { key: 'password',           label: 'Password',               type: 'password', required: true },
    { key: 'phone',              label: 'Phone (254XXXXXXXXX)',   required: true,  placeholder: '254712345678' },
    { key: 'businessRegNumber',  label: 'Business reg. number',   placeholder: 'Optional' },
    { key: 'mpesaShortcode',     label: 'M-Pesa Till / Paybill',  placeholder: 'Optional' },
  ]

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Apply for merchant access</h1>
          <p className="text-sm text-gray-500 mt-1">
            Your account will be reviewed before activation.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" suppressHydrationWarning>
          {fields.map(f => (
            <div key={f.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
              <input
                type={f.type ?? 'text'}
                required={f.required}
                placeholder={f.placeholder}
                value={(form as any)[f.key]}
                onChange={set(f.key)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          ))}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-50 transition-colors"
          >
            {loading ? 'Submitting…' : 'Submit application'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <a href="/auth/login" className="text-green-600 hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
