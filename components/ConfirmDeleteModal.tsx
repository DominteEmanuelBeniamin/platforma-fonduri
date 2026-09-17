'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { Spinner } from '@/components/ui/Spinner'

interface ConfirmDeleteModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  description?: string
  confirmText?: string
  confirmWord?: string
  confirmReadyText?: string
  loadingText?: string
  loading?: boolean
  error?: string | null
  children?: React.ReactNode
}

export default function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirmare ștergere',
  description = 'Această acțiune este permanentă și nu poate fi anulată.',
  confirmText = 'Șterge',
  confirmWord = 'sterge',
  confirmReadyText = 'Poți confirma ștergerea',
  loadingText = 'Se șterge...',
  loading = false,
  error = null,
  children
}: ConfirmDeleteModalProps) {
  const [inputValue, setInputValue] = useState('')

  const isConfirmEnabled = useMemo(() => {
    return inputValue.trim().toLowerCase() === confirmWord.trim().toLowerCase()
  }, [inputValue, confirmWord])

  useEffect(() => {
    if (!isOpen) return

    // lock scroll while modal is open
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = prevOverflow || 'unset'
    }
  }, [isOpen])

  const handleClose = () => {
    setInputValue('')
    onClose()
  }

  const handleConfirm = () => {
    if (!isConfirmEnabled || loading) return
    setInputValue('')
    onConfirm()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    }
  }

  if (!isOpen || typeof document === 'undefined') return null

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 999999,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)'
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Close button ALWAYS top-right */}
        <button
          type="button"
          onClick={handleClose}
          disabled={loading}
          aria-label="Închide"
          className="absolute top-3 right-3 z-[60] p-2 text-ink-faint hover:text-ink-soft transition-colors rounded-lg hover:bg-paper-sunk disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="px-6 py-5 border-b border-rule">
          <div className="flex items-start gap-4">
            {/* Warning Icon */}
            <div className="w-12 h-12 rounded-full bg-[var(--sg-danger-soft)] flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-[var(--sg-danger)]" />
            </div>

            {/* Title & Description */}
            <div className="flex-1 min-w-0 pr-10">
              <h2 className="text-lg font-bold text-ink">{title}</h2>
              <p className="text-sm text-ink-soft mt-1">{description}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {children}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Pentru a confirma, scrie{' '}
              <span className="font-bold text-[var(--sg-danger)]">{confirmWord}</span> mai jos:
            </label>

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={confirmWord}
              autoFocus
              disabled={loading}
              className="w-full px-4 py-3 rounded-xl border border-rule text-sm focus:border-[var(--sg-danger)] focus:ring-4 focus:ring-[var(--sg-danger)] outline-none transition-all bg-paper-sunk focus:bg-white disabled:opacity-60"
            />
          </div>

          {error && <FeedbackMessage variant="error">{error}</FeedbackMessage>}

          {/* Feedback */}
          {inputValue.length > 0 && !isConfirmEnabled && (
            <p className="text-xs text-[var(--sg-warn)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--sg-warn)]" />
              Textul introdus nu corespunde
            </p>
          )}

          {isConfirmEnabled && (
            <p className="text-xs text-[var(--sg-ok)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--sg-ok)]" />
              {confirmReadyText}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-rule bg-paper-sunk flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-rule text-ink hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anulează
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isConfirmEnabled || loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              backgroundColor: isConfirmEnabled ? '#dc2626' : '#fca5a5'
            }}
          >
            {loading ? (
              <>
                <Spinner size="sm" on="accent" />
                {loadingText}
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
