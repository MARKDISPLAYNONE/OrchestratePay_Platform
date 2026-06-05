'use client'
import { useEffect }    from 'react'
import { useRouter }    from 'next/navigation'
import { getRole, clearToken } from '@/lib/auth'
import Link             from 'next/link'
import { usePathname }  from 'next/navigation'

const NAV = [
  { href: '/merchant/dashboard',    label: 'Dashboard'    },
  { href: '/merchant/scan',         label: 'Scan Tag'     },
  { href: '/merchant/transactions', label: 'Transactions' },
  { href: '/merchant/analytics',    label: 'Analytics'    },
  { href: '/merchant/devices',      label: 'Devices'      },
  { href: '/merchant/loyalty',      label: 'Loyalty'      },
  { href: '/merchant/accounting',   label: 'Accounting'   },
  { href: '/merchant/settings',     label: 'Settings'     },
]

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (getRole() !== 'MERCHANT') {
      router.replace('/auth/login')
    }
  }, [router])

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="px-6 py-5 text-lg font-bold text-green-400 border-b border-gray-800">
          OrchestratePay
        </div>
        <nav className="flex-1 py-4 space-y-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`block px-6 py-2.5 text-sm font-medium rounded-r-lg transition-colors
                ${pathname === href
                  ? 'bg-green-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-gray-800">
          <button
            onClick={() => { clearToken(); router.push('/auth/login') }}
            className="text-sm text-gray-400 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  )
}
