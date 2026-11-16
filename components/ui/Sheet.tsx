'use client'

import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'

/**
 * Foaie care urcă de jos, pentru telefon: acțiuni scurte despre un singur
 * lucru (un document, un rând). Peste Radix Dialog, deci focusul, Escape,
 * clicul pe fundal și blocarea derulării vin gata făcute.
 *
 *   <Sheet open={open} onOpenChange={setOpen}>
 *     <SheetTrigger asChild><IconButton label="…">…</IconButton></SheetTrigger>
 *     <SheetContent>
 *       <SheetHeader title="…" description="…" />
 *       <SheetBody>…</SheetBody>
 *     </SheetContent>
 *   </Sheet>
 */
export const Sheet = Dialog.Root
export const SheetTrigger = Dialog.Trigger
export const SheetClose = Dialog.Close

export function SheetContent({
  children,
  className = '',
  ...rest
}: ComponentPropsWithoutRef<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-fade-in fixed inset-0 z-[1000000]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
      <Dialog.Content
        {...rest}
        className={`sheet-slide-up fixed inset-x-0 bottom-0 z-[1000001] flex max-h-[85dvh] flex-col rounded-t-[var(--radius-plate-lg)] border border-b-0 border-rule bg-plate pb-[max(1rem,env(safe-area-inset-bottom))] focus:outline-none ${className}`}
        style={{ boxShadow: 'var(--sg-lift)' }}
      >
        {/* Mânerul arată că e o foaie peste pagină; se închide din X sau atingând fundalul. */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-rule-strong" aria-hidden="true" />
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  )
}

export function SheetHeader({
  title,
  description,
}: {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-rule px-5 pb-3 pt-2">
      <div className="min-w-0 pt-2">
        <Dialog.Title className="text-lg font-bold text-ink">{title}</Dialog.Title>
        {description
          ? <Dialog.Description asChild><div className="mt-1 text-sm text-ink-soft">{description}</div></Dialog.Description>
          : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
      </div>
      <Dialog.Close asChild>
        <IconButton label="Închide" className="shrink-0"><X className="h-4 w-4" aria-hidden="true" /></IconButton>
      </Dialog.Close>
    </div>
  )
}

export function SheetBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-5 ${className}`}>{children}</div>
}
