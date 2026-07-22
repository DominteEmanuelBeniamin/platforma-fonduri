'use client'

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Search, X, Layers, ListChecks, FileText } from 'lucide-react'
import { filterSearchIndex, type SearchResult, type SearchResultType } from '@/lib/projectSearch'

interface UnifiedSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  index: SearchResult[]
  onSelect: (result: SearchResult) => void
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

/** Evidențiază prima potrivire a interogării în text (case-insensitive). */
function highlightMatch(text: string, query: string) {
  const q = query.trim()
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200 text-amber-900 font-semibold rounded-sm px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  )
}

export default function UnifiedSearchDialog({ open, onOpenChange, index, onSelect }: UnifiedSearchDialogProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const results = useMemo(() => filterSearchIndex(index, query), [index, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const select = (result: SearchResult) => {
    onSelect(result)
    onOpenChange(false)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
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
        <Dialog.Overlay className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[999999]" />
        <Dialog.Content
          className="project-scope fixed left-1/2 top-[12vh] -translate-x-1/2 w-[calc(100%-2rem)] max-w-xl max-h-[70vh] overflow-hidden bg-[var(--p-surface)] rounded-2xl shadow-2xl z-[999999] flex flex-col focus:outline-none"
          onKeyDown={handleKeyDown}
        >
          <Dialog.Title className="sr-only">Căutare în proiect</Dialog.Title>
          <Dialog.Description className="sr-only">
            Caută faze, activități și cereri de documente
          </Dialog.Description>

          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--p-border)] flex-shrink-0">
            <Search className="w-4 h-4 text-[var(--p-ink-faint)] flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Caută faze, activități, cereri de documente..."
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
              <p className="p-6 text-center text-sm text-[var(--p-ink-faint)]">Scrie pentru a căuta prin proiect.</p>
            ) : results.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--p-ink-faint)]">Niciun rezultat pentru „{query}”.</p>
            ) : (
              <ul className="py-2">
                {results.map((r, i) => {
                  const Icon = TYPE_ICON[r.type]
                  const context =
                    r.type === 'phase'
                      ? null
                      : r.type === 'activity'
                      ? r.phaseName
                      : [r.phaseName, r.activityName].filter(Boolean).join(' / ') || 'Cerere generală'
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
                          <p className="text-sm font-medium text-[var(--p-ink)] truncate">{highlightMatch(r.title, query)}</p>
                          {context && <p className="text-xs text-[var(--p-ink-faint)] truncate">{context}</p>}
                        </div>
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
