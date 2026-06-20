/**
 * /merchant/scan — Merchant NFC scan page (Web NFC reading).
 *
 * Reads two tag types:
 *   1. Consumer-written tag: https://orchestratepay.co.ke/c/{consumerId}
 *      The consumer programmed a blank NTAG215 with ConsumerTagWriterActivity.
 *      → Looks up the consumer (GET /consumers/c/{consumerId}) to show their name.
 *
 *   2. Merchant-programmed consumer identity tag: orchestratepay://pay?mid=...&tid=...
 *      Written by TagWriterActivity; bound to this merchant.
 *      → Uses the tagId field in the transaction request.
 *
 * After reading, the merchant enters the amount and initiates a transaction.
 * M-Pesa STK Push goes to the consumer's registered phone.
 *
 * Browser support: Chrome 89+ on Android only.
 * The merchant Android app (MerchantDashboardActivity) is the primary path;
 * this page is for merchants who are web-only or working from a laptop/tablet.
 *
 * Protected by the merchant layout's auth guard (redirects to /auth/login if
 * no MERCHANT JWT is in storage).
 */
'use client'
import { useState, useEffect, useRef } from 'react'
import { consumers, transactions } from '@/lib/api'
import { getToken }                from '@/lib/auth'

type ScanState = 'checking' | 'unsupported' | 'ready' | 'scanning' | 'confirm' | 'processing' | 'success' | 'failed'

interface ScannedConsumer {
  consumerId:    string
  displayName:   string | null
  maskedPhone:   string
  // set for merchant-programmed consumer identity tags
  tagId?:        string
}

