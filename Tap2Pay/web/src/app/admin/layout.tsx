'use client'
import { useEffect }   from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { hasAdminSecret, clearAdminSecret } from '@/lib/api'
import Link            from 'next/link'

const NAV = [
  { href: '/admin',            label: 'Dashboard' },
  { href: '/admin/merchants',  label: 'Merchants' },
  { href: '/admin/fleet',      label: 'Fleet'     },
  { href: '/admin/consumers',  label: 'Consumers' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (pathname !== '/admin/login' && !hasAdminSecret()) {
      router.replace('/admin/login')
    }
  }, [router, pathname])

  if (pathname === '/admin/login') return <>{children}</>

  return (
    <div className="relative min-h-screen bg-gray-900 text-gray-100">
      {/* Doodle pattern */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none"
        style={{ backgroundImage: "url('/pattern.svg')", backgroundRepeat: 'repeat', backgroundSize: '320px 320px', opacity: 0.07 }}
      />
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-56 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-700">
          <div className="font-bold text-blue-400 text-lg">OrchestratePay</div>
          <div className="text-xs text-gray-500 mt-0.5">Admin Portal</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ href, label }) => {
            const active = pathname === href || (href !== '/admin' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors
                  ${active
                    ? 'bg-blue-900/50 text-blue-400'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
              >
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-gray-700">
          <button
            onClick={() => { clearAdminSecret(); router.push('/admin/login') }}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="ml-56 p-8">
        {children}
      </div>
    </div>
  )
}
