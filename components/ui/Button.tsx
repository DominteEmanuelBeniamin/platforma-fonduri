'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import Link from 'next/link'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'
type Size = 'sm' | 'md'

/**
 * Butonul, în gramatica semnalizării: dreptunghi, muchie netă, fără umbră.
 * Ținta de atingere respectă 2.5.8 cu marjă — 44px pe telefon, unde degetul
 * lucrează, nu 24 cât e minimul.
 */
const base =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-plate)] ' +
  'font-semibold whitespace-nowrap transition-colors duration-[120ms] ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

const sizes: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-xs sm:min-h-9',
  md: 'min-h-11 px-4 text-sm pointer-fine:min-h-10',
}

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--sg-accent)] text-white hover:bg-[var(--sg-accent-ink)] active:bg-[var(--sg-accent-ink)]',
  secondary:
    'bg-plate text-ink border border-rule-strong hover:bg-paper-sunk active:bg-paper-sunk',
  quiet:
    'bg-transparent text-ink-soft hover:bg-paper-sunk hover:text-ink active:bg-paper-sunk',
  danger:
    'bg-[var(--sg-danger)] text-white hover:brightness-90 active:brightness-90',
}

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', extra = '') {
  return [base, sizes[size], variants[variant], extra].filter(Boolean).join(' ')
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  children: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: ButtonProps) {
  return (
    <button {...rest} className={buttonClass(variant, size, className)}>
      {children}
    </button>
  )
}

export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  className = '',
  /** Necesar când textul butonului e ascuns la unele lățimi. */
  label,
  children,
}: {
  href: string
  variant?: Variant
  size?: Size
  className?: string
  label?: string
  children: ReactNode
}) {
  return (
    <Link href={href} aria-label={label} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  )
}
