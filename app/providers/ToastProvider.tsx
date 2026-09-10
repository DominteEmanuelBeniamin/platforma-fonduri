'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => setConfirmation({ ...options, resolve })), [])
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
          {confirmation && (
            <div className="fixed inset-0 z-[1000001] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
              <button type="button" className="absolute inset-0 cursor-default " style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} aria-label="Anulează" onClick={() => closeConfirmation(false)} />
              <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]"><AlertTriangle className="h-6 w-6" /></div>
                  <div><h2 id="confirm-dialog-title" className="text-lg font-bold text-ink">{confirmation.title}</h2><p className="mt-1 text-sm text-ink-soft">{confirmation.description}</p></div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={() => closeConfirmation(false)} className="rounded-xl border border-rule px-4 py-2 text-sm font-semibold text-ink hover:bg-paper-sunk">Anulează</button>
                  <button type="button" onClick={() => closeConfirmation(true)} className="rounded-xl bg-[var(--sg-warn)] px-4 py-2 text-sm font-bold text-white hover:brightness-90">{confirmation.confirmText || 'Confirmă'}</button>
                </div>
              </div>
            </div>
          )}
        </>,
        document.body,
      )}
    </Ctx.Provider>
  )
}

export function useToast() {
  const value = useContext(Ctx)
  if (!value) throw new Error('useToast must be used within ToastProvider')
  return value
}
