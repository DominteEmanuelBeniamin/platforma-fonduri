'use client'

import * as Collapsible from '@radix-ui/react-collapsible'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import InlineInput from '@/components/InlineInput'

interface PhaseAccordionSectionProps {
  /** Id-ul fazei sau sentinel-ul pentru cereri generale — folosit ca ancoră `phase-${id}`. */
  id: string
  title: string
  subtitle?: string | null
  /** Culoarea bulinei de vizibilitate. Lipsă = fără bulină. Ignorată dacă e furnizat `icon`. */
  color?: string | null
  icon?: ReactNode
  /** Slot opțional în dreapta titlului, înainte de chevron (ex: status + buton publicare). */
  headerRight?: ReactNode
  /** Acțiunile secundare ale rândului (meniul „⋯”), la capătul din dreapta. */
  actions?: ReactNode
  /** Titlul devine câmp editabil, pentru redenumire pe loc. */
  renaming?: boolean
  renameLoading?: boolean
  onRenameSubmit?: (name: string) => void
  onRenameCancel?: () => void
  open: boolean
  onOpenChange: () => void
  children: ReactNode
}

export default function PhaseAccordionSection({
  id,
  title,
  subtitle,
  color,
  icon,
  headerRight,
  actions,
  renaming,
  renameLoading,
  onRenameSubmit,
  onRenameCancel,
  open,
  onOpenChange,
  children,
}: PhaseAccordionSectionProps) {
  return (
    <Collapsible.Root
      id={`phase-${id}`}
      open={open}
      className="border border-[var(--p-border)]/60 rounded-2xl bg-[var(--p-surface)] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)] overflow-hidden scroll-mt-24"
    >
      <div className="w-full grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3.5 gap-y-2 px-5 sm:px-6 py-4 sm:py-5">
        <div className="min-w-0 flex items-start gap-3.5 text-left">
          {/* Fără `color` nu se desenează nimic: bulina spune dacă faza e
              publicată, iar clientul vede oricum numai faze publicate. */}
          {icon ?? (color ? (
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
          ) : null)}
          <div className="min-w-0 flex-1">
            {renaming && onRenameSubmit && onRenameCancel ? (
              <InlineInput
                size="md"
                initialValue={title}
                placeholder="Nume fază..."
                loading={!!renameLoading}
                onConfirm={onRenameSubmit}
                onCancel={onRenameCancel}
              />
            ) : (
              <h2 className="font-display text-lg font-semibold text-[var(--p-ink)] break-words tracking-tight">{title}</h2>
            )}
            {subtitle && <p className="text-xs text-[var(--p-ink-soft)] break-words">{subtitle}</p>}
          </div>
        </div>
        <div className="sm:col-start-3 sm:row-start-1 flex items-center gap-1 flex-shrink-0">
          {actions}
          <button type="button" onClick={onOpenChange} aria-label="Închide faza" className="p-0.5 rounded text-[var(--p-ink-faint)] hover:text-[var(--p-ink)] hover:bg-[var(--p-surface)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        {headerRight && <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:self-center">{headerRight}</div>}
      </div>
      <Collapsible.Content>
        <div className="border-t border-[var(--p-border)]/60 p-5 sm:p-6 space-y-4">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
