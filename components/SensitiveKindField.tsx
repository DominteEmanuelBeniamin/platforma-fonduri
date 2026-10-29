'use client'

import { SENSITIVE_KINDS, SENSITIVE_LABELS, sensitiveRuleHint, type SensitiveKind } from '@/lib/sensitive-documents'

/**
 * „Date sensibile” pe o cerere de document: aceeași alegere în editorul de
 * șabloane și în formularul cererii din proiect. Sub opțiuni stă regula de
 * ștergere a tipului ales, ca omul să știe ce declanșează bifa.
 */
export function SensitiveKindField({
  value,
  onChange,
  name,
  layout = 'column',
}: {
  value: SensitiveKind | null
  onChange: (value: SensitiveKind | null) => void
  /** Numele grupului de radio: unic în pagină. */
  name: string
  layout?: 'row' | 'column'
}) {
  const options: { value: SensitiveKind | null; label: string }[] = [
    { value: null, label: 'Nu' },
    ...SENSITIVE_KINDS.map(kind => ({ value: kind, label: SENSITIVE_LABELS[kind] })),
  ]
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">Date sensibile</legend>
      <div className={layout === 'row' ? 'flex flex-wrap gap-x-4 gap-y-2' : 'space-y-2'}>
        {options.map(option => (
          <label key={option.value ?? 'nu'} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={name}
              value={option.value ?? ''}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="h-4 w-4 border-rule-strong text-[var(--sg-accent)]"
            />
            <span className="text-sm text-ink">{option.label}</span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{sensitiveRuleHint(value)}</p>
    </fieldset>
  )
}
