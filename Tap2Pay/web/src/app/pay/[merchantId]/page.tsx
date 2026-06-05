/**
 * /pay/[merchantId] — QR payment landing page.
 *
 * This is the page that renders when a customer scans the merchant's QR code.
 * It works on any device including iOS (which cannot do HCE).
 *
 * Flow:
 *   1. Load merchant info
 *   2. Consumer enters amount (if not pre-filled in QR URL params)
 *   3. Consumer logs in / registers if not already authenticated
 *   4. Consumer taps "Pay" → backend creates transaction + fires STK Push
 *   5. Page polls for CONFIRMED status
 *
 * On iOS this is the PRIMARY payment path. On Android it supplements NFC taps.
 * The page is installable as a PWA (see manifest.json) so iOS users can add to
 * home screen for a near-native experience.
 */
'use client'
import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { consumers, auth }    from '@/lib/api'
import { getRole, saveToken } from '@/lib/auth'

type Stage = 'loading' | 'auth' | 'amount' | 'confirming' | 'success' | 'failed' | 'error'

export default function QrPayPage() {
  const params       = useParams() as { merchantId: string }
  const searchParams = useSearchParams()

  const [merchant, setMerchant]   = useState<{ id: string; name: string } | null>(null)
  const [stage, setStage]         = useState<Stage>('loading')
  const [amountKsh, setAmountKsh] = useState(searchParams.get('amount') ?? '')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [txnId, setTxnId]         = useState<string | null>(null)
  const [mpesaRef, setMpesaRef]   = useState('')
  const [error, setError]         = useState('')

  // Load merchant info on mount
  useEffect(() => {
    consumers.getMerchantForPay(params.merchantId)
      .then(res => {
        setMerchant(res.merchant)
        setStage(getRole() === 'CONSUMER' ? 'amount' : 'auth')
      })
      .catch(() => setStage('error'))
  }, [params.merchantId])

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const res = await auth.consumerLogin(email, password)
      saveToken(res.token, true)
      setStage('amount')
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    const cents = Math.round(parseFloat(amountKsh) * 100)
    if (isNaN(cents) || cents < 100) {
      setError('Minimum payment is KSh 1.00')
      return
    }
    setError('')
    setStage('confirming')

    try {
      const token = sessionStorage.getItem('token') ?? localStorage.getItem('token')
      const res = await fetch(`/api/v1/consumers/pay/${merchant!.id}`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amountCents:    cents,
          idempotencyKey: crypto.randomUUID().replace(/-/g, ''),
          timestamp:      Date.now(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Payment failed')

      setTxnId(data.txnId)
      pollStatus(data.txnId)
    } catch (err: any) {
      setError(err.message)
      setStage('amount')
    }
  }

  function pollStatus(id: string) {
    const interval = setInterval(async () => {
      try {
        const token = sessionStorage.getItem('token') ?? localStorage.getItem('token')
        const res = await fetch(`/api/v1/consumers/transactions/${id}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()

        if (data.status === 'CONFIRMED') {
          setMpesaRef(data.mpesaRef ?? '')
          setStage('success')
          clearInterval(interval)
        } else if (data.status === 'DECLINED' || data.status === 'FAILED' || data.status === 'EXPIRED') {
          setError(data.reason ?? 'Payment was not completed')
          setStage('failed')
          clearInterval(interval)
        }
      } catch {
        // Keep polling — transient network errors are normal on mobile
      }
    }, 2500)

    // Timeout after 3 minutes
    setTimeout(() => {
      clearInterval(interval)
      if (stage === 'confirming') {
        setError('Payment timed out — please try again')
        setStage('failed')
      }
    }, 3 * 60 * 1000)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (stage === 'loading') {
    return <PageShell><div className="text-center text-gray-400 py-12">Loading…</div></PageShell>
  }

  if (stage === 'error') {
    return (
      <PageShell>
        <div className="text-center py-12">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-gray-600">This merchant is not available for payment.</p>
          <p className="text-sm text-gray-400 mt-2">Please check the QR code and try again.</p>
        </div>
      </PageShell>
    )
  }

  if (stage === 'success') {
    return (
      <PageShell merchantName={merchant?.name}>
        <div className="text-center py-8 space-y-4">
          <div className="text-6xl">✅</div>
          <h2 className="text-xl font-bold text-gray-900">Payment confirmed!</h2>
          <p className="text-gray-600 text-sm">
            KSh {amountKsh} paid to {merchant?.name}
          </p>
          {mpesaRef && (
            <p className="font-mono text-xs text-gray-500">M-Pesa ref: {mpesaRef}</p>
          )}
          <a href={`/pay/${merchant?.id}`}
            className="inline-block mt-4 text-sm text-green-600 hover:underline">
            Make another payment
          </a>
        </div>
      </PageShell>
    )
  }

  if (stage === 'failed') {
    return (
      <PageShell merchantName={merchant?.name}>
        <div className="text-center py-8 space-y-4">
          <div className="text-6xl">❌</div>
          <h2 className="text-xl font-bold text-gray-900">Payment not completed</h2>
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={() => { setStage('amount'); setError('') }}
            className="mt-2 text-sm text-green-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </PageShell>
    )
  }

  if (stage === 'auth') {
    return (
      <PageShell merchantName={merchant?.name}>
        <p className="text-sm text-gray-500 mb-4">
          Sign in to pay {merchant?.name} with M-Pesa
        </p>
        <form onSubmit={handleAuth} className="space-y-3">
          <input
            type="email" required placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="password" required placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit"
            className="w-full bg-green-600 text-white font-semibold rounded-xl py-3 text-sm">
            Sign in & continue
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          New here?{' '}
          <a href="/auth/register/consumer" className="text-green-600 hover:underline">Create account</a>
        </p>
      </PageShell>
    )
  }

  if (stage === 'confirming') {
    return (
      <PageShell merchantName={merchant?.name}>
        <div className="text-center py-12 space-y-4">
          <div className="text-4xl animate-spin">⏳</div>
          <p className="font-semibold text-gray-800">Waiting for your M-Pesa PIN…</p>
          <p className="text-sm text-gray-500">Check your phone for the M-Pesa prompt</p>
        </div>
      </PageShell>
    )
  }

  // stage === 'amount'
  return (
    <PageShell merchantName={merchant?.name}>
      <p className="text-sm text-gray-500 mb-4">
        Enter the amount to pay {merchant?.name}
      </p>
      <form onSubmit={handlePay} className="space-y-4">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">KSh</span>
          <input
            type="number" required min="1" step="0.01"
            placeholder="0.00"
            value={amountKsh}
            onChange={e => setAmountKsh(e.target.value)}
            className="w-full border border-gray-300 rounded-xl pl-14 pr-4 py-4 text-2xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <button type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl py-4 text-lg transition-colors">
          Pay with M-Pesa
        </button>
      </form>
      <p className="text-center text-xs text-gray-400 mt-4">
        Powered by OrchestratePay
      </p>
    </PageShell>
  )
}

function PageShell({ children, merchantName }: { children: React.ReactNode; merchantName?: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start pt-12 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="text-center mb-6">
          <div className="text-green-600 font-bold text-xl">OrchestratePay</div>
          {merchantName && (
            <div className="text-gray-500 text-sm mt-1">{merchantName}</div>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
