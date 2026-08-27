'use client'

import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type SelectFilterOption = { value: string; label: string }

/**
 * Dropdown-ul de filtrare folosit în aplicație. Nu e un `select` nativ: Chrome
 * așază lista peste control, centrată pe opțiunea aleasă, așa că se deschidea
 * în sus și acoperea filtrul. Lista de aici pornește întotdeauna sub buton.
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
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = options.find(option => option.value === value)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={`relative min-w-[180px] ${className ?? ''}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <span className={`truncate ${selected ? 'text-slate-700' : 'text-slate-500'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {[{ value: '', label: placeholder }, ...options].map(option => (
            <button
              key={option.value || '__all__'}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => { onChange(option.value); setOpen(false) }}
              className={`block w-full truncate px-4 py-2 text-left text-sm transition-colors ${option.value === value
                ? 'bg-indigo-50 font-semibold text-indigo-700'
                : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
