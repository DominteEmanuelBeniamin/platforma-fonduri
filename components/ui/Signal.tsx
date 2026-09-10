import { TONE, type SignalTone } from '@/lib/signage'
import { ToneIcon } from './ToneIcon'

/**
 * Plăcuța de stare. Poartă întotdeauna trei lucruri deodată — culoare, glifă
 * și cuvânt — ca informația să nu depindă de vedere sau de ecran (WCAG 1.4.1).
 */
export function Signal({
  tone,
  children,
  className = '',
}: {
  tone: SignalTone
  children: React.ReactNode
  className?: string
}) {
  const t = TONE[tone]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-plate)] px-2 py-0.5 text-xs font-semibold leading-5 ${className}`}
      style={{ background: t.bg, color: t.fg }}
    >
      <ToneIcon tone={tone} />
      {children}
    </span>
  )
}
