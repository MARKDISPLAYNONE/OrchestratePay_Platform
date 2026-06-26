import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, Navigate } from 'react-router-dom'
import { getRole, clearToken } from '@/lib/auth'
import { kyc as kycApi } from '@/lib/api'

const NAV = [
  { to: '/merchant/dashboard',    label: 'Dashboard',    icon: '▦' },
  { to: '/merchant/scan',         label: 'Scan Tag',     icon: '⊛' },
  { to: '/merchant/transactions', label: 'Transactions', icon: '⊟' },
  { to: '/merchant/analytics',    label: 'Analytics',    icon: '◈' },
  { to: '/merchant/devices',      label: 'Devices',      icon: '⊡' },
  { to: '/merchant/loyalty',      label: 'Loyalty',      icon: '◇' },
  { to: '/merchant/accounting',   label: 'Accounting',   icon: '⊞' },
  { to: '/merchant/settlement',   label: 'Settlement',   icon: '◉' },
  { to: '/merchant/kyc',          label: 'KYC',          icon: '◈' },
  { to: '/merchant/settings',     label: 'Settings',     icon: '⊙' },
]

interface KycInfo { kycStatus: string; approvalStatus: string; kycNotes?: string }

export default function MerchantLayout() {
  const navigate = useNavigate()

  if (getRole() !== 'MERCHANT') return <Navigate to="/auth/login" replace />

  const [kycInfo, setKycInfo] = useState<KycInfo | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const loadKyc = useCallback(async () => {
    try { setKycInfo(await kycApi.status()) } catch {}
  }, [])

  useEffect(() => { loadKyc() }, [loadKyc])

  const showKycBanner      = kycInfo?.approvalStatus === 'PENDING_REVIEW' && ['NOT_SUBMITTED', 'SUBMITTED'].includes(kycInfo.kycStatus)
  const showRejectedBanner = kycInfo?.approvalStatus === 'REJECTED'
  const showReviewBanner   = kycInfo?.kycStatus === 'UNDER_REVIEW' && !showRejectedBanner && !showKycBanner

  return (
    <div className="flex min-h-screen void-bg">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-60 flex flex-col
        transition-transform duration-300 ease-in-out
        lg:translate-x-0 lg:static lg:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `} style={{ background: 'rgba(5,8,18,0.95)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(0,175,255,0.08)' }}>
        {/* Logo */}
        <div className="px-5 py-5 flex items-center gap-3 shrink-0" style={{ borderBottom: '1px solid rgba(0,175,255,0.08)' }}>
          <img src="/icons/Icon.png" alt="OrchestratePay" className="w-8 h-8 rounded-lg" />
          <div>
            <div className="text-sm font-bold text-white">OrchestratePay</div>
            <div className="text-xs text-electric/70">Merchant</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                ${isActive
                  ? 'bg-electric/10 text-electric border border-electric/20 shadow-glow-sm'
                  : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'}`
              }
            >
              <span className="text-base opacity-60">{icon}</span>
              <span>{label}</span>
              {label === 'KYC' && showKycBanner && (
                <span className="ml-auto w-2 h-2 rounded-full bg-amber-400" />
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-4 shrink-0" style={{ borderTop: '1px solid rgba(0,175,255,0.08)' }}>
          <button
            onClick={() => { clearToken(); navigate('/auth/login') }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-all"
          >
            <span>⟵</span> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center justify-between px-4 h-14 shrink-0"
          style={{ borderBottom: '1px solid rgba(0,175,255,0.08)', background: 'rgba(5,8,18,0.9)' }}>
          <button onClick={() => setSidebarOpen(true)} className="text-slate-400 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <img src="/icons/Icon.png" alt="OrchestratePay" className="w-7 h-7 rounded-lg" />
          <div className="w-7" />
        </div>

        {/* Banners */}
        {showRejectedBanner && (
          <div className="px-6 py-3 text-sm flex items-center justify-between bg-red-500/10 border-b border-red-500/20">
            <span className="text-red-400">KYC not approved.{kycInfo?.kycNotes ? ` Reason: ${kycInfo.kycNotes}.` : ''} Please resubmit.</span>
            <NavLink to="/merchant/kyc" className="text-red-300 underline ml-4 shrink-0 hover:text-white">Go to KYC</NavLink>
          </div>
        )}
        {showKycBanner && !showRejectedBanner && (
          <div className="px-6 py-3 text-sm flex items-center justify-between bg-amber-500/10 border-b border-amber-500/20">
            <span className="text-amber-400">
              {kycInfo?.kycStatus === 'NOT_SUBMITTED'
                ? 'Submit KYC documents to start accepting payments.'
                : 'Documents submitted — awaiting admin review.'}
            </span>
            <NavLink to="/merchant/kyc" className="text-amber-300 underline ml-4 shrink-0 hover:text-white">Complete KYC</NavLink>
          </div>
        )}
        {showReviewBanner && (
          <div className="px-6 py-3 text-sm flex items-center justify-between bg-electric/5 border-b border-electric/15">
            <span className="text-electric/80">KYC documents under review — 1–2 business days.</span>
            <NavLink to="/merchant/kyc" className="text-electric underline ml-4 shrink-0 hover:text-neon">View status</NavLink>
          </div>
        )}

        <main className="flex-1 overflow-auto p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
