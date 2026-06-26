import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { auth } from '@/lib/api'
import { saveToken } from '@/lib/auth'

type Mode = 'merchant' | 'consumer'
interface GooglePending { credential: string; email: string; displayName: string }

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const registered  = searchParams.get('registered') === '1'
  const kycRedirect = searchParams.get('kyc') === '1'

  const [mode, setMode]           = useState<Mode>('merchant')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [googlePending, setGooglePending] = useState<GooglePending | null>(null)
  const [googlePhone, setGooglePhone]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      if (mode === 'merchant') {
        const res = await auth.merchantLogin(email, password, 'web-browser')
        saveToken(res.token, false)
        navigate('/merchant/dashboard')
      } else {
        const res = await auth.consumerLogin(email, password)
        saveToken(res.token, true)
        navigate('/consumer/dashboard')
      }
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleGoogleSuccess(cr: CredentialResponse) {
    if (!cr.credential) return
    setError(''); setLoading(true)
    try {
      const res = await auth.googleLogin(cr.credential, mode)
      if ('needsPhone' in res) {
        setGooglePending({ credential: cr.credential, email: res.email, displayName: res.displayName })
        setLoading(false); return
      }
      saveToken(res.token, mode === 'consumer')
      navigate(mode === 'merchant' ? '/merchant/dashboard' : '/consumer/dashboard')
    } catch (err: any) { setError(err.message); setLoading(false) }
  }

  async function handleGooglePhone(e: React.FormEvent) {
    e.preventDefault()
    if (!googlePending) return
    setError(''); setLoading(true)
    try {
      const res = await auth.googleLogin(googlePending.credential, 'consumer', googlePhone)
      if ('needsPhone' in res) { setError('Phone required'); setLoading(false); return }
      saveToken(res.token, true)
      navigate('/consumer/dashboard')
    } catch (err: any) { setError(err.message); setLoading(false) }
  }

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  return (
    <div className="min-h-screen flex flex-col void-bg relative overflow-hidden">
      {/* Wordless logo watermark */}
      <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <img src="/icons/logo.png" alt="" className="select-none"
          style={{ width: 2000, height: 'auto', opacity: 0.38, filter: 'invert(1) hue-rotate(180deg) blur(1px)' }} />
      </div>

      {/* Ambient glow */}
      <div aria-hidden className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,175,255,0.06) 0%, transparent 70%)' }} />

      {/* Particles */}
      <div aria-hidden className="particles-bg">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="particle" style={{
            left: `${8 + i * 8}%`,
            animationDuration: `${8 + (i % 5) * 3}s`,
            animationDelay: `${i * 0.8}s`,
            '--dx': `${(i % 3 - 1) * 40}px`,
          } as any} />
        ))}
      </div>

      {/* Navbar */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 h-16 shrink-0"
        style={{ borderBottom: '1px solid rgba(0,175,255,0.08)', background: 'rgba(5,7,15,0.7)', backdropFilter: 'blur(12px)' }}>
        <Link to="/" className="flex items-center gap-2.5 select-none">
          <img src="/icons/Icon.png" alt="Tap2Pay" className="w-8 h-8 rounded-lg" />
          <span className="text-white font-bold text-base tracking-tight">
            Tap<span className="text-electric">2</span>Pay
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-500">
          {['Features', 'Pricing', 'Developers', 'Support'].map(l => (
            <a key={l} href="#" className="hover:text-white transition-colors">{l}</a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/auth/register/merchant" className="hidden md:inline-flex text-sm font-medium text-slate-500 hover:text-white transition-colors">
            Apply as merchant
          </Link>
          <Link to="/auth/register/consumer"
            className="btn-primary text-xs px-4 py-2">
            Get started
          </Link>
        </div>
      </header>

      {/* Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-3xl px-8 py-10"
          style={{ background: 'rgba(8,15,30,0.18)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid rgba(0,175,255,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <img src="/icons/logo.png" alt="Tap2Pay" className="w-24 h-auto mb-3"
              style={{ filter: 'invert(1) hue-rotate(180deg) drop-shadow(0 0 10px rgba(0,175,255,0.5))' }} />
            <p className="text-sm text-electric/70 tracking-wide">Sign in to your account</p>
          </div>

          {/* Success banner */}
          {registered && (
            <div className="mb-5 rounded-xl px-4 py-3 text-sm text-center text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
              {kycRedirect ? 'Account created! Log in to complete KYC.' : 'Account created! Please sign in.'}
            </div>
          )}

          {/* Mode toggle */}
          <div className="relative flex bg-white/[0.04] rounded-xl p-1 mb-6">
            <div className="absolute top-1 bottom-1 rounded-[10px] bg-gradient-to-r from-electric to-blue-600 transition-all duration-200"
              style={{ width: 'calc(50% - 6px)', left: mode === 'merchant' ? 4 : 'calc(50% + 2px)', boxShadow: '0 2px 12px rgba(0,175,255,0.3)' }} />
            {(['merchant', 'consumer'] as Mode[]).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); setShowPw(false) }}
                className={`relative z-10 flex-1 py-2 text-sm font-semibold capitalize tracking-wide transition-colors duration-200 ${mode === m ? 'text-white' : 'text-slate-500 hover:text-slate-400'}`}>
                {m}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">Email</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" width={14} height={14} viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
                <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" className="input-dark pl-9" />
              </div>
            </div>

            <div>
              <label className="form-label">Password</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" width={14} height={14} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <input type={showPw ? 'text' : 'password'} required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                  className="input-dark pl-9 pr-10" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-600 hover:text-slate-400 transition-colors" aria-label="Show password">
                  {showPw
                    ? <svg width={14} height={14} viewBox="0 0 20 20" fill="currentColor"><path d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" /><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" /></svg>
                    : <svg width={14} height={14} viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                  }
                </button>
              </div>
            </div>

            {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">{error}</div>}

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-sm tracking-wide">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Google */}
          {!googlePending && googleClientId && (
            <div className="mt-5">
              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-xs text-slate-600 select-none">or</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
              <div className="mt-4 flex justify-center">
                <GoogleLogin onSuccess={handleGoogleSuccess} onError={() => setError('Google sign-in failed')}
                  theme="filled_black" shape="rectangular" size="large" text="continue_with" width="288" useOneTap={false} />
              </div>
            </div>
          )}

          {/* Google phone collection */}
          {googlePending && (
            <form onSubmit={handleGooglePhone} className="mt-5 space-y-4">
              <div className="rounded-xl px-4 py-3 text-sm bg-electric/5 border border-electric/20">
                <p className="text-slate-300 font-medium">{googlePending.displayName}</p>
                <p className="text-slate-500 text-xs mt-0.5">{googlePending.email}</p>
              </div>
              <p className="text-xs text-slate-500">Enter your M-Pesa phone to complete sign-up.</p>
              <div>
                <label className="form-label">M-Pesa Phone</label>
                <input type="tel" required autoFocus value={googlePhone}
                  onChange={e => setGooglePhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="254712345678" className="input-dark" />
              </div>
              {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setGooglePending(null); setGooglePhone(''); setError('') }} className="btn-ghost flex-1 py-2.5">Back</button>
                <button type="submit" disabled={loading} className="btn-primary flex-1 py-2.5">
                  {loading ? 'Creating…' : 'Create account'}
                </button>
              </div>
            </form>
          )}

          {/* Register links */}
          {!googlePending && (
            <div className="mt-6 text-center text-sm text-slate-600">
              {mode === 'merchant'
                ? <p>New merchant? <Link to="/auth/register/merchant" className="text-electric hover:text-neon font-medium transition-colors">Apply for access</Link></p>
                : <p>New customer? <Link to="/auth/register/consumer" className="text-electric hover:text-neon font-medium transition-colors">Create account</Link></p>
              }
            </div>
          )}

          <div className="mt-4 pt-4 text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <Link to="/admin/login" className="text-xs text-slate-700 hover:text-slate-500 tracking-wide transition-colors">
              Admin portal →
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(5,7,15,0.8)', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-6xl mx-auto px-6 md:px-12 py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <img src="/icons/Icon.png" alt="Tap2Pay" className="w-6 h-6 rounded-md" />
              <span className="text-white font-bold text-sm">Tap<span className="text-electric">2</span>Pay</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">NFC tap-to-pay infrastructure for Kenyan SMEs. Fast, secure, M-Pesa integrated.</p>
          </div>
          {[['Product', ['Merchant Dashboard', 'Consumer Wallet', 'NFC Tags', 'Analytics', 'Accounting']],
            ['Developers', ['API Docs', 'SDKs', 'Webhooks', 'Status', 'Changelog']],
            ['Company', ['About', 'Blog', 'Careers', 'Contact', 'Press']]].map(([title, links]) => (
            <div key={title as string}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">{title as string}</p>
              <ul className="space-y-2.5 text-sm text-slate-600">
                {(links as string[]).map(l => <li key={l}><a href="#" className="hover:text-slate-400 transition-colors">{l}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="max-w-6xl mx-auto px-6 md:px-12 py-4 flex flex-col md:flex-row items-center justify-between gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <p className="text-xs text-slate-700">© {new Date().getFullYear()} Tap2Pay. All rights reserved.</p>
          <div className="flex items-center gap-5 text-xs text-slate-700">
            {['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map(l => (
              <a key={l} href="#" className="hover:text-slate-500 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
