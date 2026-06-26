import clsx from 'clsx'

type Variant = 'confirmed' | 'pending' | 'failed' | 'blue' | 'default'

const MAP: Record<string, Variant> = {
  CONFIRMED:  'confirmed',
  APPROVED:   'confirmed',
  STK_SENT:   'blue',
  PENDING:    'pending',
  SUBMITTED:  'pending',
  UNDER_REVIEW: 'blue',
  DECLINED:   'failed',
  FAILED:     'failed',
  REJECTED:   'failed',
  EXPIRED:    'default',
}

interface Props {
  label: string
  variant?: Variant
}

export default function Badge({ label, variant }: Props) {
  const v = variant ?? MAP[label] ?? 'default'
  return (
    <span className={clsx(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
      v === 'confirmed' && 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
      v === 'pending'   && 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
      v === 'failed'    && 'bg-red-500/15 text-red-400 border border-red-500/20',
      v === 'blue'      && 'bg-electric/15 text-electric border border-electric/20',
      v === 'default'   && 'bg-white/5 text-slate-400 border border-white/10',
    )}>
      {label}
    </span>
  )
}
