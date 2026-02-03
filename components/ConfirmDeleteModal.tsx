'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmDeleteModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  description?: string
  confirmText?: string
  confirmWord?: string
  loading?: boolean
}

export default function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirmare ștergere',
  description = 'Această acțiune este permanentă și nu poate fi anulată.',
  confirmText = 'Șterge',
  confirmWord = 'sterge',
  loading = false
}: ConfirmDeleteModalProps) {
  const [mounted, setMounted] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const isConfirmEnabled = useMemo(() => {
    return inputValue.trim().toLowerCase() === confirmWord.trim().toLowerCase()
  }, [inputValue, confirmWord])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    // lock scroll while modal is open
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // reset input on open
    setInputValue('')

    return () => {
      document.body.style.overflow = prevOverflow || 'unset'
    }
  }, [isOpen])

  const handleConfirm = () => {
    if (!isConfirmEnabled || loading) return
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
      onClose()
    }
  }

  if (!mounted || !isOpen) return null

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
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Close button ALWAYS top-right */}
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          aria-label="Închide"
          className="absolute top-3 right-3 z-[60] p-2 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-start gap-4">
            {/* Warning Icon */}
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>

            {/* Title & Description */}
            <div className="flex-1 min-w-0 pr-10">
              <h2 className="text-lg font-bold text-slate-900">{title}</h2>
              <p className="text-sm text-slate-500 mt-1">{description}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Pentru a confirma, scrie{' '}
              <span className="font-bold text-red-600">{confirmWord}</span> mai jos:
            </label>

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={confirmWord}
              autoFocus
              disabled={loading}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-red-500 focus:ring-4 focus:ring-red-500/10 outline-none transition-all bg-slate-50 focus:bg-white disabled:opacity-60"
            />
          </div>

          {/* Feedback */}
          {inputValue.length > 0 && !isConfirmEnabled && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Textul introdus nu corespunde
            </p>
          )}

          {isConfirmEnabled && (
            <p className="text-xs text-emerald-600 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Poți confirma ștergerea
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Se șterge...
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
