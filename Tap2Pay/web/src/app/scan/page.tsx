/**
 * /scan — Consumer NFC scan page.
 *
 * Reads a merchant display tag (https://orchestratepay.co.ke/pay/{merchantId})
 * using the Web NFC API and redirects to the payment page.
 *
 * When to use this page:
 *   - Consumer has the web app bookmarked/installed as PWA on Android Chrome
 *   - Consumer opens /scan, taps phone to the merchant's NTAG215 sticker
 *   - This page extracts the merchantId and redirects to /pay/{merchantId}
 *
 * Browser support: Chrome 89+ on Android only.
 * Shows a clear "not supported" message on iOS, Firefox, or desktop.
 *
 * Note: when the native wallet app is installed, the OS intercepts the tag
 * tap directly and opens NfcTagPaymentActivity without visiting this page.
 * This page is the fallback for users who have the web app but not the native app.
 */
'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type ScanState = 'checking' | 'unsupported' | 'ready' | 'scanning' | 'redirecting' | 'error'

export default function ConsumerScanPage() {
  const router = useRouter()
  const [state, setState] = useState<ScanState>('checking')
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'NDEFReader' in window) {
      setState('ready')
    } else {
      setState('unsupported')
    }
    return () => { abortRef.current?.abort() }
  }, [])

  async function startScan() {
    setState('scanning')
    setErrorMsg('')

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const reader = new NDEFReader()
      await reader.scan({ signal: ctrl.signal })

      reader.onreading = (event: NDEFReadingEvent) => {
        for (const record of event.message.records) {
          const url = extractUrl(record)
          if (!url) continue
          const mid = parseMerchantPayUrl(url)
          if (mid) {
            ctrl.abort()
            setState('redirecting')
            router.push(`/pay/${mid}`)
            return
          }
        }
        // Tag was readable but not a merchant display tag
        setErrorMsg('This tag is not a merchant payment tag — tap a merchant sticker')
        setState('ready')
      }

      reader.onreadingerror = () => {
        setErrorMsg('Could not read tag — hold steady and try again')
        setState('ready')
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      if (err?.name === 'NotAllowedError') {
        setErrorMsg('NFC permission denied — enable NFC in your browser settings')
        setState('ready')
      } else {
        setErrorMsg(err?.message ?? 'NFC scan failed')
        setState('ready')
      }
    }
  }

  function stopScan() {
    abortRef.current?.abort()
    setState('ready')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start pt-12 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="text-center mb-6">
          <div className="text-blue-600 font-bold text-xl">OrchestratePay</div>
          <div className="text-gray-500 text-sm mt-1">Tap to Pay</div>
        </div>

        {state === 'checking' && (
          <div className="text-center text-gray-400 py-8">Checking NFC support…</div>
        )}

        {state === 'unsupported' && (
          <div className="text-center py-8 space-y-3">
            <div className="text-4xl">📵</div>
            <p className="font-semibold text-gray-800">NFC not available</p>
            <p className="text-sm text-gray-500">
              Web NFC requires Chrome on Android. On iOS, tap the merchant sticker
              — it will open your browser automatically.
            </p>
          </div>
        )}

        {(state === 'ready' || state === 'error') && (
          <div className="space-y-4 text-center">
            <div className="text-5xl">📳</div>
            <p className="text-gray-700 font-medium">Ready to scan</p>
            <p className="text-sm text-gray-500">
              Tap the button below, then hold your phone to the merchant&apos;s
              payment sticker.
            </p>
            {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
            <button
              onClick={startScan}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl py-4 text-lg transition-colors"
            >
              Scan Merchant Tag
            </button>
          </div>
        )}

        {state === 'scanning' && (
          <div className="text-center py-8 space-y-4">
            <div className="text-5xl animate-pulse">📡</div>
            <p className="font-semibold text-gray-800">Scanning…</p>
            <p className="text-sm text-gray-500">
              Hold your phone close to the merchant&apos;s payment sticker
            </p>
            <button
              onClick={stopScan}
              className="mt-2 text-sm text-gray-400 hover:text-gray-600 underline"
            >
              Cancel
            </button>
          </div>
        )}

        {state === 'redirecting' && (
          <div className="text-center py-8 space-y-3">
            <div className="text-5xl">✅</div>
            <p className="font-semibold text-gray-800">Tag read — loading payment…</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractUrl(record: NDEFRecord): string | null {
  if (!record.data) return null
  try {
    // URI records have a 1-byte prefix code followed by the URI bytes
    const bytes = new Uint8Array(record.data.buffer)
    // Drop prefix byte (e.g. 0x04 = "https://") — browser may have already expanded it
    const raw = new TextDecoder().decode(bytes.slice(1))
    if (raw.startsWith('http') || raw.startsWith('orchestratepay')) return raw
    // Try without prefix
    const full = new TextDecoder().decode(bytes)
    if (full.startsWith('http') || full.startsWith('orchestratepay')) return full
    return null
  } catch {
    return null
  }
}

function parseMerchantPayUrl(url: string): string | null {
  const m = url.match(/https?:\/\/orchestratepay\.co\.ke\/pay\/([A-Za-z0-9_-]+)/)
  return m?.[1] ?? null
}
