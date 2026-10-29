'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/Button'

/**
 * Numele unei faze sau activități din șablon se schimbă aici, nu pe loc
 * (D9, S-27): pe loc intrai în editare din greșeală. Textul trăiește în dialog,
 * deci tastarea nu re-randează editorul.
 *
 * Escape și clicul pe fundal închid fără schimbări; Enter salvează; un nume
 * gol nu se poate salva.
 */
export function NameDialog({
  title,
  label,
  initialValue,
  confirmText,
  onConfirm,
  onClose,
}: {
  title: string
  label: string
  initialValue: string
  confirmText: string
  onConfirm: (name: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  // Unde se întoarce focusul: „⋯”-ul din care s-a deschis dialogul. Radix îl
  // duce doar pe un `Dialog.Trigger`, iar aici nu există unul.
  const [opener] = useState(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const trimmed = value.trim()
  const submit = () => { if (trimmed) onConfirm(trimmed) }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999999]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (opener?.isConnected) opener.focus()
          }}
          className="fixed left-1/2 top-1/2 z-[999999] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-plate-lg)] border border-rule bg-plate p-5 focus:outline-none"
          style={{ boxShadow: 'var(--sg-lift)' }}
        >
          <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
          <form
            className="mt-4"
            onSubmit={event => { event.preventDefault(); submit() }}
          >
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
              <input
                autoFocus
                value={value}
                onChange={event => setValue(event.target.value)}
                onFocus={event => event.currentTarget.select()}
                className="h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-10"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="quiet" onClick={onClose} data-tooltip="Închide fără să schimbi numele">Anulează</Button>
              <Button type="submit" variant="primary" disabled={!trimmed} data-tooltip={trimmed ? 'Păstrează numele' : 'Scrie un nume'}>{confirmText}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
