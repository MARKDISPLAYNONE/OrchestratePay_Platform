/**
 * /pay/:merchantId — QR payment landing page.
 * Primary payment path on iOS; supplements NFC on Android.
 */
import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { consumers, auth } from '@/lib/api'
import { getRole, saveToken } from '@/lib/auth'
import GlassCard from '@/components/ui/GlassCard'

type Stage = 'loading' | 'auth' | 'amount' | 'confirming' | 'success' | 'failed' | 'error'

function Shell({ children, merchantName }: { children: React.ReactNode; merchantName?: string }) {
  return (
    <div className="void-bg min-h-screen flex flex-col items-center justify-start pt-12 px-4 pb-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src="/icons/Icon.png" alt="OrchestratePay" className="w-12 h-12 rounded-2xl mx-auto mb-3"
            style={{ filter: 'drop-shadow(0 0 10px rgba(0,175,255,0.4))' }} />
          <div className="font-bold text-electric text-lg">OrchestratePay</div>
          {merchantName && <div className="text-slate-500 text-sm mt-0.5">{merchantName}</div>}
        </div>
        <GlassCard className="p-6">{children}</GlassCard>
        <p className="text-center text-xs text-slate-700 mt-4">Secure payments via M-Pesa · OrchestratePay</p>
      </div>
    </div>
  )
}

export default function PayLinkPage() {
  const { merchantId }    = useParams<{ merchantId: string }>()
  const [searchParams]    = useSearchParams()
  const [merchant, setMerchant]   = useState<{ id: string; name: string } | null>(null)
  const [stage, setStage]         = useState<Stage>('loading')
  const [amountKsh, setAmountKsh] = useState(searchParams.get('amount') ?? '')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [txnId, setTxnId]         = useState<string | null>(null)
  const [mpesaRef, setMpesaRef]   = useState('')
  const [error, setError]         = useState('')

  useEffect(() => {
    if (!merchantId) { setStage('error'); return }
    consumers.getMerchantForPay(merchantId)
      .then(res => { setMerchant(res.merchant); setStage(getRole() === 'CONSUMER' ? 'amount' : 'auth') })
      .catch(() => setStage('error'))
  }, [merchantId])

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault(); setError('')
    try { const res = await auth.consumerLogin(email, password); saveToken(res.token, true); setStage('amount') }
    catch (err: any) { setError(err.message) }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    const cents = Math.round(parseFloat(amountKsh) * 100)
    if (isNaN(cents) || cents < 100) { setError('Minimum payment is KSh 1.00'); return }
    setError(''); setStage('confirming')
    try {
      const token = sessionStorage.getItem('token') ?? localStorage.getItem('token')
      const res   = await fetch(`/api/v1/consumers/pay/${merchant!.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ amountCents: cents, idempotencyKey: crypto.randomUUID().replace(/-/g, ''), timestamp: Date.now() }) })
      const data  = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Payment failed')
      setTxnId(data.txnId); pollStatus(data.txnId)
    } catch (err: any) { setError(err.message); setStage('amount') }
  }

  function pollStatus(id: string) {
    const iv = setInterval(async () => {
      try {
        const token = sessionStorage.getItem('token') ?? localStorage.getItem('token')
        const res   = await fetch(`/api/v1/consumers/transactions/${id}/status`, { headers: { Authorization: `Bearer ${token}` } })
        const data  = await res.json()
        if (data.status === 'CONFIRMED') { setMpesaRef(data.mpesaRef ?? ''); setStage('success'); clearInterval(iv) }
        else if (['DECLINED', 'FAILED', 'EXPIRED'].includes(data.status)) { setError(data.reason ?? 'Payment not completed'); setStage('failed'); clearInterval(iv) }
      } catch {}
    }, 2500)
    setTimeout(() => { clearInterval(iv); setError('Payment timed out — please try again'); setStage('failed') }, 3 * 60_000)
  }

  if (stage === 'loading') return <Shell><div className="text-center text-slate-500 py-10 text-sm">Loading…</div></Shell>

  if (stage === 'error') return (
    <Shell>
      <div className="text-center py-10 space-y-3">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-2xl">⚠</div>
        <p className="text-slate-300">This merchant is not available.</p>
        <p className="text-xs text-slate-600">Please check the QR code and try again.</p>
      </div>
    </Shell>
  )

  if (stage === 'success') return (
    <Shell merchantName={merchant?.name}>
      <div className="text-center py-6 space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-xl font-bold text-white">Payment confirmed!</h2>
        <p className="text-slate-400 text-sm">KSh {amountKsh} paid to {merchant?.name}</p>
        {mpesaRef && <p className="font-mono text-xs text-slate-500">M-Pesa ref: {mpesaRef}</p>}
        <Link to={`/pay/${merchant?.id}`} className="text-sm text-electric hover:text-neon transition-colors">Make another payment</Link>
      </div>
    </Shell>
  )

  if (stage === 'failed') return (
    <Shell merchantName={merchant?.name}>
      <div className="text-center py-6 space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </div>
        <h2 className="text-xl font-bold text-white">Payment not completed</h2>
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={() => { setStage('amount'); setError('') }} className="text-sm text-electric hover:text-neon transition-colors">Try again</button>
      </div>
    </Shell>
  )

  if (stage === 'auth') return (
    <Shell merchantName={merchant?.name}>
      <p className="text-sm text-slate-400 mb-5">Sign in to pay {merchant?.name} with M-Pesa</p>
      <form onSubmit={handleAuth} className="space-y-3">
        <input type="email" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="input-dark" />
        <input type="password" required placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="input-dark" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className="btn-primary w-full py-3">Sign in &amp; continue</button>
      </form>
      <p className="text-center text-sm text-slate-600 mt-4">
        New here? <Link to="/auth/register/consumer" className="text-electric hover:text-neon transition-colors">Create account</Link>
      </p>
    </Shell>
  )

  if (stage === 'confirming') return (
    <Shell merchantName={merchant?.name}>
      <div className="text-center py-10 space-y-4">
        <div className="w-14 h-14 rounded-full border-2 border-electric/30 border-t-electric animate-spin mx-auto" />
        <p className="font-semibold text-white">Waiting for M-Pesa PIN…</p>
        <p className="text-sm text-slate-500">Check your phone for the M-Pesa prompt</p>
      </div>
    </Shell>
  )

  return (
    <Shell merchantName={merchant?.name}>
      <p className="text-sm text-slate-400 mb-5">Enter the amount to pay {merchant?.name}</p>
      <form onSubmit={handlePay} className="space-y-4">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">KSh</span>
          <input type="number" required min="1" step="0.01" placeholder="0.00" value={amountKsh} onChange={e => setAmountKsh(e.target.value)}
            className="input-dark pl-14 py-4 text-2xl font-bold text-center" />
        </div>
        {error && <p className="text-sm text-red-400 text-center">{error}</p>}
        <button type="submit" className="btn-primary w-full py-4 text-lg font-bold">Pay with M-Pesa</button>
      </form>
    </Shell>
  )
}
