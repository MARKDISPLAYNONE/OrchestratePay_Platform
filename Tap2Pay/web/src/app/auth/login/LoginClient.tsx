'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { auth } from '@/lib/api'
import { saveToken } from '@/lib/auth'

type Mode = 'merchant' | 'consumer'

export default function LoginClient() {
  const router = useRouter()
  const [mode, setMode]         = useState<Mode>('merchant')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'merchant') {
        const res = await auth.merchantLogin(email, password, 'web-browser')
        saveToken(res.token, false)
        router.push('/merchant/dashboard')
      } else {
        const res = await auth.consumerLogin(email, password)
        saveToken(res.token, true)
        router.push('/consumer/dashboard')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 35%, #0d1a2e 0%, #050b18 65%)' }}
    >
      {/* Doodle pattern */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: "url('/pattern.svg')", backgroundRepeat: 'repeat', backgroundSize: '320px 320px', opacity: 0.07 }}
      />

      {/* Ambient blue glow */}
      <div
        aria-hidden="true"
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] h-[640px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }}
      />

      {/* ── Navbar ── */}
      <header
        className="relative z-10 flex items-center justify-between px-6 md:px-12 h-16 shrink-0"
        style={{ borderBottom: '1px solid rgba(59,130,246,0.12)', background: 'rgba(5,11,24,0.6)', backdropFilter: 'blur(12px)' }}
      >
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 select-none">
          <Image src="/icons/Icon.png" alt="Tap2Pay" width={32} height={32} className="rounded-lg" />
          <span className="text-white font-bold text-base tracking-tight">
            Tap<span className="text-blue-400">2</span>Pay
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
          <a href="#" className="hover:text-white transition-colors">Features</a>
          <a href="#" className="hover:text-white transition-colors">Pricing</a>
          <a href="#" className="hover:text-white transition-colors">Developers</a>
          <a href="#" className="hover:text-white transition-colors">Support</a>
        </nav>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <Link
            href="/auth/register/merchant"
            className="hidden md:inline-flex items-center text-sm font-medium text-slate-400 hover:text-white transition-colors"
          >
            Apply as merchant
          </Link>
          <Link
            href="/auth/register/consumer"
            className="inline-flex items-center px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all duration-200"
            style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', boxShadow: '0 2px 10px rgba(37,99,235,0.35)' }}
          >
            Get started
          </Link>
        </div>
      </header>

      {/* ── Main — login card centred ── */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        <div
          className="w-full max-w-sm rounded-3xl px-8 py-10 backdrop-blur-xl"
          style={{
            background: 'rgba(13,22,36,0.82)',
            border: '1px solid rgba(59,130,246,0.2)',
            boxShadow: '0 0 60px rgba(59,130,246,0.07), 0 24px 64px rgba(0,0,0,0.55)',
          }}
        >
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <Image src="/icons/Icon.png" alt="Tap2Pay" width={96} height={96} className="rounded-2xl" priority />
            <p className="mt-3 text-sm text-blue-400/70 tracking-wide">Sign in to your account</p>
          </div>

          {/* Mode toggle */}
          <div className="relative flex bg-white/5 rounded-xl p-1 mb-6">
            <div
              className="absolute top-1 bottom-1 rounded-[10px] bg-gradient-to-br from-blue-600 to-blue-700 transition-all duration-200"
              style={{ width: 'calc(50% - 6px)', left: mode === 'merchant' ? 4 : 'calc(50% + 2px)', boxShadow: '0 2px 10px rgba(37,99,235,0.45)' }}
            />
            {(['merchant', 'consumer'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); setShowPassword(false) }}
                className={`relative z-10 flex-1 py-2 text-sm font-semibold capitalize tracking-wide transition-colors duration-200 ${
                  mode === m ? 'text-white' : 'text-slate-500 hover:text-slate-400'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 tracking-widest uppercase">Email</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" width={15} height={15} viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
                <input
                  type="email" required autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600
                    bg-white/[0.04] border border-white/10
                    focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/[0.15] transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 tracking-widest uppercase">Password</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" width={15} height={15} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <input
                  type={showPassword ? 'text' : 'password'} required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl pl-9 pr-10 py-2.5 text-sm text-slate-200 placeholder-slate-600
                    bg-white/[0.04] border border-white/10
                    focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/[0.15] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-400 transition-colors"
                >
                  {showPassword ? (
                    <svg width={15} height={15} viewBox="0 0 20 20" fill="currentColor">
                      <path d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" />
                      <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                    </svg>
                  ) : (
                    <svg width={15} height={15} viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full py-3 text-sm font-semibold text-white rounded-xl tracking-wide
                bg-gradient-to-r from-blue-600 to-blue-700
                hover:from-blue-500 hover:to-blue-600
                disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
              style={{ boxShadow: '0 4px 18px rgba(37,99,235,0.35)' }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Register link */}
          <div className="mt-6 text-center text-sm text-slate-500">
            {mode === 'merchant' ? (
              <p>New merchant?{' '}
                <Link href="/auth/register/merchant" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">Apply for access</Link>
              </p>
            ) : (
              <p>New customer?{' '}
                <Link href="/auth/register/consumer" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">Create account</Link>
              </p>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-white/[0.06] text-center">
            <Link href="/admin/login" className="text-xs text-slate-600 hover:text-slate-400 tracking-wide transition-colors">
              Admin portal →
            </Link>
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer
        className="relative z-10 shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(5,11,24,0.7)', backdropFilter: 'blur(12px)' }}
      >
        {/* Main footer grid */}
        <div className="max-w-6xl mx-auto px-6 md:px-12 py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Image src="/icons/Icon.png" alt="Tap2Pay" width={28} height={28} className="rounded-md" />
              <span className="text-white font-bold text-sm">Tap<span className="text-blue-400">2</span>Pay</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              NFC tap-to-pay infrastructure for Kenyan SMEs. Fast, secure, M-Pesa integrated.
            </p>
            {/* Social icons */}
            <div className="flex items-center gap-3">
              {/* X / Twitter */}
              <a href="#" aria-label="X" className="text-slate-600 hover:text-slate-400 transition-colors">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
              {/* LinkedIn */}
              <a href="#" aria-label="LinkedIn" className="text-slate-600 hover:text-slate-400 transition-colors">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
              {/* GitHub */}
              <a href="#" aria-label="GitHub" className="text-slate-600 hover:text-slate-400 transition-colors">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                </svg>
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-widest mb-4">Product</p>
            <ul className="space-y-2.5 text-sm text-slate-500">
              {['Merchant Dashboard', 'Consumer Wallet', 'NFC Tags', 'Analytics', 'Accounting'].map(l => (
                <li key={l}><a href="#" className="hover:text-slate-300 transition-colors">{l}</a></li>
              ))}
            </ul>
          </div>

          {/* Developers */}
          <div>
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-widest mb-4">Developers</p>
            <ul className="space-y-2.5 text-sm text-slate-500">
              {['API Docs', 'SDKs', 'Webhooks', 'Status', 'Changelog'].map(l => (
                <li key={l}><a href="#" className="hover:text-slate-300 transition-colors">{l}</a></li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-widest mb-4">Company</p>
            <ul className="space-y-2.5 text-sm text-slate-500">
              {['About', 'Blog', 'Careers', 'Contact', 'Press'].map(l => (
                <li key={l}><a href="#" className="hover:text-slate-300 transition-colors">{l}</a></li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="max-w-6xl mx-auto px-6 md:px-12 py-4 flex flex-col md:flex-row items-center justify-between gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
        >
          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} OrchestratePay Platform. All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-xs text-slate-600">
            <a href="#" className="hover:text-slate-400 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-slate-400 transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-slate-400 transition-colors">Cookie Policy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
