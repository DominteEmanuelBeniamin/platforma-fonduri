import type { ReactNode } from 'react'

/**
 * Ecranul gol nu e o absență, e un semn: spune ce lipsește și ce urmează.
 * Fără ilustrație și fără glumă — un panou gol dintr-un hol bine ținut are
 * totuși un text pe el.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="border border-dashed border-rule-strong rounded-[var(--radius-plate)] px-6 py-12 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      {children ? (
        <p className="mx-auto mt-2 max-w-[52ch] text-sm leading-6 text-ink-soft">{children}</p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}
