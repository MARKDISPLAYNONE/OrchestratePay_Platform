import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.login(email, password)
      localStorage.setItem('op_token', res.data.token)
      localStorage.setItem('op_merchant_name', res.data.merchantName)
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        .response?.data?.error ?? 'Login failed — check your credentials'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>OrchestratePay</h1>
        <p style={styles.subtitle}>Merchant Dashboard</p>

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={styles.input}
            placeholder="merchant@example.com"
            autoComplete="email"
          />

          <label style={styles.label}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={styles.input}
            autoComplete="current-password"
          />

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
  } as React.CSSProperties,
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '40px 48px',
    width: 380,
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)'
  } as React.CSSProperties,
  title: { fontSize: 22, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 } as React.CSSProperties,
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 32 } as React.CSSProperties,
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 } as React.CSSProperties,
  input: {
    width: '100%', padding: '10px 12px', border: '1.5px solid #d1d5db',
    borderRadius: 8, fontSize: 14, marginBottom: 20, outline: 'none',
    fontFamily: 'inherit'
  } as React.CSSProperties,
  error: { color: '#dc2626', fontSize: 13, marginBottom: 14 } as React.CSSProperties,
  button: {
    width: '100%', padding: 12, background: '#2563eb', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer'
  } as React.CSSProperties
}
