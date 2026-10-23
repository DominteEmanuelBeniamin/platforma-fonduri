import { Fragment } from 'react'
import { findRanges, hiddenMatches, type FieldMatch, type MatchRange, type SearchFieldKind } from '@/lib/search'

const MARK = 'rounded-[1px] bg-[var(--sg-warn-soft)] font-semibold text-[var(--sg-warn)]'

/**
 * Textul cu ce s-a căutat marcat. Primește fie interogarea (și află singur
 * unde cade), fie pozițiile gata calculate de `matchFields`. Marchează toate
 * potrivirile, și pe cele găsite fără diacritice sau cu o greșeală de tastare.
 */
export function Highlight({
  text,
  query,
  ranges,
  kind = 'text',
}: {
  text: string | null | undefined
  query?: string
  ranges?: readonly MatchRange[]
  kind?: SearchFieldKind
}) {
  if (!text) return null
  const marks = ranges ?? (query ? findRanges(text, query, kind) : [])
  if (marks.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [start, end] of marks) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(<mark key={start} className={MARK}>{text.slice(start, end)}</mark>)
    at = end
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}</>
}

/**
 * „Găsit în: CIF RO12345678" — rândul mic care spune de ce a ieșit rezultatul
 * când potrivirea e într-un câmp care nu se vede pe el.
 */
export function FoundIn({ matches, className = '' }: { matches: readonly FieldMatch[]; className?: string }) {
  const hidden = hiddenMatches(matches)
  if (hidden.length === 0) return null
  return (
    <p className={`truncate text-xs text-ink-faint ${className}`}>
      Găsit în:{' '}
      {hidden.map((m, i) => (
        <Fragment key={m.key}>
          {i > 0 && ' · '}
          {m.label} <span className="text-ink-soft"><Highlight text={m.value} ranges={m.ranges} /></span>
        </Fragment>
      ))}
    </p>
  )
}
