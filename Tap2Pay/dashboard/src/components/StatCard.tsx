interface Props {
  label: string
  value: string
  accent: string
}

export default function StatCard({ label, value, accent }: Props) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      padding: '20px 24px',
      boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
      borderTop: `3px solid ${accent}`
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        {label}
      </p>
      <p style={{ fontSize: 30, fontWeight: 800, color: '#1a1a2e', lineHeight: 1 }}>
        {value}
      </p>
    </div>
  )
}
