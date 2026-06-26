import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardPath } from '@/lib/auth'
import SplashScreen from '@/components/SplashScreen'

export default function HomePage() {
  const navigate = useNavigate()
  const [showSplash, setShowSplash] = useState<boolean | null>(null)

  useEffect(() => {
    if (sessionStorage.getItem('tap2pay_splash')) {
      navigate(dashboardPath(), { replace: true })
    } else {
      setShowSplash(true)
    }
  }, [navigate])

  const handleDone = useCallback(() => {
    sessionStorage.setItem('tap2pay_splash', '1')
    navigate(dashboardPath(), { replace: true })
  }, [navigate])

  if (showSplash === null) return null
  return <SplashScreen onDone={handleDone} />
}