export default function MerchantScanPage() {
  const [state, setState]         = useState<ScanState>('checking')
  const [errorMsg, setErrorMsg]   = useState('')
  const [consumer, setConsumer]   = useState<ScannedConsumer | null>(null)
  const [amountKsh, setAmountKsh] = useState('')
  const [txnId, setTxnId]         = useState('')
  const [mpesaRef, setMpesaRef]   = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'NDEFReader' in window) {
      setState('ready')
    } else {
      setState('unsupported')
    }
    return () => {
      abortRef.current?.abort()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  async function startScan() {
    setState('scanning')
    setErrorMsg('')
    setConsumer(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const reader = new NDEFReader()
      await reader.scan({ signal: ctrl.signal })

      reader.onreading = async (event: NDEFReadingEvent) => {
        ctrl.abort()  // one tag is enough

        for (const record of event.message.records) {
          const url = extractUrl(record)
          if (!url) continue

          // Consumer-written tag: https://orchestratepay.co.ke/c/{consumerId}
          const consumerId = parseConsumerTagUrl(url)
          if (consumerId) {
            await resolveConsumer(consumerId)
            return
          }

          // Merchant-programmed consumer identity tag: orchestratepay://pay?mid=...&tid=...
          const tagId = parseConsumerIdentityTag(url)
          if (tagId) {
            setConsumer({ consumerId: '', displayName: null, maskedPhone: '254***', tagId })
            setState('confirm')
            return
          }
        }

        setErrorMsg('Unrecognised tag — tap a consumer payment sticker')
        setState('ready')
      }

      reader.onreadingerror = () => {
        setErrorMsg('Could not read tag — hold steady and try again')
        setState('ready')
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setErrorMsg(err?.message ?? 'NFC scan failed')
      setState('ready')
    }
  }

  async function resolveConsumer(consumerId: string) {
    try {
      const info = await consumers.lookupByTagId(consumerId)
      setConsumer({
        consumerId:  info.consumerId,
        displayName: info.displayName,
        maskedPhone: info.maskedPhone,
      })
      setState('confirm')
    } catch {
      setErrorMsg('Consumer not found — this sticker may be from a deleted account')
      setState('ready')
    }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    const cents = Math.round(parseFloat(amountKsh) * 100)
    if (isNaN(cents) || cents < 100) {
      setErrorMsg('Minimum payment is KSh 1.00')
      return
    }

    const merchantId = getMerchantId()
    if (!merchantId) {
      setErrorMsg('Session expired — please log in again')
      return
    }

    setState('processing')
    setErrorMsg('')

    try {
      const body: Parameters<typeof transactions.initiate>[0] = {
        merchantId,
        amountCents:    cents,
        source:         consumer?.tagId ? 'NFC_TAG' : 'CONSUMER_TAG',
        idempotencyKey: randomHex32(),
        timestamp:      Date.now(),
      }
      if (consumer?.tagId)      body.tagId        = consumer.tagId
      if (consumer?.consumerId) body.consumerTagId = consumer.consumerId

      const res = await transactions.initiate(body)
      setTxnId(res.txnId)
      pollStatus(res.txnId)
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Payment failed')
      setState('confirm')
    }
  }

  function pollStatus(id: string) {
    pollRef.current = setInterval(async () => {
      try {
        const data = await transactions.getStatus(id)
        if (data.status === 'CONFIRMED') {
          setMpesaRef(data.mpesaRef ?? '')
          setState('success')
          clearInterval(pollRef.current!)
        } else if (['DECLINED', 'FAILED', 'EXPIRED'].includes(data.status)) {
          setErrorMsg(data.reason ?? 'Payment was not completed')
          setState('failed')
          clearInterval(pollRef.current!)
        }
      } catch { /* keep polling on transient errors */ }
    }, 2500)

    setTimeout(() => {
      clearInterval(pollRef.current!)
      if (txnId && state === 'processing') {
        setErrorMsg('No confirmation after 90s — check the consumer received a PIN prompt')
        setState('failed')
      }
    }, 90_000)
  }

  function reset() {
    setConsumer(null)
    setAmountKsh('')
    setTxnId('')
    setMpesaRef('')
    setErrorMsg('')
    setState('ready')
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Scan Customer Tag</h1>

      {state === 'checking' && (
        <div className="text-gray-400">Checking NFC support…</div>
      )}

      {state === 'unsupported' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 space-y-2">
          <p className="font-semibold text-amber-800">Web NFC not available</p>
          <p className="text-sm text-amber-700">
            Use the OrchestratePay Android app for NFC scanning, or Chrome on an
            Android phone/tablet for web-based scanning.
          </p>
        </div>
      )}

      {state === 'ready' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center space-y-4">
            <div className="text-5xl">📳</div>
            <p className="text-gray-600 text-sm">
              Ask the customer to hold their payment sticker near this device.
            </p>
            {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
            <button
              onClick={startScan}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl py-3 text-base transition-colors"
            >
              Start Scanning
            </button>
          </div>
        </div>
      )}

      {state === 'scanning' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center space-y-4">
          <div className="text-5xl animate-pulse">📡</div>
          <p className="font-semibold text-gray-800">Waiting for tag…</p>
          <p className="text-sm text-gray-500">Hold the customer&apos;s sticker close to this device</p>
          <button onClick={() => { abortRef.current?.abort(); setState('ready') }}
            className="text-sm text-gray-400 hover:text-gray-600 underline">
            Cancel
          </button>
        </div>
      )}

      {state === 'confirm' && consumer && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="bg-green-50 rounded-lg p-4 space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Customer</p>
            <p className="font-semibold text-gray-900">
              {consumer.displayName ?? 'Registered customer'}
            </p>
            <p className="text-sm text-gray-500 font-mono">{consumer.maskedPhone}</p>
          </div>

          <form onSubmit={handlePay} className="space-y-4">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">KSh</span>
              <input
                type="number" required step="0.01"
                placeholder="0.00"
                value={amountKsh}
                onChange={e => setAmountKsh(e.target.value)}
                className="w-full border border-gray-300 rounded-xl pl-14 pr-4 py-4 text-2xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
            <button type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl py-3 text-base transition-colors">
              Charge with M-Pesa
            </button>
            <button type="button" onClick={reset}
              className="w-full text-sm text-gray-400 hover:text-gray-600">
              Scan again
            </button>
          </form>
        </div>
      )}

      {state === 'processing' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center space-y-4">
          <div className="text-4xl animate-spin">⏳</div>
          <p className="font-semibold text-gray-800">Waiting for M-Pesa PIN…</p>
          <p className="text-sm text-gray-500">The customer should see a prompt on their phone</p>
        </div>
      )}

      {state === 'success' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center space-y-4">
          <div className="text-5xl">✅</div>
          <p className="font-bold text-xl text-gray-900">Payment confirmed!</p>
          <p className="text-gray-600">KSh {amountKsh} received</p>
          {mpesaRef && <p className="font-mono text-xs text-gray-500">M-Pesa ref: {mpesaRef}</p>}
          <button onClick={reset}
            className="w-full bg-blue-600 text-white font-bold rounded-xl py-3 text-base">
            New payment
          </button>
        </div>
      )}

      {state === 'failed' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center space-y-4">
          <div className="text-5xl">❌</div>
          <p className="font-bold text-gray-900">Payment not completed</p>
          {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
          <button onClick={reset}
            className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-xl py-3 text-base">
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractUrl(record: NDEFRecord): string | null {
  if (!record.data) return null
  try {
    const bytes = new Uint8Array(record.data.buffer)
    const raw   = new TextDecoder().decode(bytes.slice(1))
    if (raw.startsWith('http') || raw.startsWith('orchestratepay')) return raw
    const full  = new TextDecoder().decode(bytes)
    if (full.startsWith('http') || full.startsWith('orchestratepay')) return full
    return null
  } catch {
    return null
  }
}

function parseConsumerTagUrl(url: string): string | null {
  const m = url.match(/https?:\/\/orchestratepay\.co\.ke\/c\/([A-Za-z0-9_-]+)/)
  return m?.[1] ?? null
}

function parseConsumerIdentityTag(url: string): string | null {
  // orchestratepay://pay?mid={merchantId}&tid={tagId}&v=1&sign=...
  const m = url.match(/orchestratepay:\/\/pay\?.*tid=([A-Za-z0-9_-]+)/)
  return m?.[1] ?? null
}

function randomHex32(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getMerchantId(): string | null {
  try {
    const token = getToken()
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.sub ?? null
  } catch {
    return null
  }
}
