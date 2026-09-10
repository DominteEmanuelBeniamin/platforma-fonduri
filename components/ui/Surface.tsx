'use client'

import type { ReactNode } from 'react'

/**
 * Ce plutește peste perete: meniuri, dialoguri, sertare. Singurul loc din
 * sistem unde se folosește o umbră — plăcuțele prinse pe perete nu au.
 */
export function FloatingSurface({
  children,
  className = '',
  role,
  ariaLabel,
  ariaModal,
  onClick,
}: {
  children: ReactNode
  className?: string
  role?: 'dialog' | 'menu'
  ariaLabel?: string
  ariaModal?: boolean
  onClick?: (e: React.MouseEvent) => void
}) {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      aria-modal={ariaModal}
      onClick={onClick}
      className={`border border-rule bg-plate ${className}`}
      style={{ boxShadow: 'var(--sg-lift)' }}
    >
      {children}
    </div>
  )
}

/** Peretele se estompează în spatele a ce plutește. */
export function Scrim({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="absolute inset-0"
      style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }}
      onClick={onClick}
    />
  )
}
