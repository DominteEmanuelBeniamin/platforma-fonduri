'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Tone = 'quiet' | 'bordered' | 'danger'

const tones: Record<Tone, string> = {
  quiet:    'text-ink-faint hover:bg-paper-sunk hover:text-ink',
  bordered: 'border border-rule text-ink-soft hover:border-rule-strong hover:bg-paper-sunk hover:text-ink',
  danger:   'border border-rule text-ink-soft hover:border-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)] hover:text-[var(--sg-danger)]',
}

/**
 * Buton fără text. Are întotdeauna un nume pentru cititoarele de ecran, fiindcă
 * o pictogramă singură nu spune nimic. 44px pe telefon, unde lucrează degetul;
 * 36px de la `sm` în sus, unde lucrează cursorul.
 */
export function IconButton({
  label,
  tone = 'quiet',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  tone?: Tone
  children: ReactNode
}) {
  return (
    <button
      {...rest}
      aria-label={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-plate)] transition-colors duration-[120ms] pointer-fine:h-9 pointer-fine:w-9 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  )
}
