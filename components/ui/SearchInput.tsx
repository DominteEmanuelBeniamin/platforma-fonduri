'use client'

import { Search, X } from 'lucide-react'
import { IconButton } from './IconButton'

/**
 * Câmpul de căutare, cu lupa la stânga și ștergerea la dreapta. Un singur loc
 * unde se definește, ca să nu difere de la un ecran la altul.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  size = 'md',
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
  size?: 'sm' | 'md'
}) {
  const h = size === 'sm' ? 'h-10' : 'h-11 sm:h-10'
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-faint ${size === 'sm' ? 'left-3 h-3.5 w-3.5' : 'left-3.5 h-4 w-4'}`}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={`${h} w-full rounded-[var(--radius-plate)] border border-rule bg-plate ${size === 'sm' ? 'pl-9' : 'pl-10'} pr-10 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)]`}
      />
      {value && (
        <IconButton
          label="Șterge căutarea"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 sm:h-8 sm:w-8"
        >
          <X className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  )
}
