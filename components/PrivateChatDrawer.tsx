'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, X } from 'lucide-react'
import PrivateChatView from '@/components/PrivateChatView'

type Props = {
  open: boolean
  onClose: () => void
  title?: string
  conversationId: string
}

export default function PrivateChatDrawer({
  open,
  onClose,
  title = 'Conversație',
  conversationId,
}: Props) {
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setIsMounted(true), 0)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return

    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || !isMounted) return null

  const drawerContent = (
    <div className="fixed inset-0 z-[999999]">
      <button
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-900/20 backdrop-blur-sm"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl animate-in slide-in-from-right duration-300 sm:w-[min(520px,90vw)] sm:rounded-l-2xl">
        <div className="absolute right-4 top-4 z-20 hidden sm:block">
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="absolute left-4 top-4 z-20 sm:hidden">
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-600 hover:bg-slate-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>

        <PrivateChatView
          conversationId={conversationId}
          title={title}
          className="h-full"
        />
      </aside>
    </div>
  )

  return createPortal(drawerContent, document.body)
}
