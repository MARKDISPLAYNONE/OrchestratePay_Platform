'use client'
import { useState }   from 'react'
import { consumers }  from '@/lib/api'

export default function ConsumerPayPage() {
  const [merchantId, setMerchantId] = useState('')
  const [amount, setAmount]         = useState('')
  const [status, setStatus]         = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [message, setMessage]       = useState('')

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      await consumers.requestPayment(merchantId.trim(), {
        amountCents:    Math.round(parseFloat(amount) * 100),
        idempotencyKey: crypto.randomUUID().replace(/-/g, '').slice(0, 32),
        timestamp:      Date.now(),
      })
      setStatus('sent')
      setMessage('M-Pesa prompt sent — enter your PIN to complete the payment.')
    } catch (err: any) {
      setStatus('error')
      setMessage(err.message ?? 'Payment failed — please try again.')
    }
  }

  if (status === 'sent') {
    return (
      <div className="py-12 text-center space-y-4">
        <div className="text-5xl">📱</div>
        <h2 className="text-xl font-bold text-gray-900">Check your phone</h2>
        <p className="text-gray-500 text-sm max-w-xs mx-auto">{message}</p>
        <button
          onClick={() => { setStatus('idle'); setMerchantId(''); setAmount('') }}
          className="text-blue-600 text-sm hover:underline"
        >
          Make another payment
        </button>
      </div>
    )
  }

  return (
    <div className="py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pay</h1>
        <p className="text-sm text-gray-500">Send an M-Pesa payment request to a merchant</p>
      </div>

      <form onSubmit={handlePay} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div>
          <label htmlFor="merchantId" className="block text-sm font-medium text-gray-700 mb-1">Merchant ID</label>
          <input
            id="merchantId"
            type="text" required placeholder="Paste the merchant ID from their QR code"
            value={merchantId} onChange={e => setMerchantId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">Amount (KSh)</label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-sm text-gray-400">KSh</span>
            <input
              id="amount"
              type="number" required min="1" step="0.01" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg pl-12 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {status === 'error' && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {message}
          </div>
        )}

        <button
          type="submit" disabled={status === 'loading'}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-50 transition-colors"
        >
          {status === 'loading' ? 'Sending…' : 'Send payment request'}
        </button>
      </form>
    </div>
  )
}
