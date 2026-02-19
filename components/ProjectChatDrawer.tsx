'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Send, X } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useProjectChat } from '@/hooks/useProjectChat'

type Props = {
  open: boolean
  onClose: () => void
  title?: string
  projectId: string
}

export default function ProjectChatDrawer({
  open,
  onClose,
  title = 'Chat proiect',
  projectId,
}: Props) {
  const { loading: authLoading, userId } = useAuth()

  const {
    messages,
    loading,
    sending,
    error,
    hasMore,
    loadMore,
    sendMessage,
  } = useProjectChat(projectId, { initialLimit: 50 })

  const [text, setText] = useState('')

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const prevScrollHeightRef = useRef<number | null>(null)
  const userPinnedToBottomRef = useRef(true)

  const canSend = !authLoading && !sending && text.trim().length > 0

  const scrollToBottom = (smooth = false) => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' })
  }

  const isNearBottom = () => {
    const el = listRef.current
    if (!el) return true
    const threshold = 80
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }

  // ESC to close
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // lock background scroll
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // autosize textarea
  useEffect(() => {
    if (!open) return
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [text, open])

  // track scroll position (to decide auto-scroll on new messages)
  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (!el) return

    const onScroll = () => {
      userPinnedToBottomRef.current = isNearBottom()
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [open])

  // when drawer opens: scroll bottom after initial render
  useEffect(() => {
    if (!open) return
    // mic delay ca să existe layout
    const t = setTimeout(() => scrollToBottom(false), 0)
    return () => clearTimeout(t)
  }, [open])

  // when messages change:
  // - if user is at bottom -> auto scroll (realtime + send)
  // - if we did loadMore -> preserve scroll position (handled below)
  useEffect(() => {
    if (!open) return

    // dacă tocmai am făcut loadMore, păstrăm poziția
    const prevH = prevScrollHeightRef.current
    if (prevH != null) {
      const el = listRef.current
      if (el) {
        const newH = el.scrollHeight
        const delta = newH - prevH
        el.scrollTop = el.scrollTop + delta
      }
      prevScrollHeightRef.current = null
      return
    }

    // altfel, scroll doar dacă user e la bottom
    if (userPinnedToBottomRef.current) {
      scrollToBottom(false)
    }
  }, [messages.length, open])

  const handleSend = async () => {
    if (!canSend) return
    const body = text.trim()
    setText('')
    await sendMessage(body)
    // pentru “da la toate”: după send, scroll bottom
    setTimeout(() => scrollToBottom(false), 0)
  }

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleLoadMore = async () => {
    const el = listRef.current
    if (el) prevScrollHeightRef.current = el.scrollHeight
    await loadMore()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay (click closes) */}
      <button
        aria-label="Close chat"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />

      {/* Panel */}
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[min(520px,90vw)] bg-white border-l border-slate-200 shadow-2xl flex flex-col rounded-none sm:rounded-l-2xl">
        {/* Header */}
        <div className="border-b border-slate-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 rounded-none sm:rounded-tl-2xl pt-[env(safe-area-inset-top)]">
          <div className="h-14 px-3 flex items-center justify-between">
            <button
              onClick={onClose}
              className="sm:hidden inline-flex items-center gap-2 px-2 py-2 rounded-md hover:bg-slate-100 text-slate-700"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Back</span>
            </button>

            <div className="hidden sm:flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            </div>

            <button
              onClick={onClose}
              className="hidden sm:inline-flex p-2 rounded-md hover:bg-slate-100 text-slate-500"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="sm:hidden px-4 pb-3 -mt-1">
            <div className="text-sm font-semibold text-slate-900">{title}</div>
          </div>
        </div>

        {/* Messages */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {hasMore && (
            <div className="flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className={[
                  'px-3 py-1.5 rounded-xl text-sm border shadow-sm',
                  loading
                    ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
                ].join(' ')}
              >
                {loading ? 'Loading…' : 'Load older messages'}
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!error && loading && messages.length === 0 ? (
            <div className="text-sm text-slate-500">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No messages yet. Say hi 👋
            </div>
          ) : (
            messages.map((m) => {
              const isMe = userId && m.created_by === userId
              return (
                <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[85%]">
                    <div
                      className={[
                        'rounded-2xl px-3 py-2 text-sm border shadow-sm',
                        isMe
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-900 border-slate-200',
                      ].join(' ')}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    </div>
                    <div className={`mt-1 text-[11px] text-slate-400 ${isMe ? 'text-right' : 'text-left'}`}>
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              )
            })
          )}

          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 p-3 bg-white rounded-none sm:rounded-bl-2xl pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onTextareaKeyDown}
                placeholder="Scrie un mesaj… (Enter = trimite, Shift+Enter = rând nou)"
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                rows={1}
              />
            </div>

            <button
              onClick={handleSend}
              disabled={!canSend}
              className={[
                'h-10 px-3 rounded-xl inline-flex items-center gap-2 text-sm font-medium',
                canSend
                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed',
              ].join(' ')}
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending…' : 'Trimite'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
