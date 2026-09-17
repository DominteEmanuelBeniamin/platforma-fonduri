'use client'

import { useRef } from 'react'
import { bandVar, TONE, type SignalTone } from '@/lib/signage'
import { ToneIcon } from './ui/ToneIcon'

export type BoardItem = {
  id: string
  name: string
  status: string | null
  deadline_at: string | null
  activity_id: string | null
  activity_name: string | null
}

export type BoardRow = {
  id: string
  name: string
  /** Banda fazei, 1–6, derivată din poziția ei în proiect. */
  band: number
  /** Faza nepublicată se desenează ca plăcuță nemontată. */
  draft?: boolean
  items: BoardItem[]
}

/** Starea unei cereri, în vocabularul semnalizării. Ordinea contează: ce arde
 *  întâi. */
export function itemTone(item: BoardItem, todayTs: number): SignalTone {
  if (item.status === 'approved') return 'ok'
  const d = item.deadline_at ? new Date(item.deadline_at) : null
  if (d) d.setHours(0, 0, 0, 0)
  if (d && !Number.isNaN(d.getTime()) && d.getTime() < todayTs) return 'danger'
  if (item.status === 'rejected') return 'danger'
  if (item.status === 'review') return 'warn'
  return 'neutral'
}

const TONE_CUVANT: Record<SignalTone, string> = {
  danger: 'termen depășit sau respins',
  warn: 'de verificat',
  neutral: 'la client',
  ok: 'aprobat',
  draft: 'în lucru',
}

const MAX_VIZIBILE = 24

/**
 * Panoul cu chei.
 *
 * Tot proiectul pe o singură suprafață: fiecare fază e un rând cu numele
 * întreg — niciodată trunchiat — banda ei pe muchie și cererile ca plăcuțe
 * mici, colorate după stare. Consultantul vede toate fazele deodată, în loc
 * să deschidă una ca să ascundă treisprezece.
 *
 * Plăcuțele au 24px, minimul cerut de WCAG 2.5.8, și formează un grup compozit:
 * Tab sare de la un rând la altul, săgețile se plimbă în interiorul rândului.
 * Altfel o fază cu douăzeci de cereri ar costa douăzeci de apăsări de Tab.
 */
export function ProjectBoard({
  rows,
  todayTs,
  onOpen,
}: {
  rows: BoardRow[]
  todayTs: number
  onOpen: (item: BoardItem, rowId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  const muta = (e: React.KeyboardEvent, rowId: string, index: number, total: number) => {
    let next = index
    if (e.key === 'ArrowRight') next = Math.min(index + 1, total - 1)
    else if (e.key === 'ArrowLeft') next = Math.max(index - 1, 0)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = total - 1
    else return
    e.preventDefault()
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-rand="${rowId}"] [data-pozitie="${next}"]`)
      ?.focus()
  }

  return (
    <div ref={containerRef} className="flex flex-col">
      {rows.map((row) => {
        const vizibile = row.items.slice(0, MAX_VIZIBILE)
        const ascunse = row.items.length - vizibile.length
        const gata = row.items.filter((i) => i.status === 'approved').length

        return (
          <div
            key={row.id}
            data-rand={row.id}
            className="relative flex flex-col gap-2 border-b border-rule pb-3 pt-4 last:border-b-0 sm:flex-row sm:items-start sm:gap-4"
          >
            {/* Banda aripii, pe muchia de sus — niciodată border-left. Faza „în
                lucru" n-are bandă deloc; se recunoaște deja după pastila de mai
                jos, nu are nevoie și de-o bară în culoarea greșită. */}
            {!row.draft && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[var(--sg-rail)]"
                style={{ background: bandVar(row.band) }}
              />
            )}
            <div className="flex min-w-0 shrink-0 items-center gap-2.5 sm:w-72">
              <span className="min-w-0 text-sm font-semibold leading-snug text-ink">{row.name}</span>
              {row.draft && (
                <span className="shrink-0 rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-1.5 py-0.5 text-xs font-semibold text-ink-faint">
                  în lucru
                </span>
              )}
            </div>

            <div
              role="group"
              aria-label={`Cererile din faza ${row.name}`}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
            >
              {vizibile.map((item, i) => {
                const tone = itemTone(item, todayTs)
                const t = TONE[tone]
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-pozitie={i}
                    tabIndex={i === 0 ? 0 : -1}
                    onKeyDown={(e) => muta(e, row.id, i, vizibile.length)}
                    onClick={() => onOpen(item, row.id)}
                    title={`${item.name}${item.activity_name ? ` · ${item.activity_name}` : ''} — ${TONE_CUVANT[tone]}`}
                    aria-label={`${item.name}, ${TONE_CUVANT[tone]}`}
                    className="flex h-6 w-6 items-center justify-center rounded-[1px] transition-transform duration-[120ms] hover:scale-125"
                    style={{
                      background: t.bg,
                      color: t.fg,
                      border: `1px solid ${tone === 'neutral' ? 'var(--sg-rule-strong)' : `${t.fg}55`}`,
                    }}
                  >
                    <ToneIcon tone={tone} className="h-3.5 w-3.5" />
                  </button>
                )
              })}
              {ascunse > 0 && (
                <span className="px-1 text-xs font-semibold text-ink-faint">+{ascunse}</span>
              )}
              {row.items.length === 0 && (
                <span className="text-xs text-ink-faint">nicio cerere</span>
              )}
            </div>

            {row.items.length > 0 && (
              <span className="shrink-0 text-xs font-semibold text-ink-soft sm:w-16 sm:text-right">
                {gata}/{row.items.length}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
