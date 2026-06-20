'use client'
import { useEffect } from 'react'

// N as a stroked open polyline — matches the icon exactly.
// Traces: bottom-left → top-left (left bar), diagonal → bottom-right, → top-right (right bar).
const N_PATH = 'M26 102 L26 18 L94 102 L94 18'
const N_LEN  = 280   // > total stroke length ≈ 262

// Ring broken into two arcs on circle r=52, center(60,60).
// Upper gap: ~1:00-1:30 (30°-45°).  Lower gap: ~7:00-7:30 (210°-225°).
// BACK arc: right+bottom (behind N).  FRONT arc: left+top (in front of N).
const BACK_ARC  = 'M97 23 A52 52 0 0 1 34 105'
const FRONT_ARC = 'M23 97 A52 52 0 0 1 86 15'
const ARC_LEN   = 330

const mat = (d: string) => ({ opacity: 0, animation: `ring-materialise .9s ${d} cubic-bezier(.2,.8,.2,1) both` })

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 12000); return () => clearTimeout(t) }, [onDone])

  return (
    <div className="splash-container" onClick={onDone}>

      <div style={{ position: 'relative', width: 260, height: 280, perspective: '1600px', transformStyle: 'preserve-3d', animation: 'camera-push 12s linear both' }}>

        {/* Energy platform ovals */}
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            position: 'absolute', left: '50%', bottom: 10,
            width: 180, height: 46, marginLeft: -90, borderRadius: '50%',
            border: '1px solid rgba(59,130,246,0.5)', boxShadow: '0 0 10px rgba(59,130,246,0.15)',
            opacity: 0, animation: `platform-pulse 2.2s ${6 + i * 0.35}s infinite`,
          }} />
        ))}

        {/* Frames 1-2: electric arc traces (outside 3D wrapper) */}
        <svg viewBox="0 0 120 120" width={220} height={220}
          style={{ position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', overflow: 'visible', pointerEvents: 'none' }}>
          <path d={BACK_ARC} stroke="#60a5fa" strokeWidth="3" fill="none" strokeLinecap="round"
            style={{ strokeDasharray: ARC_LEN, strokeDashoffset: ARC_LEN, animation: `ring-draw 1.2s 0.3s both ease-out, splash-elem-out 0.4s 2.2s both` }} />
          <path d={FRONT_ARC} stroke="#60a5fa" strokeWidth="3" fill="none" strokeLinecap="round"
            style={{ strokeDasharray: ARC_LEN, strokeDashoffset: ARC_LEN, animation: `ring-draw 1.4s 0.5s both ease-out, splash-elem-out 0.4s 2.2s both` }} />
        </svg>

        {/* 3D logo assembly */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          transformStyle: 'preserve-3d', willChange: 'transform',
          animation: 'logo-build 1.4s 2.0s both, logo-spin-settle 1.8s 4.7s both, logo-float 4s 6.5s infinite',
        }}>
          <svg viewBox="0 0 120 120" width={220} height={220}
            style={{ position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', overflow: 'visible' }}>
            <defs>
              <linearGradient id="sp-chrome" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%"   stopColor="#14181f" />
                <stop offset="25%"  stopColor="#2d3440" />
                <stop offset="55%"  stopColor="#8f98a7" />
                <stop offset="80%"  stopColor="#313845" />
                <stop offset="100%" stopColor="#111418" />
              </linearGradient>
              <linearGradient id="sp-n" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%"   stopColor="#66c2ff" />
                <stop offset="30%"  stopColor="#3b82f6" />
                <stop offset="70%"  stopColor="#2563eb" />
                <stop offset="100%" stopColor="#1747c5" />
              </linearGradient>
              <radialGradient id="sp-disc" cx="42%" cy="36%" r="64%">
                <stop offset="0%"   stopColor="#1a2744" />
                <stop offset="100%" stopColor="#050b18" />
              </radialGradient>
              {/* Clip the N into back (upper-left, behind FRONT_ARC) and front (lower-right, over ring) */}
              <clipPath id="n-back"><polygon points="0,0 120,0 0,120" /></clipPath>
              <clipPath id="n-front"><polygon points="120,120 0,120 120,0" /></clipPath>
            </defs>

            {/* ═══ Layer 1: BACK arc — right+bottom, behind N ═══ */}
            <path d={BACK_ARC} stroke="#0b0e13" strokeWidth="28" fill="none" strokeLinecap="round" style={mat('2s')} />
            <path d={BACK_ARC} stroke="url(#sp-chrome)" strokeWidth="22" fill="none" strokeLinecap="round" style={mat('2s')} />
            <path d={BACK_ARC} stroke="rgba(255,255,255,.14)" strokeWidth="3" fill="none" strokeLinecap="round" style={mat('2.4s')} />

            {/* ═══ Layer 2: inner disc ═══ */}
            <circle cx="60" cy="60" r="44" fill="url(#sp-disc)"
              style={{ opacity: 0, animation: 'ring-materialise .9s 1.9s cubic-bezier(.2,.8,.2,1) both' }} />

            {/* ═══ Layer 3a: N neon trace (full, fades out before fill arrives) ═══ */}
            <path d={N_PATH} stroke="#93c5fd" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"
              style={{ strokeDasharray: N_LEN, strokeDashoffset: N_LEN,
                animation: `n-draw 1.2s 3.0s both ease-out, splash-elem-out 0.6s 4.6s both` }} />

            {/* ═══ Layer 3b: N fill — BACK portion (upper-left, will be covered by FRONT arc) ═══ */}
            <path d={N_PATH} stroke="url(#sp-n)" strokeWidth="16" fill="none"
              strokeLinecap="round" strokeLinejoin="round" clipPath="url(#n-back)"
              style={{ opacity: 0,
                filter: 'drop-shadow(0 0 2px rgba(59,130,246,.95)) drop-shadow(0 0 12px rgba(59,130,246,.25)) drop-shadow(0 3px 0 #0f4fd1)',
                animation: 'n-extrude 1s 4s cubic-bezier(.16,1,.3,1) both' }} />

            {/* ═══ Layer 4: FRONT arc — left+top, covers back part of N ═══ */}
            <path d={FRONT_ARC} stroke="#0b0e13" strokeWidth="28" fill="none" strokeLinecap="round" style={mat('2s')} />
            <path d={FRONT_ARC} stroke="url(#sp-chrome)" strokeWidth="22" fill="none" strokeLinecap="round"
              style={{ opacity: 0,
                filter: 'drop-shadow(0 0 3px rgba(59,130,246,.9)) drop-shadow(0 0 14px rgba(59,130,246,.25))',
                animation: 'ring-materialise .9s 2s cubic-bezier(.2,.8,.2,1) both' }} />
            {/* Inner bevel highlight */}
            <path d={FRONT_ARC} stroke="rgba(255,255,255,.25)" strokeWidth="3" fill="none" strokeLinecap="round" style={mat('2.4s')} />
            {/* Inner dark rim */}
            <path d={FRONT_ARC} stroke="rgba(0,0,0,.4)" strokeWidth="1.5" fill="none" strokeLinecap="round" style={mat('2.4s')} />

            {/* ═══ Layer 5: N fill — FRONT portion (lower-right, over everything) ═══ */}
            <path d={N_PATH} stroke="url(#sp-n)" strokeWidth="16" fill="none"
              strokeLinecap="round" strokeLinejoin="round" clipPath="url(#n-front)"
              style={{ opacity: 0,
                filter: 'drop-shadow(0 0 2px rgba(59,130,246,.95)) drop-shadow(0 0 12px rgba(59,130,246,.25)) drop-shadow(0 3px 0 #0f4fd1)',
                animation: 'n-extrude 1s 4s cubic-bezier(.16,1,.3,1) both' }} />

            {/* ═══ Frame 6: metallic sweep ═══ */}
            <rect x="-30" y="0" width="28" height="120" rx="14" fill="rgba(255,255,255,.22)"
              style={{ opacity: 0, mixBlendMode: 'screen' as React.CSSProperties['mixBlendMode'],
                animation: 'chrome-sweep 1.5s 5.1s ease-out both' }} />

            {/* Sparkle at upper gap (~86,15) */}
            <line x1="86" y1="7"  x2="86" y2="17" stroke="white" strokeWidth="1.5" style={{ opacity: 0, animation: 'sparkle-burst 1.8s 5.2s both' }} />
            <line x1="81" y1="12" x2="91" y2="12" stroke="white" strokeWidth="1.5" style={{ opacity: 0, animation: 'sparkle-burst 1.8s 5.2s both' }} />
            <line x1="82.5" y1="8.5"  x2="89.5" y2="15.5" stroke="white" strokeWidth="1" style={{ opacity: 0, animation: 'sparkle-burst 1.8s 5.35s both' }} />
            <line x1="89.5" y1="8.5"  x2="82.5" y2="15.5" stroke="white" strokeWidth="1" style={{ opacity: 0, animation: 'sparkle-burst 1.8s 5.35s both' }} />
            <circle cx="86" cy="12" r="1.5" fill="white" style={{ opacity: 0, animation: 'sparkle-burst 1.8s 5.1s both' }} />
          </svg>
        </div>
      </div>

      {/* Text block */}
      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <div style={{ fontSize: 42, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.04em', lineHeight: 1, opacity: 0, animation: 'splash-fade-in-up .9s 8s cubic-bezier(.16,1,.3,1) both' }}>
          Tap<span style={{ color: '#3b82f6' }}>2</span>Pay
        </div>
        <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 10, letterSpacing: '0.14em', fontWeight: 400, opacity: 0, animation: 'splash-fade-in-up .9s 8.3s cubic-bezier(.16,1,.3,1) both' }}>
          ── OrchestratePayPlatform ──
        </div>
      </div>

      {/* Lockup border */}
      <div style={{ position: 'absolute', top: 28, right: 28, bottom: 28, left: 28, borderRadius: 32, border: '2px solid rgba(59,130,246,0)', pointerEvents: 'none', opacity: 0, animation: 'border-draw .8s 10s both, lockup-border 1.2s 10s both' }} />

      {/* Skip hint */}
      <div style={{ position: 'absolute', bottom: 32, fontSize: 11, color: '#1e3a5f', letterSpacing: '0.06em', opacity: 0, animation: 'splash-fade-in 1.2s 2.0s both' }}>
        tap to skip
      </div>
    </div>
  )
}
