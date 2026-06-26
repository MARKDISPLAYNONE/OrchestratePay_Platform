import { type ReactNode } from 'react'
import clsx from 'clsx'

interface Props {
  children: ReactNode
  className?: string
  glow?: boolean
  onClick?: () => void
}

export default function GlassCard({ children, className, glow, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'glass rounded-2xl',
        glow && 'shadow-glow',
        onClick && 'cursor-pointer hover:border-electric/25 transition-all duration-200',
        className,
      )}
    >
      {children}
    </div>
  )
}
