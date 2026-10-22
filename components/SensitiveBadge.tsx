'use client'

import { ShieldAlert } from 'lucide-react'
import { SENSITIVE_LABELS, isSensitiveKind } from '@/lib/sensitive-documents'

/**
 * Eticheta unei cereri cu date sensibile. E o clasificare, nu o stare: fără
 * roșu, ca în `REQUIREMENT_BADGE`; iconița o deosebește de tipul cerinței.
 * `detail` intră în tooltip (de exemplu data ștergerii automate).
 */
export function SensitiveBadge({ kind, detail, size = 'sm' }: { kind: string | null | undefined; detail?: string | null; size?: 'sm' | 'md' }) {
  if (!isSensitiveKind(kind)) return null
  const label = SENSITIVE_LABELS[kind]
  const tooltip = detail ? `Date sensibile: ${label}. ${detail}` : `Date sensibile: ${label}. Fișierele se șterg automat.`
  return (
    <span
      data-tooltip={tooltip}
      className={`inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-plate)] border border-rule-strong bg-paper-sunk font-medium text-ink-soft ${
        size === 'md' ? 'px-2 py-0.5 text-xs' : 'px-1.5 text-[11px] leading-[18px]'
      }`}
    >
      <ShieldAlert className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} aria-hidden="true" />
      <span className="sr-only">Date sensibile: </span>
      {kind === 'cazier' ? 'Cazier' : 'CNP'}
    </span>
  )
}
