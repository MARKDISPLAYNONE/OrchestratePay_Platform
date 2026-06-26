/**
 * /scan — Consumer NFC scan page (Web NFC fallback for non-native app users).
 * Chrome 89+ on Android only. Reads merchant display tags and redirects to /pay/:id.
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import GlassCard from '@/components/ui/GlassCard'

type ScanState = 'checking' | 'unsupported' | 'ready' | 'scanning' | 'redirecting' | 'error'

export default function ConsumerScanPage() {
  const navigate  = useNavigate()
  const [state, setState] = useState<ScanState>('checking')
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setState('NDEFReader' in window ? 'ready' : 'unsupported')
    return () => { abortRef.current?.abort() }
  }, [])

  async function startScan() {
    setState('scanning'); setErrorMsg('')
    const ctrl = new AbortController(); abortRef.current = ctrl
    try {
      const reader = new NDEFReader()
      await reader.scan({ signal: ctrl.signal })
      reader.onreading = (event: NDEFReadingEvent) => {
        for (const record of event.message.records) {
          const url = extractUrl(record); if (!url) continue
          const mid = parseMerchantPayUrl(url)
          if (mid) { ctrl.abort(); setState('redirecting'); navigate(`/pay/${mid}`); return }
        }
        setErrorMsg('This tag is not a merchant payment tag — tap a merchant sticker'); setState('ready')
      }
      reader.onreadingerror = () => { setErrorMsg('Could not read tag — hold steady and try again'); setState('ready') }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setErrorMsg(err?.name === 'NotAllowedError' ? 'NFC permission denied — enable NFC in your browser settings' : (err?.message ?? 'NFC scan failed'))
      setState('ready')
    }
  }

  return (
    <div className="void-bg min-h-screen flex flex-col items-center justify-start pt-12 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src="/icons/Icon.png" alt="OrchestratePay" className="w-12 h-12 rounded-2xl mx-auto mb-3"
            style={{ filter: 'drop-shadow(0 0 10px rgba(0,175,255,0.4))' }} />
          <div className="font-bold text-electric text-lg">OrchestratePay</div>
          <div className="text-slate-500 text-sm">Tap to Pay</div>
        </div>

        <GlassCard className="p-6 text-center">
          {state === 'checking' && <div className="text-slate-500 py-8 text-sm">Checking NFC…</div>}

          {state === 'unsupported' && (
            <div className="py-8 space-y-3">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-2xl">⊘</div>
              <p className="font-semibold text-white">NFC not available</p>
              <p className="text-sm text-slate-400">Web NFC requires Chrome on Android. On iOS, tap the merchant sticker — it will open your browser automatically.</p>
            </div>
          )}

          {(state === 'ready' || state === 'error') && (
            <div className="space-y-5">
              <div className="w-16 h-16 rounded-full bg-electric/10 border border-electric/20 flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-electric" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-white">Ready to scan</p>
                <p className="text-sm text-slate-400 mt-1">Tap the button, then hold your phone to the merchant&apos;s payment sticker.</p>
              </div>
              {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}
              <button onClick={startScan} className="btn-primary w-full py-4 text-base font-bold">Scan Merchant Tag</button>
            </div>
          )}

          {state === 'scanning' && (
            <div className="py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-electric/10 border border-electric/30 flex items-center justify-center mx-auto animate-pulse">
                <svg className="w-8 h-8 text-electric" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
              </div>
              <p className="font-semibold text-white">Scanning…</p>
              <p className="text-sm text-slate-400">Hold your phone close to the merchant&apos;s sticker</p>
              <button onClick={() => { abortRef.current?.abort(); setState('ready') }} className="text-sm text-slate-500 hover:text-slate-300 underline transition-colors">Cancel</button>
            </div>
          )}

          {state === 'redirecting' && (
            <div className="py-8 space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="font-semibold text-white">Tag read — loading payment…</p>
            </div>
          )}
        </GlassCard>
      </div>
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
function parseMerchantPayUrl(url: string) {
  return url.match(/https?:\/\/orchestratepay\.co\.ke\/pay\/([A-Za-z0-9_-]+)/)?.[1] ?? null
}
