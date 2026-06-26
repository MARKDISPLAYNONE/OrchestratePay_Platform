import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveAdminSecret, verifyAdminSecret } from '@/lib/api'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [secret, setSecret]         = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try { await verifyAdminSecret(secret); saveAdminSecret(secret); navigate('/admin') }
    catch { setError('Invalid admin secret — check your ADMIN_SECRET value.') }
    finally { setLoading(false) }
  }

  return (
    <div className="void-bg min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Wordless logo watermark */}
      <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <img src="/icons/logo.png" alt="" className="select-none"
          style={{ width: 2000, height: 'auto', opacity: 0.38, filter: 'invert(1) hue-rotate(180deg) blur(1px)' }} />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <button onClick={() => navigate('/auth/login')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-8">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" /></svg>
          Back to login
        </button>

        <div className="text-center mb-8">
          <img src="/icons/logo.png" alt="Tap2Pay" className="w-20 h-auto mx-auto mb-3"
            style={{ filter: 'invert(1) hue-rotate(180deg) drop-shadow(0 0 10px rgba(0,175,255,0.5))' }} />
          <div className="text-xl font-bold text-electric mb-0.5">Tap2Pay</div>
          <div className="text-sm text-slate-500">Admin Portal</div>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl p-8 space-y-4"
          style={{ background: 'rgba(8,15,30,0.18)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid rgba(0,175,255,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Admin secret</label>
            <div className="relative">
              <input type={showSecret ? 'text' : 'password'} required value={secret} onChange={e => setSecret(e.target.value)} placeholder="Enter ADMIN_SECRET from .env"
                className="input-dark pr-10" />
              <button type="button" onClick={() => setShowSecret(v => !v)} aria-label={showSecret ? 'Hide' : 'Show'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-300">
                {showSecret
                  ? <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" /><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" /></svg>
                  : <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                }
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-50">{loading ? 'Verifying…' : 'Sign in to admin'}</button>
        </form>
      </div>
    </div>
  )
}
