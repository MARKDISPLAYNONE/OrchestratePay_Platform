/**
 * /merchant/scan — Web NFC scan page.
 * Chrome 89+ on Android only. The merchant Android app is the primary path.
 */
import { useState, useEffect, useRef } from 'react'
import { consumers, transactions } from '@/lib/api'
import { getToken } from '@/lib/auth'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

type ScanState = 'checking' | 'unsupported' | 'ready' | 'scanning' | 'confirm' | 'processing' | 'success' | 'failed'
interface ScannedConsumer { consumerId: string; displayName: string | null; maskedPhone: string; tagId?: string }

export default function MerchantScanPage() {
  const [state, setState]       = useState<ScanState>('checking')
  const [errorMsg, setErrorMsg] = useState('')
  const [consumer, setConsumer] = useState<ScannedConsumer | null>(null)
  const [amountKsh, setAmount]  = useState('')
  const [txnId, setTxnId]       = useState('')
  const [mpesaRef, setMpesaRef] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setState(typeof window !== 'undefined' && 'NDEFReader' in window ? 'ready' : 'unsupported')
    return () => { abortRef.current?.abort(); if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function startScan() {
    setState('scanning'); setErrorMsg(''); setConsumer(null)
    const ctrl = new AbortController(); abortRef.current = ctrl
    try {
      const reader = new NDEFReader()
      await reader.scan({ signal: ctrl.signal })
      reader.onreading = async (event: NDEFReadingEvent) => {
        ctrl.abort()
        for (const record of event.message.records) {
          const url = extractUrl(record); if (!url) continue
          const consumerId = parseConsumerTagUrl(url)
          if (consumerId) { await resolveConsumer(consumerId); return }
          const tagId = parseConsumerIdentityTag(url)
          if (tagId) { setConsumer({ consumerId: '', displayName: null, maskedPhone: '254***', tagId }); setState('confirm'); return }
        }
        setErrorMsg('Unrecognised tag — tap a consumer payment sticker'); setState('ready')
      }
      reader.onreadingerror = () => { setErrorMsg('Could not read tag — hold steady and try again'); setState('ready') }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setErrorMsg(err?.message ?? 'NFC scan failed'); setState('ready')
    }
  }

  async function resolveConsumer(consumerId: string) {
    try {
      const info = await consumers.lookupByTagId(consumerId)
      setConsumer({ consumerId: info.consumerId, displayName: info.displayName, maskedPhone: info.maskedPhone })
      setState('confirm')
    } catch { setErrorMsg('Consumer not found'); setState('ready') }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    const cents = Math.round(parseFloat(amountKsh) * 100)
    if (isNaN(cents) || cents < 100) { setErrorMsg('Minimum payment is KSh 1.00'); return }
    const merchantId = getMerchantId()
    if (!merchantId) { setErrorMsg('Session expired — please log in again'); return }
    setState('processing'); setErrorMsg('')
    try {
      const body: Parameters<typeof transactions.initiate>[0] = {
        merchantId, amountCents: cents,
        source: consumer?.tagId ? 'NFC_TAG' : 'CONSUMER_TAG',
        idempotencyKey: randomHex32(), timestamp: Date.now(),
      }
      if (consumer?.tagId)      body.tagId        = consumer.tagId
      if (consumer?.consumerId) body.consumerTagId = consumer.consumerId
      const res = await transactions.initiate(body)
      setTxnId(res.txnId); pollStatus(res.txnId)
    } catch (err: any) { setErrorMsg(err?.message ?? 'Payment failed'); setState('confirm') }
  }

  function pollStatus(id: string) {
    pollRef.current = setInterval(async () => {
      try {
        const data = await transactions.getStatus(id)
        if (data.status === 'CONFIRMED') { setMpesaRef(data.mpesaRef ?? ''); setState('success'); clearInterval(pollRef.current!) }
        else if (['DECLINED', 'FAILED', 'EXPIRED'].includes(data.status)) { setErrorMsg(data.reason ?? 'Payment not completed'); setState('failed'); clearInterval(pollRef.current!) }
      } catch {}
    }, 2500)
    setTimeout(() => { clearInterval(pollRef.current!); if (txnId && state === 'processing') { setErrorMsg('No confirmation after 90s'); setState('failed') } }, 90_000)
  }

  function reset() { setConsumer(null); setAmount(''); setTxnId(''); setMpesaRef(''); setErrorMsg(''); setState('ready') }

  return (
    <div className="max-w-md mx-auto">
      <PageHeader title="Scan Customer Tag" />

      {state === 'checking' && <div className="text-slate-500 text-sm">Checking NFC support…</div>}

      {state === 'unsupported' && (
        <GlassCard className="p-6">
          <div className="text-amber-400 font-semibold mb-2">Web NFC not available</div>
          <p className="text-sm text-slate-400">Use the OrchestratePay Android app for NFC scanning, or Chrome on an Android phone/tablet.</p>
        </GlassCard>
      )}

      {state === 'ready' && (
        <GlassCard className="p-8 text-center space-y-5">
          <div className="w-20 h-20 rounded-full bg-electric/10 border border-electric/20 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-electric" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
          </div>
          <p className="text-slate-400 text-sm">Ask the customer to hold their payment sticker near this device.</p>
          {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}
          <button onClick={startScan} className="btn-primary w-full py-3">Start Scanning</button>
        </GlassCard>
      )}

      {state === 'scanning' && (
        <GlassCard className="p-8 text-center space-y-5">
          <div className="w-20 h-20 rounded-full bg-electric/10 border border-electric/30 flex items-center justify-center mx-auto animate-pulse">
            <svg className="w-10 h-10 text-electric" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
            </svg>
          </div>
          <p className="font-semibold text-white">Waiting for tag…</p>
          <p className="text-sm text-slate-500">Hold the customer&apos;s sticker close to this device</p>
          <button onClick={() => { abortRef.current?.abort(); setState('ready') }} className="text-sm text-slate-500 hover:text-slate-300 underline">Cancel</button>
        </GlassCard>
      )}

      {state === 'confirm' && consumer && (
        <GlassCard className="p-6 space-y-5">
          <div className="rounded-xl p-4 bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Customer</p>
            <p className="font-semibold text-white">{consumer.displayName ?? 'Registered customer'}</p>
            <p className="text-sm text-slate-400 font-mono mt-0.5">{consumer.maskedPhone}</p>
          </div>
          <form onSubmit={handlePay} className="space-y-4">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">KSh</span>
              <input type="number" required step="0.01" placeholder="0.00" value={amountKsh}
                onChange={e => setAmount(e.target.value)} autoFocus
                className="input-dark pl-14 py-4 text-2xl font-bold text-center" />
            </div>
            {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}
            <button type="submit" className="btn-primary w-full py-3 text-base">Charge with M-Pesa</button>
            <button type="button" onClick={reset} className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors">Scan again</button>
          </form>
        </GlassCard>
      )}

      {state === 'processing' && (
        <GlassCard className="p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-full border-2 border-electric/30 border-t-electric animate-spin mx-auto" />
          <p className="font-semibold text-white">Waiting for M-Pesa PIN…</p>
          <p className="text-sm text-slate-500">The customer should see a prompt on their phone</p>
        </GlassCard>
      )}

      {state === 'success' && (
        <GlassCard className="p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="font-bold text-xl text-white">Payment confirmed!</p>
          <p className="text-slate-400">KSh {amountKsh} received</p>
          {mpesaRef && <p className="font-mono text-xs text-slate-500">M-Pesa ref: {mpesaRef}</p>}
          <button onClick={reset} className="btn-primary w-full py-3">New payment</button>
        </GlassCard>
      )}

      {state === 'failed' && (
        <GlassCard className="p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <p className="font-bold text-white">Payment not completed</p>
          {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}
          <button onClick={reset} className="btn-ghost w-full py-3">Try again</button>
        </GlassCard>
      )}
    </div>
  )
}

function extractUrl(record: NDEFRecord): string | null {
  if (!record.data) return null
  try {
    const bytes = new Uint8Array(record.data.buffer)
    const raw = new TextDecoder().decode(bytes.slice(1))
    if (raw.startsWith('http') || raw.startsWith('orchestratepay')) return raw
    const full = new TextDecoder().decode(bytes)
    if (full.startsWith('http') || full.startsWith('orchestratepay')) return full
    return null
  } catch { return null }
}
function parseConsumerTagUrl(url: string) {
  return url.match(/https?:\/\/orchestratepay\.co\.ke\/c\/([A-Za-z0-9_-]+)/)?.[1] ?? null
}
function parseConsumerIdentityTag(url: string) {
  return url.match(/orchestratepay:\/\/pay\?.*tid=([A-Za-z0-9_-]+)/)?.[1] ?? null
}
function randomHex32() {
  const arr = new Uint8Array(16); crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}
function getMerchantId() {
  try {
    const token = getToken(); if (!token) return null
    return JSON.parse(atob(token.split('.')[1]))?.sub ?? null
  } catch { return null }
}
