'use client'

import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import InlineInput from '@/components/InlineInput'
import { TONE, bandVar, type SignalTone } from '@/lib/signage'
import { progressLabel, type Progress } from '@/lib/completion'
import { ProgressCell } from './cells'

/**
 * Coloanele tabelului de activități. Aceeași listă desenează antetul, rândurile
 * și sumarul grupului, ca să rămână aliniate. Coloana „Vizibil clientului” e a
 * echipei; cea de acțiuni („⋯”) apare doar cui poate modifica.
 */
export type ActivityColumns = { visibility: boolean; actions: boolean }

export function activityColumnsTemplate({ visibility, actions }: ActivityColumns): string {
  return [
    'minmax(10rem,1fr)',        // Activitate
    'minmax(7rem,9.5rem)',      // Responsabil
    '10rem',                    // Status — încape „Document respins” pe un rând
    '5.75rem',                  // Documente
    'minmax(5.75rem,7rem)',     // Termen — lat cât intervalul din sumar
    visibility && 'minmax(8.5rem,10rem)', // Vizibil clientului
    actions && '2.5rem',        // ⋯
  ].filter(Boolean).join(' ')
}

/** Antetul coloanelor — doar în forma lată; pe fișe, celulele își spun singure. */
export function ColumnHeader({ labels, first }: { labels: string[]; first: string }) {
  return (
    <div
      aria-hidden="true"
      className="hidden h-8 border-b border-rule text-[11px] font-medium text-ink-faint @min-[50rem]:grid @min-[50rem]:grid-cols-(--cols)"
    >
      <span className="flex items-center pl-9">{first}</span>
      {labels.map((label, i) => (
        <span key={`${label}-${i}`} className="flex items-center justify-center px-2 text-center leading-tight">
          {label}
        </span>
      ))}
    </div>
  )
}

export type SummarySegment = { tone: SignalTone; label: string; count: number }

/**
 * Bateria grupului, ca în monday, dar subțire: câte activități sunt în fiecare
 * stare, ca fâșii lipite, lungi cât proporția lor — lată cât o etichetă de
 * stare, chiar sub coloana lor. Pentru cititoare, aceeași numărătoare în
 * cuvinte; fiecare fâșie își spune numărul și la trecerea mausului.
 */
export function StatusBattery({ segments }: { segments: SummarySegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return null
  const sentence = segments.map(s => `${s.count} ${s.label.toLowerCase()}`).join(', ')
  return (
    <span role="img" aria-label={`Stările activităților: ${sentence}`} className="flex h-1.5 w-full min-w-24 gap-0.5 overflow-hidden rounded-[1px] @min-[50rem]:w-[8.75rem]">
      {segments.map(s => (
        <span
          key={s.tone + s.label}
          title={`${s.label}: ${s.count}`}
          className="h-full"
          style={{
            flexGrow: s.count,
            flexBasis: 0,
            background: s.tone === 'neutral' ? 'var(--sg-rule-strong)' : TONE[s.tone].fg,
          }}
        />
      ))}
    </span>
  )
}

/**
 * Rândul de sumar al grupului, sub ultimul rând — și singurul rând când grupul
 * e strâns: bateria stărilor sub coloana „Status”, cererile gata sub
 * „Documente”, intervalul termenelor deschise sub „Termen”.
 */
export function GroupSummary({
  columns,
  segments,
  docs,
  range,
}: {
  columns: ActivityColumns
  segments: SummarySegment[]
  docs: Progress
  range: { label: string; overdue: boolean } | null
}) {
  const wideOnly = 'hidden @min-[50rem]:block'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 @min-[50rem]:grid @min-[50rem]:min-h-9 @min-[50rem]:grid-cols-(--cols) @min-[50rem]:gap-0 @min-[50rem]:p-0">
      <span className={wideOnly} />
      <span className={wideOnly} />
      <span className="flex min-w-32 flex-1 items-center justify-center">
        <StatusBattery segments={segments} />
      </span>
      <span className="flex items-center justify-center">
        <ProgressCell done={docs.done} total={docs.total} sentence={progressLabel(docs, 'cerere', 'cereri')} />
      </span>
      <span className="flex items-center justify-center">
        {range && (
          <span
            title={range.overdue ? 'Termenele activităților deschise; primul a trecut' : 'Termenele activităților deschise'}
            className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium tabular-nums"
            style={{ color: range.overdue ? 'var(--sg-danger)' : 'var(--sg-ink-faint)' }}
          >
            {range.overdue && <AlertTriangle className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />}
            {range.label}
            {range.overdue && <span className="sr-only"> — are termene depășite</span>}
          </span>
        )}
      </span>
      {columns.visibility && <span className={wideOnly} />}
      {columns.actions && <span className={wideOnly} />}
    </div>
  )
}

