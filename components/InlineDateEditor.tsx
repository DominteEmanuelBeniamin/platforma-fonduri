'use client'

import { useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import { DatePopover, parseDay } from '@/components/ui/DatePicker'

interface InlineDateEditorProps {
  /** Valoarea de pornire, format YYYY-MM-DD */
  value?: string | null
  saving?: boolean
  /** Nu sugerăm date din trecut; serverul le acceptă în continuare. */
  minToday?: boolean
  /**
   * Permite ștergerea termenului („Fără termen”). Fals acolo unde editorul
   * există tocmai ca să completeze un termen care lipsește.
   */
  allowClear?: boolean
  onSave: (value: string) => void
  onCancel: () => void
  size?: 'sm' | 'md'
  label?: string
}

/**
 * Termenul editat pe loc — singurul editor de termen din aplicație, folosit în
 * panoul fazelor, în fișa cererii și în controlul de publicare. Locul câmpului
 * îl ține o plăcuță cu data; alegerea se face din calendarul aplicației
 * (`components/ui/DatePicker`), care plutește dedesubt. O zi aleasă se salvează
 * pe loc (`onSave` cu `YYYY-MM-DD`), „Fără termen” trimite șirul gol, Escape
 * sau un clic în afară renunță.
 */
export default function InlineDateEditor({
  value,
  saving = false,
  minToday = false,
  allowClear = false,
  onSave,
  onCancel,
  size = 'md',
  label = 'Termen limită',
}: InlineDateEditorProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const day = parseDay(value)
  return (
    <span className="inline-flex" onClick={e => e.stopPropagation()}>
      <span
        ref={anchorRef}
        className={`inline-flex items-center gap-1.5 rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-plate text-ink ${
          size === 'sm' ? 'h-6 px-1.5 text-xs' : 'h-8 px-2 text-sm'
        }`}
      >
        <CalendarDays className={size === 'sm' ? 'h-3 w-3 text-ink-faint' : 'h-3.5 w-3.5 text-ink-faint'} aria-hidden="true" />
        {day ? day.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Alege o zi'}
      </span>
      <DatePopover
        anchorRef={anchorRef}
        value={value}
        minToday={minToday}
        allowClear={allowClear && !!value}
        onClear={() => onSave('')}
        saving={saving}
        onSelect={onSave}
        onClose={() => { if (!saving) onCancel() }}
        label={label}
      />
    </span>
  )
}
