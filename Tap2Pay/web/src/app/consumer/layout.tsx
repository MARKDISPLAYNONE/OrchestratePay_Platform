'use client'
import { useEffect }    from 'react'
import { useRouter }    from 'next/navigation'
import { usePathname }  from 'next/navigation'
import { getRole, clearToken } from '@/lib/auth'
import Link             from 'next/link'

const NAV = [
  { href: '/consumer/dashboard', label: 'Home'    },
  { href: '/consumer/pay',       label: 'Pay'     },
  { href: '/consumer/loyalty',   label: 'Loyalty' },
  { href: '/consumer/profile',   label: 'Profile' },
]

export default function ConsumerLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (getRole() !== 'CONSUMER') {
      router.replace('/auth/login')
    }
  }, [router])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="font-bold text-green-600 text-lg">OrchestratePay</div>
        <nav className="flex gap-4 text-sm font-medium">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? 'text-green-600' : 'text-gray-500 hover:text-gray-800'}
            >
              {label}
            </Link>
          ))}
          <button
            onClick={() => { clearToken(); router.push('/auth/login') }}
            className="text-gray-400 hover:text-gray-800"
          >
            Sign out
          </button>
        </nav>
      </header>

      <main className="max-w-2xl mx-auto p-4">
        {children}
      </main>
    </div>
  )
}
