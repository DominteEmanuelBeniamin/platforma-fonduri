'use client'

import * as Collapsible from '@radix-ui/react-collapsible'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import InlineInput from '@/components/InlineInput'
import { bandVar } from '@/lib/signage'

interface PhaseAccordionSectionProps {
  /** Id-ul fazei sau sentinel-ul pentru cereri generale — folosit ca ancoră `phase-${id}`. */
  id: string
  title: string
  subtitle?: string | null
  /** Banda fazei, 1–6. Poartă identitatea aripii, aceeași ca în panou. */
  band?: number
  /** Faza nepublicată se desenează ca plăcuță nemontată: contur întrerupt. */
  draft?: boolean
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
  band,
  draft,
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
      className={`relative scroll-mt-24 overflow-hidden rounded-[var(--radius-plate)] bg-plate ${
        draft ? 'border border-dashed border-rule-strong' : 'border border-rule'
      }`}
    >
      {/* Banda aripii, aceeași culoare ca în panou. Faza se recunoaște după ea
          înainte să-i citești numele — de-aia nu mai e nevoie de bulină. */}
      {band && !draft && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[var(--sg-rail)]"
          style={{ background: bandVar(band) }}
        />
      )}
      <div className="w-full grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3.5 gap-y-2 px-5 sm:px-6 pb-4 pt-5 sm:pb-5 sm:pt-6">
        <div className="min-w-0 flex items-start gap-3.5 text-left">
          {icon}
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
              <h2 className="break-words text-lg font-bold tracking-tight text-ink">{title}</h2>
            )}
            {subtitle && <p className="mt-0.5 break-words text-sm text-ink-soft">{subtitle}</p>}
          </div>
        </div>
        <div className="sm:col-start-3 sm:row-start-1 flex items-center gap-1 flex-shrink-0">
          {actions}
          <button type="button" onClick={onOpenChange} aria-label="Închide faza" className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink sm:h-9 sm:w-9">
            <X className="h-4 w-4" />
          </button>
        </div>
        {headerRight && <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:self-center">{headerRight}</div>}
      </div>
      <Collapsible.Content>
        <div className="space-y-4 border-t border-rule p-5 sm:p-6">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
