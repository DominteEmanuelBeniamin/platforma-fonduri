'use client'

import { useId } from 'react'
import { CIF_COUNTRIES, type CifCountryCode } from '@/lib/cif'

export type CifInputValue = { country: CifCountryCode; number: string }
export type CifInputError = { field: 'cif' | 'cifCountry'; message: string }

export default function CifInput({ value, onChange, onBlur, error, disabled = false }: {
  value: CifInputValue
  onChange: (value: CifInputValue) => void
  onBlur: () => void
  error: CifInputError | null
  disabled?: boolean
}) {
  const id = useId()
  const country = CIF_COUNTRIES.find(item => item.code === value.country) ?? CIF_COUNTRIES[0]
  const inputClass = 'h-11 min-w-0 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink transition-colors focus:border-[var(--sg-accent)] disabled:opacity-55 sm:h-10'
  const description = `${error ? `${id}-error ` : ''}${id}-help`
  return (
    <div className="min-w-0 space-y-2">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={`${id}-country`} className="mb-1.5 block text-sm font-semibold text-ink">Țara firmei <span aria-hidden="true" className="text-[var(--sg-danger)]">*</span></label>
          <select id={`${id}-country`} name="cifCountry" value={value.country} disabled={disabled} required
            onChange={event => onChange({ ...value, country: event.target.value as CifCountryCode })}
            onBlur={onBlur} aria-invalid={error?.field === 'cifCountry'} aria-describedby={description} className={inputClass}>
            {CIF_COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.label} ({item.prefix})</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-number`} className="mb-1.5 block text-sm font-semibold text-ink">{value.country === 'RO' ? 'CUI / CIF' : 'Număr TVA'} <span aria-hidden="true" className="text-[var(--sg-danger)]">*</span></label>
          <input id={`${id}-number`} name="cif" type="text" inputMode={value.country === 'RO' ? 'numeric' : 'text'} required disabled={disabled}
            value={value.number} onChange={event => onChange({ ...value, number: event.target.value })} onBlur={onBlur}
            autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder={country.example.slice(country.prefix.length)}
            aria-invalid={error?.field === 'cif'} aria-describedby={description} className={`${inputClass} ${error?.field === 'cif' ? 'border-[var(--sg-danger)]' : ''}`} />
        </div>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-[var(--sg-danger)]">{error.message}</p>}
      <p id={`${id}-help`} className="text-xs leading-relaxed text-ink-soft">
        {value.country === 'RO'
          ? 'CUI pentru firme plătitoare sau neplătitoare de TVA. Prefixul RO nu atestă statutul TVA.'
          : `Format: ${country.format}. Pentru firmele din alte țări UE este necesar un identificator TVA; firmele fără unul nu sunt încă acceptate.`}
        {' '}Poți lipi numărul cu prefix. Exemplu: {country.example}.
      </p>
    </div>
  )
}
