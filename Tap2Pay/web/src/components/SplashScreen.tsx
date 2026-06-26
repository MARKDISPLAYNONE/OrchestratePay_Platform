import { useEffect } from 'react'

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t) }, [onDone])

  return (
    <div className="splash-container" onClick={onDone}>
      <img
        src="/icons/Icon.png"
        alt="Tap2Pay"
        style={{
          width: 300,
          height: 300,
          display: 'block',
          animation: 'icon-rise 0.7s cubic-bezier(.16,1,.3,1) both, icon-glow 1.4s 0.7s ease-in-out both, icon-float 3s 1.5s ease-in-out infinite, icon-exit 0.7s 2.8s ease-in forwards',
        }}
      />

      <div style={{
        position: 'absolute',
        bottom: 32,
        fontSize: 11,
        color: '#1e3a5f',
        letterSpacing: '0.06em',
        opacity: 0,
        animation: 'splash-fade-in 1.2s 0.5s both',
      }}>
        tap to skip
      </div>
    </div>
  )
}
