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
  className = 'mb-6',
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Pentru paginile care mută focusul pe titlu (`id`, `tabIndex`). */
  titleProps?: { id?: string; tabIndex?: number }
  /** Spațiul de sub antet; o pagină cu `gap` propriu îl pune pe zero. */
  className?: string
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

  // Cât stă lipit (de la md în sus), antetul își spune înălțimea în
  // `--antet-lipit`, din care `html` își face `scroll-padding-top`: un element
  // focalizat cu Tab sau Shift+Tab nu mai ajunge sub meniu și sub antet
  // (WCAG 2.4.11).
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const header = headerRef.current
    if (!header || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const wide = window.matchMedia('(min-width: 768px)')
    const update = () => {
      if (wide.matches) root.style.setProperty('--antet-lipit', `${header.offsetHeight}px`)
      else root.style.removeProperty('--antet-lipit')
    }
    const resize = new ResizeObserver(update)
    resize.observe(header)
    wide.addEventListener('change', update)
    update()
    return () => {
      resize.disconnect()
      wide.removeEventListener('change', update)
      root.style.removeProperty('--antet-lipit')
    }
  }, [])

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-0" />
      <header
        ref={headerRef}
        data-stuck={stuck || undefined}
        className={`${className} border-b border-transparent bg-paper md:sticky md:top-16 md:z-30 md:-mx-6 md:px-6 md:py-3 lg:-mx-10 lg:px-10 md:data-[stuck]:border-rule`}
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
          {actions && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
        </div>
      </header>
    </>
  )
}
