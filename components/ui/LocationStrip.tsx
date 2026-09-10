'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { bandVar } from '@/lib/signage'

export type Segment = {
  label: string
  href?: string
  /** Banda fazei, când segmentul e o aripă a clădirii. */
  band?: number
}

/**
 * Fâșia de locație — semnul „unde vă aflați” din holul fiecărui etaj.
 *
 * Nu e un breadcrumb decorativ: e și intrarea pentru tastatură. `Alt+L` o
 * focalizează de oriunde din pagină, iar de acolo Tab parcurge etajele fără
 * mouse. Comanda folosește un modificator, deci nu încalcă 2.1.4 și nu fură
 * tastele nimănui în timp ce scrie.
 */
export function LocationStrip({
  segments,
  action,
}: {
  segments: Segment[]
  action?: React.ReactNode
}) {
  const navRef = useRef<HTMLElement>(null)
  const [hintVisible, setHintVisible] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key.toLowerCase() !== 'l') return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      const first = navRef.current?.querySelector<HTMLElement>('a, button')
      if (first) {
        first.focus()
        setHintVisible(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const last = segments.length - 1

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-rule pb-4">
      <nav
        ref={navRef}
        aria-label="Locație"
        onBlur={() => setHintVisible(false)}
        className="min-w-0"
      >
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
          {segments.map((s, i) => (
            <li key={`${s.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && (
                <span aria-hidden="true" className="px-1 text-rule-strong">/</span>
              )}
              {s.band ? (
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block h-3.5 w-[var(--sg-rail)] rounded-[1px] align-middle"
                  style={{ background: bandVar(s.band) }}
                />
              ) : null}
              {s.href && i !== last ? (
                <Link
                  href={s.href}
                  className="truncate rounded-[var(--radius-plate)] px-1 py-0.5 font-medium text-ink-soft transition-colors hover:text-ink hover:underline"
                >
                  {s.label}
                </Link>
              ) : (
                <span
                  aria-current={i === last ? 'page' : undefined}
                  className="truncate px-1 py-0.5 font-semibold text-ink"
                >
                  {s.label}
                </span>
              )}
            </li>
          ))}
        </ol>
        <p
          className={`mt-1 text-xs text-ink-faint transition-opacity duration-[120ms] ${
            hintVisible ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden={!hintVisible}
        >
          Tab parcurge etajele. Alt+L revine aici.
        </p>
      </nav>

      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}
