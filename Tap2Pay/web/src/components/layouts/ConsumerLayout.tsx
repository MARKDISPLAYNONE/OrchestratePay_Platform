import { NavLink, Outlet, useNavigate, Navigate } from 'react-router-dom'
import { getRole, clearToken } from '@/lib/auth'

const NAV = [
  { to: '/consumer/dashboard', label: 'Home'    },
  { to: '/consumer/pay',       label: 'Pay'     },
  { to: '/consumer/loyalty',   label: 'Loyalty' },
  { to: '/consumer/profile',   label: 'Profile' },
]

export default function ConsumerLayout() {
  const navigate = useNavigate()

  if (getRole() !== 'CONSUMER') return <Navigate to="/auth/login" replace />

  return (
    <div className="min-h-screen void-bg">
      {/* Top nav */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 h-14"
        style={{ background: 'rgba(5,8,18,0.9)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,175,255,0.08)' }}>
        <div className="flex items-center gap-2.5">
          <img src="/icons/Icon.png" alt="OrchestratePay" className="w-7 h-7 rounded-lg" />
          <span className="text-sm font-bold text-white">Orchestrate<span className="text-electric">Pay</span></span>
        </div>

        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'text-electric bg-electric/10' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
          <button
            onClick={() => { clearToken(); navigate('/auth/login') }}
            className="ml-2 px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:text-red-400 hover:bg-red-500/5 transition-all"
          >
            Out
          </button>
        </nav>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
