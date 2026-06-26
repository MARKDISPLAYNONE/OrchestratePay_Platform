import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { hasAdminSecret, clearAdminSecret } from '@/lib/api'
import { Navigate } from 'react-router-dom'

const NAV = [
  { to: '/admin',           label: 'Dashboard', exact: true },
  { to: '/admin/merchants', label: 'Merchants'  },
  { to: '/admin/fleet',     label: 'Fleet'      },
  { to: '/admin/consumers', label: 'Consumers'  },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  if (location.pathname === '/admin/login') return <Outlet />
  if (!hasAdminSecret()) return <Navigate to="/admin/login" replace />

  return (
    <div className="flex min-h-screen void-bg">
      {/* Sidebar */}
      <aside className="w-56 flex flex-col shrink-0"
        style={{ background: 'rgba(5,8,18,0.95)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(0,175,255,0.08)' }}>
        <div className="px-5 py-5 shrink-0" style={{ borderBottom: '1px solid rgba(0,175,255,0.08)' }}>
          <div className="flex items-center gap-2.5 mb-1">
            <img src="/icons/Icon.png" alt="OrchestratePay" className="w-7 h-7 rounded-lg" />
            <span className="text-sm font-bold text-white">OrchestratePay</span>
          </div>
          <div className="text-xs text-electric/60 ml-9">Admin Portal</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                ${isActive
                  ? 'bg-electric/10 text-electric border border-electric/20 shadow-glow-sm'
                  : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 shrink-0" style={{ borderTop: '1px solid rgba(0,175,255,0.08)' }}>
          <button
            onClick={() => { clearAdminSecret(); navigate('/admin/login') }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-all"
          >
            <span>⟵</span> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
