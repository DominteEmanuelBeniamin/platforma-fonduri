'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { SearchInput } from '@/components/ui/SearchInput'
import { FoundIn, Highlight } from '@/components/ui/Highlight'
import { rangesOf, searchItems, type FieldMatch, type SearchField } from '@/lib/search'

export interface FilterOption {
  value: string
  label: string
  /** Antet sub care se strâng opțiunile — proiectele, de pildă, pe client. */
  group?: string
  /** Ce se mai caută la opțiune, în afară de etichetă și grup (#112). */
  search?: SearchField[]
}

/**
 * O dimensiune de filtrare. `null` înseamnă „toate" — absența filtrului, nu
 * lista completă bifată manual.
 */
export interface FilterSection {
  key: string
  title?: string
  allLabel: string
  options: FilterOption[]
  value: string[] | null
  onChange: (next: string[] | null) => void
  /** Cu text aici, secțiunea are casetă de căutare (#112). */
  searchLabel?: string
}

interface FilterDropdownProps {
  label: string
  summary: string
  sections: FilterSection[]
  /** Marchează butonul ca filtrat, chiar dacă rezumatul e scurt. */
  active?: boolean
}

/**
 * Singurul dropdown cu bife din calendar. Primește secțiuni, nu o singură
 * listă, fiindcă filtrul „Stare" ține două dimensiuni independente — progres și
 * publicare — sub același buton, iar un al doilea dropdown ar fi fost aceeași
 * mecanică scrisă a doua oară.
 */
export default function FilterDropdown({ label, summary, sections, active }: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchLabel = sections.find(section => section.searchLabel)?.searchLabel

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const toggle = (section: FilterSection, value: string) => {
    const all = section.options.map(option => option.value)
    const current = section.value === null ? all : section.value
    const next = current.includes(value)
      ? current.filter(entry => entry !== value)
      : [...current, value]
    section.onChange(next.length === all.length ? null : next)
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button data-tooltip={`Filtrează după ${label.toLowerCase()}`}
        type="button"
        onClick={() => {
          setQuery('')
          setOpen(value => !value)
        }}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)] ${
          active
            ? 'border-[var(--p-accent)] bg-[var(--p-accent-soft)] text-[var(--p-accent-ink)]'
            : 'border-[var(--p-border-strong)] bg-[var(--p-surface)] text-[var(--p-ink-soft)] hover:bg-[var(--p-surface-2)]'
        }`}
      >
        <span className="text-[var(--p-ink-faint)]">{label}:</span>
        <span className="max-w-[9rem] truncate">{summary}</span>
        <ChevronDown className={`h-3 w-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div
          role="group"
          aria-label={label}
          className="absolute left-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)] p-1 shadow-xl"
        >
          {searchLabel && (
            <div className="sticky top-0 z-10 bg-[var(--p-surface)] p-1">
              <SearchInput size="sm" value={query} onChange={setQuery} placeholder={`${searchLabel}…`} label={searchLabel} />
            </div>
          )}
          {sections.map((section, index) => (
            <div key={section.key} className={index > 0 ? 'mt-1 border-t border-[var(--p-border)] pt-1' : ''}>
              {section.title && (
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--p-ink-faint)]">
                  {section.title}
                </p>
              )}

              {!(section.searchLabel && query.trim()) && (
                <CheckRow
                  label={section.allLabel}
                  checked={section.value === null}
                  onSelect={() => section.onChange(null)}
                />
              )}

              {renderOptions(section, toggle, section.searchLabel ? query : '')}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Opțiunile secțiunii, cu antet acolo unde există grup.
 *
 * Cele fără grup rămân sus, fără antet, chiar dacă restul sunt grupate:
 * gruparea e o comoditate de citire, nu un filtru. Sărite la randare, ele ar fi
 * continuat să restrângă lista din `value`, fără bifă prin care să fie scoase.
 */
function renderOptions(section: FilterSection, toggle: (section: FilterSection, value: string) => void, query: string) {
  const checked = (value: string) => section.value === null || section.value.includes(value)
  // Clientul (grupul) se caută și el: „pop" arată toate proiectele lui Popescu.
  const hits = searchItems(section.options, query, option => [
    { key: 'label', label: 'Nume', value: option.label },
    { key: 'group', label: 'Grup', value: option.group },
    ...(option.search ?? []),
  ])
  if (hits.length === 0) {
    return <p className="px-2 py-3 text-center text-xs text-[var(--p-ink-faint)]">Niciun rezultat</p>
  }
  const matchesOf = new Map(hits.map(hit => [hit.item.value, hit.matches]))
  const options = hits.map(hit => hit.item)
  const row = (option: FilterOption) => (
    <CheckRow
      key={option.value}
      label={option.label}
      matches={matchesOf.get(option.value) ?? []}
      checked={checked(option.value)}
      onSelect={() => toggle(section, option.value)}
    />
  )
  const groups = [...new Set(options.map(option => option.group).filter(Boolean))] as string[]

  return (
    <>
      {options.filter(option => !option.group).map(row)}
      {groups.map(group => (
        <div key={group}>
          <p className="px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--p-ink-faint)]"><Highlight text={group} query={query} /></p>
          {options.filter(option => option.group === group).map(row)}
        </div>
      ))}
    </>
  )
}

function CheckRow({
  label,
  matches = [],
  checked,
  onSelect,
}: {
  label: string
  matches?: FieldMatch[]
  checked: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--p-ink)] transition-colors hover:bg-[var(--p-surface-2)] focus:outline-none focus-visible:bg-[var(--p-surface-2)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--p-accent,#4A3F7A)]"
    >
      <span
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
          checked
            ? 'border-[var(--p-accent)] bg-[var(--p-accent)] text-white'
            : 'border-[var(--p-border-strong)] bg-[var(--p-surface)]'
        }`}
        aria-hidden
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate"><Highlight text={label} ranges={rangesOf(matches, 'label')} /></span>
        <FoundIn matches={matches} className="text-[10px]" />
      </span>
    </button>
  )
}

/** Textul de pe buton: „Toate fazele", numele unic sau „3 faze". */
export function summarizeSelection(
  value: string[] | null,
  options: FilterOption[],
  allLabel: string,
  countLabel: (count: number) => string,
): string {
  if (value === null) return allLabel
  if (value.length === 0) return 'Niciuna'
  if (value.length === 1) return options.find(option => option.value === value[0])?.label ?? countLabel(1)
  if (value.length === options.length) return allLabel
  return countLabel(value.length)
}
