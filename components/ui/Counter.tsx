/**
 * Contor mic și plin. Într-un program de semnalizare un număr e o plăcuță, nu
 * un punct de alarmă: roșul rămâne rezervat pentru ce chiar arde.
 */
export function Counter({
  n,
  label,
  variant = 'accent',
  className = '',
}: {
  n: number
  label?: string
  variant?: 'accent' | 'quiet'
  className?: string
}) {
  return (
    <span
      aria-label={label}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[1px] px-1 text-xs font-bold leading-none ${
        variant === 'accent' ? 'bg-[var(--sg-accent)] text-white' : 'bg-paper-sunk text-ink-soft'
      } ${className}`}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
