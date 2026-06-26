import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { auth } from '@/lib/api'
import { saveToken } from '@/lib/auth'

export default function ConsumerRegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ phone: '', email: '', password: '', displayName: '' })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = await auth.consumerRegister({
        phone:       form.phone,
        email:       form.email       || undefined,
        password:    form.password    || undefined,
        displayName: form.displayName || undefined,
      })
      saveToken(res.token, true)
      navigate('/consumer/dashboard')
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen void-bg flex items-center justify-center p-4">
      <div className="glass-bright rounded-3xl p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/icons/Icon.png" alt="OrchestratePay" className="w-14 h-14 rounded-2xl mx-auto mb-4 shadow-glow" />
          <h1 className="text-xl font-bold text-white">Create your wallet</h1>
          <p className="text-xs text-slate-500 mt-1">OrchestratePay Consumer</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="form-label">Phone number <span className="text-red-400">*</span></label>
            <input type="tel" required placeholder="254712345678" value={form.phone} onChange={set('phone')} className="input-dark" />
            <p className="text-xs text-slate-600 mt-1">M-Pesa number — format 254XXXXXXXXX</p>
          </div>

          <div>
            <label className="form-label">Display name</label>
            <input type="text" placeholder="e.g. Jane Kamau" value={form.displayName} onChange={set('displayName')} className="input-dark" />
          </div>

          <div>
            <label className="form-label">Email <span className="text-slate-600 font-normal normal-case">(optional)</span></label>
            <input type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} className="input-dark" />
          </div>

          <div>
            <label className="form-label">Password <span className="text-slate-600 font-normal normal-case">(optional)</span></label>
            <input type="password" placeholder="Min 8 characters" value={form.password} onChange={set('password')} className="input-dark" />
          </div>

          {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">{error}</div>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account? <Link to="/auth/login" className="text-electric hover:text-neon transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
