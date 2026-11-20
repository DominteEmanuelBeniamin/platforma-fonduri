'use client'

import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { FloatingSurface } from './ui/Surface'
import { searchItems } from '@/lib/search'

export type SelectFilterOption = { value: string; label: string }

/**
 * Dropdown-ul de filtrare folosit în aplicație. Nu e un `select` nativ: Chrome
 * așază lista peste control, centrată pe opțiunea aleasă, așa că se deschidea
 * în sus și acoperea filtrul. Lista de aici pornește întotdeauna sub buton.
 *
 * Fiindcă nu e nativ, tastatura vine de aici: focusul rămâne pe buton, iar
 * opțiunea curentă e anunțată prin `aria-activedescendant`. Săgeți, Home/End,
 * Enter/Space și Escape fac ce ar fi făcut un `select`.
 */
export default function SelectFilter({
  value, onChange, placeholder, options, ariaLabel, className, searchable = false, searchPlaceholder = 'Caută',
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: SelectFilterOption[]
  ariaLabel?: string
  className?: string
  searchable?: boolean
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const listboxId = useId()

  // Prima intrare golește filtrul, deci lista are cu una mai mult decât `options`.
  const filtered = searchable && query.trim() ? searchItems(options, query, option => [{ key: 'label', label: 'Opțiune', value: option.label }]).map(hit => hit.item) : options
  const items: SelectFilterOption[] = [{ value: '', label: placeholder }, ...filtered]
  const selectedIndex = Math.max(items.findIndex(option => option.value === value), 0)
  const selected = options.find(option => option.value === value)
  const optionId = (index: number) => `${listboxId}-option-${index}`
  // Lista se poate scurta cât e deschisă (proiectele se încarcă asincron).
  const active = Math.min(activeIndex, items.length - 1)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Opțiunea activă trebuie să fie și vizibilă: lista se derulează la 264px.
  useEffect(() => {
    if (!open) return
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  useEffect(() => { if (open && searchable) searchRef.current?.focus() }, [open, searchable])

  const openAt = (index: number) => {
    setQuery('')
    setActiveIndex(Math.min(Math.max(index, 0), items.length - 1))
    setOpen(true)
  }

  const commit = (index: number) => {
    onChange(items[index].value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openAt(selectedIndex)
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex(Math.min(active + 1, items.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex(Math.max(active - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(items.length - 1)
        break
      case 'Enter':
      case ' ':
        if (event.key === ' ' && event.target === searchRef.current) break
        event.preventDefault()
        commit(active)
        break
    }
  }

  return (
    <div ref={containerRef} className={`relative min-w-[180px] ${className ?? ''}`}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : openAt(Math.max([{ value: '', label: placeholder }, ...options].findIndex(option => option.value === value), 0)))}
        onKeyDown={onKeyDown}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-plate)] border border-rule bg-plate px-4 text-left text-sm transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-10"
      >
        <span className={`truncate ${selected ? 'text-ink' : 'text-ink-soft'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <FloatingSurface
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-plate-lg)] py-1"
        >
          {searchable && <div className="px-2 pb-1 pt-1"><input ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); setActiveIndex(1) }} onKeyDown={onKeyDown} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="w-full rounded-[var(--radius-plate)] border border-rule bg-paper px-3 py-2 text-sm text-ink" /></div>}
          <div ref={listRef} id={listboxId} role="listbox" aria-label={ariaLabel}>
            {items.map((option, index) => (
              <button
                key={option.value || '__all__'}
                id={optionId(index)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === selectedIndex}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                className={`block w-full truncate px-4 py-2 text-left text-sm transition-colors duration-[120ms] ${index === selectedIndex
                  ? 'bg-[var(--sg-accent-soft)] font-semibold text-[var(--sg-accent)]'
                  : index === active
                    ? 'bg-paper-sunk text-ink'
                    : 'text-ink-soft'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {searchable && query.trim() && filtered.length === 0 && <p className="px-4 py-2 text-sm text-ink-soft">Niciun context găsit.</p>}
        </FloatingSurface>
      )}
    </div>
  )
}
