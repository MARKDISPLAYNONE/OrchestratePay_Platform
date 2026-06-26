import { useState } from 'react'
import { consumers } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'

export default function ConsumerPayPage() {
  const [merchantId, setMerchantId] = useState('')
  const [amount, setAmount]         = useState('')
  const [status, setStatus]         = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [message, setMessage]       = useState('')

  async function handlePay(e: React.FormEvent) {
    e.preventDefault(); setStatus('loading')
    try {
      await consumers.requestPayment(merchantId.trim(), { amountCents: Math.round(parseFloat(amount) * 100), idempotencyKey: crypto.randomUUID().replace(/-/g, '').slice(0, 32), timestamp: Date.now() })
      setStatus('sent'); setMessage('M-Pesa prompt sent — enter your PIN to complete the payment.')
    } catch (err: any) { setStatus('error'); setMessage(err.message ?? 'Payment failed — please try again.') }
  }

  if (status === 'sent') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-5">
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
          <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">Check your phone</h2>
        <p className="text-slate-400 text-sm max-w-xs">{message}</p>
        <button onClick={() => { setStatus('idle'); setMerchantId(''); setAmount('') }} className="text-electric hover:text-neon transition-colors text-sm">Make another payment</button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-sm">
      <div>
        <h1 className="text-2xl font-bold text-white">Pay</h1>
        <p className="text-sm text-slate-500">Send an M-Pesa payment request to a merchant</p>
      </div>

      <form onSubmit={handlePay}>
        <GlassCard className="p-5 space-y-4">
          <div>
            <label htmlFor="merchantId" className="block text-sm font-medium text-slate-300 mb-1.5">Merchant ID</label>
            <input id="merchantId" type="text" required placeholder="Paste the merchant ID from their QR code" value={merchantId} onChange={e => setMerchantId(e.target.value)} className="input-dark" />
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-slate-300 mb-1.5">Amount (KSh)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium">KSh</span>
              <input id="amount" type="number" required min="1" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="input-dark pl-14 text-lg font-semibold" />
            </div>
          </div>
          {status === 'error' && <p className="text-sm text-red-400">{message}</p>}
          <button type="submit" disabled={status === 'loading'} className="btn-primary w-full py-3 disabled:opacity-50">
            {status === 'loading' ? 'Sending…' : 'Send payment request'}
          </button>
        </GlassCard>
      </form>
    </div>
  )
}
