'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter }    from 'next/navigation'
import { getRole, clearToken } from '@/lib/auth'
import { kyc as kycApi } from '@/lib/api'
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
  { href: '/merchant/settlement',   label: 'Settlement'   },
  { href: '/merchant/kyc',          label: 'KYC'          },
  { href: '/merchant/settings',     label: 'Settings'     },
]

interface KycStatusResponse {
  kycStatus:       string
  approvalStatus:  string
  kycNotes?:       string
  requiredMissing: string[]
}

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [kycInfo, setKycInfo] = useState<KycStatusResponse | null>(null)

  useEffect(() => {
    if (getRole() !== 'MERCHANT') {
      router.replace('/auth/login')
    }
  }, [router])

  const loadKyc = useCallback(async () => {
    try {
      const data = await kycApi.status()
      setKycInfo(data)
    } catch {
      // Not critical — banner just won't show
    }
  }, [])

  useEffect(() => { loadKyc() }, [loadKyc])

  const showKycBanner = kycInfo && kycInfo.approvalStatus === 'PENDING_REVIEW' &&
    ['NOT_SUBMITTED', 'SUBMITTED'].includes(kycInfo.kycStatus)
  const showRejectedBanner = kycInfo && kycInfo.approvalStatus === 'REJECTED'
  const showUnderReviewBanner = kycInfo && kycInfo.kycStatus === 'UNDER_REVIEW'

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="relative w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ backgroundImage: "url('/pattern.svg')", backgroundRepeat: 'repeat', backgroundSize: '320px 320px', opacity: 0.07 }} />
        <div className="px-6 py-5 text-lg font-bold text-blue-400 border-b border-gray-800">
          OrchestratePay
        </div>
        <nav className="flex-1 py-4 space-y-1">
          {NAV.map(({ href, label }) => {
            const isKyc = href === '/merchant/kyc'
            const needsKyc = showKycBanner && isKyc
            return (
              <Link key={href} href={href}
                className={`block px-6 py-2.5 text-sm font-medium rounded-r-lg transition-colors
                  ${pathname === href ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                {label}
                {needsKyc && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-yellow-400" />}
              </Link>
            )
          })}
        </nav>
        <div className="px-6 py-4 border-t border-gray-800">
          <button onClick={() => { clearToken(); router.push('/auth/login') }}
            className="text-sm text-gray-400 hover:text-white">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50 flex flex-col">
        {/* KYC banners */}
        {showRejectedBanner && (
          <div className="bg-red-600 text-white px-6 py-3 text-sm flex items-center justify-between">
            <span>
              Your KYC was not approved.{kycInfo?.kycNotes ? ` Reason: ${kycInfo.kycNotes}.` : ''}{' '}
              Please resubmit your documents.
            </span>
            <Link href="/merchant/kyc" className="underline font-semibold ml-4 shrink-0">Go to KYC</Link>
          </div>
        )}
        {showKycBanner && !showRejectedBanner && (
          <div className="bg-yellow-500 text-yellow-950 px-6 py-3 text-sm flex items-center justify-between">
            <span>
              Your account is pending verification.{' '}
              {kycInfo?.kycStatus === 'NOT_SUBMITTED'
                ? 'Please submit your KYC documents to start accepting payments.'
                : 'All documents submitted — awaiting admin review.'}
            </span>
            <Link href="/merchant/kyc" className="underline font-semibold ml-4 shrink-0">Complete KYC</Link>
          </div>
        )}
        {showUnderReviewBanner && !showRejectedBanner && !showKycBanner && (
          <div className="bg-blue-600 text-white px-6 py-3 text-sm flex items-center justify-between">
            <span>Your KYC documents are under review. We&apos;ll notify you by SMS within 1–2 business days.</span>
            <Link href="/merchant/kyc" className="underline font-semibold ml-4 shrink-0">View status</Link>
          </div>
        )}
        <div className="flex-1">
          {children}
        </div>
      </main>
    </div>
  )
}
