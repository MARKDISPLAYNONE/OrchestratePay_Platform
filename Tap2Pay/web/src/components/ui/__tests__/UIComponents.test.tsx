/**
 * Branch-coverage tests for ui primitives: Badge, GlassCard, KpiCard,
 * PageHeader, ErrorBanner.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import Badge      from '@/components/ui/Badge'
import GlassCard  from '@/components/ui/GlassCard'
import KpiCard    from '@/components/ui/KpiCard'
import PageHeader from '@/components/ui/PageHeader'
import ErrorBanner from '@/components/ui/ErrorBanner'

// ── Badge ─────────────────────────────────────────────────────────────────────

describe('Badge', () => {
  it('uses confirmed variant for CONFIRMED label', () => {
    const { container } = render(<Badge label="CONFIRMED" />)
    expect(container.firstChild).toHaveClass('text-emerald-400')
  })

  it('uses pending variant for PENDING label', () => {
    const { container } = render(<Badge label="PENDING" />)
    expect(container.firstChild).toHaveClass('text-amber-400')
  })

  it('uses failed variant for DECLINED label', () => {
    const { container } = render(<Badge label="DECLINED" />)
    expect(container.firstChild).toHaveClass('text-red-400')
  })

  it('uses blue variant for STK_SENT label', () => {
    const { container } = render(<Badge label="STK_SENT" />)
    expect(container.firstChild).toHaveClass('text-electric')
  })

  it('uses default variant for EXPIRED label (MAP[EXPIRED] = default)', () => {
    const { container } = render(<Badge label="EXPIRED" />)
    expect(container.firstChild).toHaveClass('text-slate-400')
  })

  it('uses default variant for unknown label', () => {
    const { container } = render(<Badge label="UNKNOWN_STATUS" />)
    expect(container.firstChild).toHaveClass('text-slate-400')
  })

  it('respects explicit variant prop over label mapping', () => {
    const { container } = render(<Badge label="CONFIRMED" variant="failed" />)
    expect(container.firstChild).toHaveClass('text-red-400')
  })

  it('renders the label text', () => {
    render(<Badge label="MY_STATUS" />)
    expect(screen.getByText('MY_STATUS')).toBeInTheDocument()
  })
})

// ── GlassCard ─────────────────────────────────────────────────────────────────

describe('GlassCard', () => {
  it('renders children', () => {
    render(<GlassCard>Hello card</GlassCard>)
    expect(screen.getByText('Hello card')).toBeInTheDocument()
  })

  it('applies glow class when glow prop is true', () => {
    const { container } = render(<GlassCard glow>content</GlassCard>)
    expect(container.firstChild).toHaveClass('shadow-glow')
  })

  it('does not apply glow class when glow prop is false', () => {
    const { container } = render(<GlassCard>content</GlassCard>)
    expect(container.firstChild).not.toHaveClass('shadow-glow')
  })

  it('applies cursor-pointer when onClick is provided', () => {
    const { container } = render(<GlassCard onClick={() => {}}>content</GlassCard>)
    expect(container.firstChild).toHaveClass('cursor-pointer')
  })

  it('calls onClick when clicked', () => {
    const handleClick = jest.fn()
    render(<GlassCard onClick={handleClick}>click me</GlassCard>)
    fireEvent.click(screen.getByText('click me'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('applies extra className', () => {
    const { container } = render(<GlassCard className="p-5">content</GlassCard>)
    expect(container.firstChild).toHaveClass('p-5')
  })
})

// ── KpiCard ───────────────────────────────────────────────────────────────────

describe('KpiCard', () => {
  it('renders title and value', () => {
    render(<KpiCard title="Revenue" value={12345} />)
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('12345')).toBeInTheDocument()
  })

  it('renders sub text when provided', () => {
    render(<KpiCard title="Revenue" value={100} sub="Last 7 days" />)
    expect(screen.getByText('Last 7 days')).toBeInTheDocument()
  })

  it('does not render sub element when sub is undefined', () => {
    render(<KpiCard title="Revenue" value={100} />)
    expect(screen.queryByText('Last 7 days')).not.toBeInTheDocument()
  })

  it('applies electric text colour when accent is true', () => {
    const { container } = render(<KpiCard title="Revenue" value={100} accent />)
    const valueEl = container.querySelector('.text-electric')
    expect(valueEl).toBeInTheDocument()
  })

  it('applies white text colour when accent is false', () => {
    const { container } = render(<KpiCard title="Revenue" value={100} />)
    const valueEl = container.querySelector('.text-white')
    expect(valueEl).toBeInTheDocument()
  })
})

// ── PageHeader ────────────────────────────────────────────────────────────────

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="My Title" />)
    expect(screen.getByText('My Title')).toBeInTheDocument()
  })

  it('renders subtitle when provided', () => {
    render(<PageHeader title="My Title" subtitle="Some subtitle" />)
    expect(screen.getByText('Some subtitle')).toBeInTheDocument()
  })

  it('does not render subtitle element when subtitle is undefined', () => {
    render(<PageHeader title="My Title" />)
    expect(screen.queryByText('Some subtitle')).not.toBeInTheDocument()
  })

  it('renders action content when provided', () => {
    render(<PageHeader title="My Title" action={<button>Add</button>} />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('does not render action slot when action is undefined', () => {
    render(<PageHeader title="My Title" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

// ── ErrorBanner ───────────────────────────────────────────────────────────────

describe('ErrorBanner', () => {
  it('renders the error message', () => {
    render(<ErrorBanner message="Something went wrong" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('applies red styling', () => {
    const { container } = render(<ErrorBanner message="Error!" />)
    expect(container.firstChild).toHaveClass('text-red-400')
  })
})
