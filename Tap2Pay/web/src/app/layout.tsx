import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Inter } from 'next/font/google'
import GoogleOAuthProviderWrapper from '@/components/GoogleOAuthProviderWrapper'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title:       'OrchestratePay',
  description: 'NFC tap-to-pay platform for Kenyan SMEs',
  manifest:    '/manifest.json',
  appleWebApp: {
    capable:       true,
    statusBarStyle: 'default',
    title:          'OrchestratePay',
  },
  icons: {
    icon:  '/icons/Icon.png',
    apple: '/icons/Icon.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width:             'device-width',
  initialScale:      1,
  themeColor:        '#2563eb',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="bg-gray-50 text-gray-900 antialiased font-sans" suppressHydrationWarning>
        <GoogleOAuthProviderWrapper>
        {children}
        </GoogleOAuthProviderWrapper>
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator && ${process.env.NODE_ENV === 'production'}) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
          }
        `}</Script>
      </body>
    </html>
  )
}
