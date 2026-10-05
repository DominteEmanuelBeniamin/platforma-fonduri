'use client'

import { Eye } from 'lucide-react'
import { hiddenFinalSummary } from '@/lib/completion'

/**
 * Ține locul elementelor finalizate ascunse dintr-o listă (#109, D9): câte sunt
 * și butonul care le arată doar pe ele, fără să atingă comutatorul general
 * „Arată și ce e finalizat".
 */
export default function HiddenFinalRow({
  hiddenCount,
  total,
  singular,
  plural,
  onReveal,
  className = '',
}: {
  hiddenCount: number
  /** Câte are lista cu totul: dacă sunt toate ascunse, rândul ține loc de listă. */
  total: number
  singular: string
  plural: string
  onReveal: () => void
  className?: string
}) {
  if (hiddenCount <= 0) return null
  const { text, action } = hiddenFinalSummary(hiddenCount, total, singular, plural)
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft ${className}`}>
      <span>{text}</span>
      <button
        type="button"
        onClick={onReveal}
        aria-label={`${action}: ${text}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-plate)] px-1 font-semibold text-[var(--sg-accent)] underline-offset-4 hover:underline pointer-fine:min-h-8"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
        {action}
      </button>
    </div>
  )
}
