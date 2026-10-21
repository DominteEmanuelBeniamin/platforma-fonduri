'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Antetul paginilor din meniul de sus: titlul, rândul cu cifre și acțiunile
 * (căutarea, butonul principal). De la `md` în sus rămâne lipit sub meniu la
 * derulare, ca „Șablon nou” sau „Proiect nou” să fie mereu la îndemână (S-33,
 * S-34); pe telefon ar mânca un sfert din ecran, deci acolo derulează (D5).
 *
 * Linia de jos apare doar cât e lipit: o santinelă de înălțime zero, chiar
 * deasupra, iese din ecran exact când antetul se lipește.
 *
 * Paginile din meniu nu mai au fâșie de locație: ești deja acolo, iar un link
 * spre pagina curentă n-avea ce face (S-05, S-32).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  titleProps,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Pentru paginile care mută focusul pe titlu (`id`, `tabIndex`). */
  titleProps?: { id?: string; tabIndex?: number }
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    // 64px: înălțimea meniului de sus, sub care se lipește antetul.
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 64),
      { rootMargin: '-64px 0px 0px 0px', threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-0" />
      <header
        data-stuck={stuck || undefined}
        className="mb-6 border-b border-transparent bg-paper md:sticky md:top-16 md:z-30 md:-mx-6 md:px-6 md:py-3 lg:-mx-10 lg:px-10 md:data-[stuck]:border-rule"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1
              {...titleProps}
              className="text-2xl font-bold tracking-tight text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sg-accent)] md:text-3xl"
            >
              {title}
            </h1>
            {subtitle && <div className="mt-1 text-sm text-ink-soft">{subtitle}</div>}
          </div>
          {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
    </>
  )
}
