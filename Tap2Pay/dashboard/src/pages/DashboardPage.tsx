import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, Transaction, MerchantProfile } from '../api/client'
import TransactionTable from '../components/TransactionTable'
import StatCard from '../components/StatCard'

const PAGE_SIZE = 25

export default function DashboardPage() {
  const [profile, setProfile] = useState<MerchantProfile | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async (currentPage: number, silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [profileRes, txRes] = await Promise.all([
        profile ? Promise.resolve({ data: profile }) : api.getProfile(),
        api.getTransactions(PAGE_SIZE, currentPage * PAGE_SIZE)
      ])
      setProfile(profileRes.data as MerchantProfile)
      setTransactions(txRes.data.transactions)
    } catch {
      // 401 handled by axios interceptor
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [profile])

  useEffect(() => { load(page) }, [page])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLogout() {
    try { await api.logout() } catch { /* ignore */ }
    localStorage.removeItem('op_token')
    localStorage.removeItem('op_merchant_name')
    navigate('/login')
  }

  // Derive stats from the current page's data
  const today = new Date().toDateString()
  const confirmedToday = transactions.filter(
    t => t.status === 'CONFIRMED' && t.confirmed_at && new Date(t.confirmed_at).toDateString() === today
  )
  const todayRevenue = confirmedToday.reduce((s, t) => s + t.amount_cents, 0)
  const confirmed   = transactions.filter(t => t.status === 'CONFIRMED').length
  const inFlight    = transactions.filter(t => t.status === 'PENDING' || t.status === 'STK_SENT').length

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa' }}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header style={{
        background: '#1a1a2e', color: '#fff', padding: '0 32px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em' }}>OrchestratePay</span>
          {profile && <span style={{ color: '#94a3b8', fontSize: 14 }}>{profile.name}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => load(page, true)}
            disabled={refreshing}
            style={{ background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 13 }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={handleLogout}
            style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 13 }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <main style={{ padding: '32px', maxWidth: 1200, margin: '0 auto' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Transaction Overview</h2>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
          <StatCard label="Today's Revenue"    value={`KSh ${(todayRevenue / 100).toFixed(2)}`} accent="#10b981" />
          <StatCard label="This Page"          value={String(transactions.length)}              accent="#2563eb" />
          <StatCard label="Confirmed"          value={String(confirmed)}                        accent="#10b981" />
          <StatCard label="Pending / In-Flight" value={String(inFlight)}                        accent="#f59e0b" />
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: 48 }}>Loading transactions…</p>
        ) : (
          <>
            <TransactionTable
              transactions={transactions}
              onSelect={txn => navigate(`/receipt/${txn.id}`)}
            />

            {/* Pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={pageBtn}
              >
                ← Previous
              </button>
              <span style={{ fontSize: 13, color: '#64748b', padding: '0 4px' }}>Page {page + 1}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={transactions.length < PAGE_SIZE}
                style={pageBtn}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

const pageBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#fff',
  border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 13, cursor: 'pointer', color: '#374151'
}
