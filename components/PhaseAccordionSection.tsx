'use client'

import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface PhaseAccordionSectionProps {
  /** Id-ul fazei sau sentinel-ul pentru cereri generale — folosit ca ancoră `phase-${id}`. */
  id: string
  title: string
  subtitle?: string | null
  /** Culoarea punctului din stânga titlului (statusul fazei). Ignorată dacă e furnizat `icon`. */
  color?: string | null
  icon?: ReactNode
  /** Slot opțional în dreapta titlului, înainte de chevron (ex: status + buton publicare). */
  headerRight?: ReactNode
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
  open,
  onOpenChange,
  children,
}: PhaseAccordionSectionProps) {
  return (
    <Collapsible.Root
      id={`phase-${id}`}
      open={open}
      onOpenChange={onOpenChange}
      className="border border-[var(--p-border)]/60 rounded-2xl bg-[var(--p-surface)] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)] overflow-hidden scroll-mt-24"
    >
      <div className="w-full flex items-center gap-3.5 px-5 sm:px-6 py-4 sm:py-5 hover:bg-[var(--p-surface-2)] transition-colors">
        <Collapsible.Trigger asChild>
          <button className="flex-1 min-w-0 flex items-center gap-3.5 text-left">
            {icon ?? (
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: color || '#6B7280' }}
              />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-semibold text-[var(--p-ink)] truncate tracking-tight">{title}</h2>
              {subtitle && <p className="text-xs text-[var(--p-ink-soft)] truncate">{subtitle}</p>}
            </div>
          </button>
        </Collapsible.Trigger>
        {headerRight}
        <Collapsible.Trigger asChild>
          <button aria-label={open ? 'Restrânge' : 'Extinde'} className="flex-shrink-0 p-0.5">
            <ChevronRight
              className={`w-4 h-4 text-[var(--p-ink-faint)] transition-transform duration-200 ${
                open ? 'rotate-90' : ''
              }`}
            />
          </button>
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content>
        <div className="border-t border-[var(--p-border)]/60 p-5 sm:p-6 space-y-4">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
