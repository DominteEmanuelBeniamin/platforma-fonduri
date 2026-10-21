'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { FeedbackMessage, type FeedbackVariant } from '@/components/FeedbackMessage'

type Toast = { id: number; message: string; variant: FeedbackVariant }
type ConfirmOptions = { title: string; description: string; confirmText?: string }
type ConfirmState = ConfirmOptions & { resolve: (confirmed: boolean) => void }
type ToastContext = {
  showToast: (message: string, variant?: FeedbackVariant) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const Ctx = createContext<ToastContext | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmation, setConfirmation] = useState<ConfirmState | null>(null)
  const nextId = useRef(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const readyTimer = window.setTimeout(() => setMounted(true), 0)
    const activeTimers = timers.current
    return () => {
      window.clearTimeout(readyTimer)
      activeTimers.forEach(window.clearTimeout)
    }
  }, [])

  const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), [])
  const showToast = useCallback((message: string, variant: FeedbackVariant = 'info') => {
    const id = nextId.current++
    setToasts(current => [...current.slice(-2), { id, message, variant }])
    timers.current.push(window.setTimeout(() => dismiss(id), 5000))
  }, [dismiss])
  // Ce era focalizat când s-a cerut confirmarea: acolo se întoarce focusul.
  // Radix îl duce doar pe un `Dialog.Trigger`, iar confirmarea n-are unul.
  const returnFocus = useRef<HTMLElement | null>(null)
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirmation({ ...options, resolve })
  }), [])
  const closeConfirmation = useCallback((confirmed: boolean) => {
    if (!confirmation) return
    confirmation.resolve(confirmed)
    setConfirmation(null)
  }, [confirmation])

  return (
    <Ctx.Provider value={{ showToast, confirm }}>
      {children}
      {mounted && createPortal(
        <>
          <div className="pointer-events-none fixed bottom-4 right-4 z-[1000001] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
            {toasts.map(toast => (
              <div key={toast.id} className="pointer-events-auto">
                <FeedbackMessage variant={toast.variant} onDismiss={() => dismiss(toast.id)}>{toast.message}</FeedbackMessage>
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
      {/* Confirmarea e un dialog Radix, nu un strat desenat de mână: poate fi
          cerută și din alt dialog Radix (încărcarea clientului), iar Radix ține
          o stivă comună — Escape și clicurile ajung doar la dialogul de sus,
          focusul intră în el și se întoarce de unde a plecat. */}
      <Dialog.Root open={!!confirmation} onOpenChange={open => { if (!open) closeConfirmation(false) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[1000001]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
          <Dialog.Content
            onCloseAutoFocus={event => {
              event.preventDefault()
              if (returnFocus.current?.isConnected) returnFocus.current.focus()
              returnFocus.current = null
            }}
            className="fixed left-1/2 top-1/2 z-[1000001] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-plate-lg)] border border-rule bg-plate p-6 focus:outline-none"
            style={{ boxShadow: 'var(--sg-lift)' }}
          >
            {confirmation && (
              <>
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]"><AlertTriangle className="h-6 w-6" aria-hidden="true" /></div>
                  <div>
                    <Dialog.Title className="text-lg font-bold text-ink">{confirmation.title}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-ink-soft">{confirmation.description}</Dialog.Description>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={() => closeConfirmation(false)} className="min-h-11 rounded-[var(--radius-plate)] border border-rule px-4 text-sm font-semibold text-ink hover:bg-paper-sunk pointer-fine:min-h-9">Anulează</button>
                  <button type="button" onClick={() => closeConfirmation(true)} className="min-h-11 rounded-[var(--radius-plate)] bg-[var(--sg-warn)] px-4 text-sm font-bold text-white hover:brightness-90 pointer-fine:min-h-9">{confirmation.confirmText || 'Confirmă'}</button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  )
}

export function useToast() {
  const value = useContext(Ctx)
  if (!value) throw new Error('useToast must be used within ToastProvider')
  return value
}
