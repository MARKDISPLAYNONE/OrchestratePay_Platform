import type { Metadata } from 'next'
import LoginClient from './LoginClient'

export const metadata: Metadata = {
  title: 'Sign in — OrchestratePay',
  description: 'Sign in to your OrchestratePay merchant or consumer account.',
}

export default function LoginPage() {
  return <LoginClient />
}