/**
 * Un grup al tabelului — o fază, ca un grup din monday: titlul în culoarea
 * fazei, deasupra; dedesubt plăcuța cu rândurile, cu muchia stângă în aceeași
 * culoare. Muchia e coloana vertebrală a grupului, nu decor pe un rând: leagă
 * antetul, rândurile și sumarul și se recunoaște de departe, ca banda din
 * panou. Faza în pregătire are muchia întreruptă — plăcuța încă nemontată.
 */
export default function TableGroup({
  id,
  title,
  band,
  draft = false,
  icon,
  collapsed,
  onToggle,
  badges,
  meta,
  actions,
  columns,
  renaming,
  renameLoading,
  onRenameSubmit,
  onRenameCancel,
  summary,
  children,
}: {
  /** Id-ul fazei; ancora e `phase-${id}`, aceeași ca la deep-linkuri. */
  id: string
  title: string
  /** Banda fazei, 1–6; `null` pentru „Cereri generale”, care nu e o fază. */
  band: number | null
  draft?: boolean
  icon?: ReactNode
  collapsed: boolean
  onToggle: () => void
  /** Lângă titlu: publicarea, „Finalizată”. */
  badges?: ReactNode
  /** Textul mic de după titlu: „3 din 5 activități finalizate”. */
  meta?: string
  actions?: ReactNode
  /** Șablonul de coloane, pus ca `--cols` pentru antet, rânduri și sumar. */
  columns?: string
  renaming?: boolean
  renameLoading?: boolean
  onRenameSubmit?: (name: string) => void
  onRenameCancel?: () => void
  /** Rândul de sumar, vizibil și cu grupul strâns. */
  summary?: ReactNode
  children: ReactNode
}) {
  const color = band ? bandVar(band) : 'var(--sg-ink-soft)'
  const spine = band ? bandVar(band) : 'var(--sg-rule-strong)'
  const headingId = `phase-title-${id}`

  return (
    <section
      id={`phase-${id}`}
      aria-labelledby={headingId}
      className="scroll-mt-24 md:scroll-mt-48"
      style={columns ? ({ '--cols': columns } as CSSProperties) : undefined}
    >
      <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 pb-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Extinde' : 'Restrânge'} grupul ${title}`}
          className="-ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-plate)] transition-colors duration-[120ms] hover:bg-paper-sunk pointer-fine:h-7 pointer-fine:w-7"
          style={{ color }}
        >
          <ChevronDown className={`h-4 w-4 transition-transform duration-[160ms] ${collapsed ? '-rotate-90' : ''}`} strokeWidth={2.5} />
        </button>
        {icon}
        {renaming && onRenameSubmit && onRenameCancel ? (
          <div className="min-w-[14rem] flex-1">
            <InlineInput
              size="md"
              initialValue={title}
              placeholder="Nume fază..."
              loading={!!renameLoading}
              onConfirm={onRenameSubmit}
              onCancel={onRenameCancel}
            />
          </div>
        ) : (
          <h2 id={headingId} className="min-w-0 break-words text-[15px] font-bold leading-snug tracking-tight" style={{ color }}>
            {title}
          </h2>
        )}
        {badges}
        {meta && <span className="text-xs text-ink-faint">{meta}</span>}
        {actions && <span className="ml-auto flex items-center">{actions}</span>}
      </div>

      {(!collapsed || summary) && (
      <div className="relative rounded-[var(--radius-plate-lg)] border border-rule bg-plate pl-1">
        <span
          aria-hidden="true"
          className="absolute -left-px -top-px -bottom-px w-1 rounded-l-[var(--radius-plate-lg)]"
          style={{
            background: draft
              ? `repeating-linear-gradient(to bottom, ${spine} 0 7px, transparent 7px 11px)`
              : spine,
          }}
        />
        {!collapsed && children}
        {summary}
      </div>
      )}
    </section>
  )
}
