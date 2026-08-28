'use client'

import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

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
  value, onChange, placeholder, options, ariaLabel, className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: SelectFilterOption[]
  ariaLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  // Prima intrare golește filtrul, deci lista are cu una mai mult decât `options`.
  const items: SelectFilterOption[] = [{ value: '', label: placeholder }, ...options]
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

  const openAt = (index: number) => {
    setActiveIndex(Math.min(Math.max(index, 0), items.length - 1))
    setOpen(true)
  }

  const commit = (index: number) => {
    onChange(items[index].value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
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
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <span className={`truncate ${selected ? 'text-slate-700' : 'text-slate-500'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
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
              className={`block w-full truncate px-4 py-2 text-left text-sm transition-colors ${index === selectedIndex
                ? 'bg-indigo-50 font-semibold text-indigo-700'
                : index === active
                  ? 'bg-slate-50 text-slate-700'
                  : 'text-slate-600'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
