'use client'

import { useMemo, useState, type KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Search, X, Layers, ListChecks, FileText } from 'lucide-react'
import { Signal } from '@/components/ui/Signal'
import { requestStatusInfo } from '@/lib/request-status'
import type { SignalTone } from '@/lib/signage'
import { searchIndex, type SearchResult, type SearchResultType } from '@/lib/projectSearch'
import { FoundIn, Highlight } from '@/components/ui/Highlight'
import { rangesOf, snippetAround } from '@/lib/search'

interface UnifiedSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  index: SearchResult[]
  onSelect: (result: SearchResult) => void
  title?: string
  description?: string
  placeholder?: string
  initialStateText?: string
  emptyStateText?: string
}

const TYPE_LABEL: Record<SearchResultType, string> = {
  phase: 'Fază',
  activity: 'Activitate',
  document_request: 'Cerere document',
}

const TYPE_ICON: Record<SearchResultType, typeof Layers> = {
  phase: Layers,
  activity: ListChecks,
  document_request: FileText,
}

/** Semnul unui rezultat finalizat: fază sau activitate gata, cerere aprobată sau închisă. */
function finalMark(result: SearchResult): { tone: SignalTone; label: string } | null {
  if (result.type === 'document_request') {
    if (result.status !== 'approved' && result.status !== 'closed') return null
    const info = requestStatusInfo(result.status)
    return { tone: info.tone, label: info.label }
  }
  return result.status === 'completed' ? { tone: 'ok', label: 'Finalizată' } : null
}

export default function UnifiedSearchDialog({
  open,
  onOpenChange,
  index,
  onSelect,
  title = 'Căutare în proiect',
  description = 'Caută faze, activități și cereri de documente',
  placeholder = 'Caută faze, activități, cereri de documente...',
  initialStateText = 'Scrie pentru a căuta prin proiect.',
  emptyStateText,
}: UnifiedSearchDialogProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const hits = useMemo(() => searchIndex(index, query), [index, query])
  const results = useMemo(() => hits.map(hit => hit.item), [hits])

  const resetSearch = () => {
    setQuery('')
    setActiveIndex(0)
  }

  const select = (result: SearchResult) => {
    onSelect(result)
    onOpenChange(false)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[activeIndex]
      if (r) select(r)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 backdrop-blur-sm z-[999999]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-[12vh] -translate-x-1/2 w-[calc(100%-2rem)] max-w-xl max-h-[70vh] overflow-hidden bg-[var(--p-surface)] rounded-2xl shadow-2xl z-[999999] flex flex-col focus:outline-none"
          onOpenAutoFocus={resetSearch}
          onKeyDown={handleKeyDown}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {description}
          </Dialog.Description>

          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--p-border)] flex-shrink-0">
            <Search className="w-4 h-4 text-[var(--p-ink-faint)] flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              placeholder={placeholder}
              className="flex-1 text-sm outline-none placeholder:text-[var(--p-ink-faint)] bg-transparent text-[var(--p-ink)]"
            />
            <Dialog.Close asChild>
              <button
                type="button"
                className="p-1 rounded-lg text-[var(--p-ink-faint)] hover:text-[var(--p-ink)] hover:bg-[var(--p-surface-2)] transition-colors flex-shrink-0"
                aria-label="Închide"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto flex-1">
            {query.trim() === '' ? (
              <p className="p-6 text-center text-sm text-[var(--p-ink-faint)]">{initialStateText}</p>
            ) : results.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--p-ink-faint)]">
                {emptyStateText ?? `Niciun rezultat pentru „${query}”.`}
              </p>
            ) : (
              <ul className="py-2">
                {hits.map(({ item: r, matches }, i) => {
                  const Icon = TYPE_ICON[r.type]
                  const context =
                    r.type === 'phase'
                      ? null
                      : r.type === 'activity'
                      ? r.phaseName
                      : [r.phaseName, r.activityName].filter(Boolean).join(' / ') || 'Cerere generală'
                  const descriptionRanges = rangesOf(matches, 'description')
                  const snippet = r.description && descriptionRanges.length > 0 ? snippetAround(r.description, descriptionRanges) : null
                  return (
                    <li key={`${r.type}-${r.id}`}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => select(r)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          i === activeIndex ? 'bg-[var(--p-accent-soft)]' : 'hover:bg-[var(--p-surface-2)]'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-[var(--p-surface-2)] flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4 h-4 text-[var(--p-ink-soft)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--p-ink)] truncate"><Highlight text={r.title} ranges={rangesOf(matches, 'title')} /></p>
                          {snippet && (
                            <p className="text-xs text-[var(--p-ink-soft)] truncate">
                              <Highlight text={snippet.text} ranges={snippet.ranges} />
                            </p>
                          )}
                          <FoundIn matches={matches} />
                          {context && <p className="text-xs text-[var(--p-ink-faint)] truncate">{context}</p>}
                        </div>
                        {/* Ce e finalizat se găsește la fel, dar se spune (#109): în
                            pagină poate fi ascuns, iar selecția îl dezvăluie. */}
                        {finalMark(r) && (
                          <Signal tone={finalMark(r)!.tone} className="flex-shrink-0">{finalMark(r)!.label}</Signal>
                        )}
                        <span className="text-[10px] font-semibold text-[var(--p-ink-faint)] uppercase tracking-wide flex-shrink-0">
                          {TYPE_LABEL[r.type]}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
