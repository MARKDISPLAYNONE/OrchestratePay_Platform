'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { dashboardPath } from '@/lib/auth'
import SplashScreen from '@/components/SplashScreen'

export default function Home() {
  const router = useRouter()
  const [showSplash, setShowSplash] = useState<boolean | null>(null)

  useEffect(() => {
    const seen = sessionStorage.getItem('tap2pay_splash')
    if (seen) {
      router.replace(dashboardPath())
    } else {
      setShowSplash(true)
    }
  }, [router])

  const handleDone = useCallback(() => {
    sessionStorage.setItem('tap2pay_splash', '1')
    router.replace(dashboardPath())
  }, [router])

  if (showSplash === null) return null
  if (showSplash) return <SplashScreen onDone={handleDone} />
  return null
}
