/* eslint-disable react-hooks/set-state-in-effect */
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Send,
  Pencil,
  Trash2,
  MoreHorizontal,
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { usePrivateChat } from '@/hooks/usePrivateChat'
import { getAvatarColor, getInitials } from '@/lib/avatar'

type Props = {
  conversationId: string
  title?: string,
  subtitle?: string | null
  onBack?: () => void
  showBackButton?: boolean
  className?: string
  initialLastReadAt?: string | null
  otherLastReadAt?: string | null
  onMarkedAsRead?: (lastReadAt: string | null) => void
}

export default function PrivateChatView({
  conversationId,
  title = 'Conversație',
  subtitle = null,
  onBack,
  showBackButton = false,
  className = '',
  initialLastReadAt = null,
  otherLastReadAt = null,
  onMarkedAsRead,
}: Props) {
  const { loading: authLoading, userId } = useAuth()

  const [text, setText] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [initialReadBoundary, setInitialReadBoundary] = useState<string | null>(initialLastReadAt)
  const [initialOtherReadBoundary, setInitialOtherReadBoundary] = useState<string | null>(
    otherLastReadAt
  )

  const {
    messages,
    loading,
    sending,
    error,
    hasMore,
    loadMore,
    sendMessage,
    editMessage,
    deleteMessage,
    markAsRead,
    lastReadAt,
    otherLastReadAt: liveOtherLastReadAt,
  } = usePrivateChat(conversationId, {
    initialLimit: 50,
    initialLastReadAt: initialReadBoundary,
    initialOtherLastReadAt: initialOtherReadBoundary,
  })

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const prevScrollHeightRef = useRef<number | null>(null)
  const markReadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userPinnedToBottomRef = useRef(true)
  const previousConversationIdRef = useRef(conversationId)

  const canSend = !authLoading && !sending && text.trim().length > 0

  const latestUnreadIncomingCreatedAt = useMemo(() => {
    if (!userId) return null

    const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : null
    let latestCreatedAt: string | null = null

    for (const m of messages) {
      if (m.deleted_at) continue
      if (m.created_by === userId) continue

      const createdTime = new Date(m.created_at).getTime()
      if (lastReadTime !== null && createdTime <= lastReadTime) continue

      if (!latestCreatedAt || createdTime > new Date(latestCreatedAt).getTime()) {
        latestCreatedAt = m.created_at
      }
    }

    return latestCreatedAt
  }, [lastReadAt, messages, userId])

  const firstUnreadMessageId = useMemo(() => {
    if (!userId) return null

    const boundary = initialReadBoundary
    const boundaryTime = boundary ? new Date(boundary).getTime() : null

    return (
      messages.find((m) => {
        if (m.deleted_at) return false
        if (m.created_by === userId) return false
        if (boundaryTime === null) return true
        return new Date(m.created_at).getTime() > boundaryTime
      })?.id ?? null
    )
  }, [initialReadBoundary, messages, userId])

  const effectiveOtherLastReadAt = useMemo(() => {
    if (!liveOtherLastReadAt) return otherLastReadAt
    if (!otherLastReadAt) return liveOtherLastReadAt

    return new Date(liveOtherLastReadAt).getTime() >= new Date(otherLastReadAt).getTime()
      ? liveOtherLastReadAt
      : otherLastReadAt
  }, [liveOtherLastReadAt, otherLastReadAt])

  const readOutgoingMessageId = useMemo(() => {
    if (!userId || !effectiveOtherLastReadAt) return null

    const otherReadTime = new Date(effectiveOtherLastReadAt).getTime()
    let readMessageId: string | null = null

    for (const m of messages) {
      if (m.deleted_at) continue
      if (m.created_by !== userId) continue
      if (new Date(m.created_at).getTime() <= otherReadTime) {
        readMessageId = m.id
      }
    }

    return readMessageId
  }, [effectiveOtherLastReadAt, messages, userId])

  const startEdit = (id: string, currentBody?: string | null) => {
    if (!currentBody) return
    setEditingId(id)
    setEditText(currentBody)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const saveEdit = async (id: string) => {
    await editMessage(id, editText)
    cancelEdit()
  }

  const scrollToBottom = (smooth = false) => {
    bottomRef.current?.scrollIntoView({
      block: 'end',
      behavior: smooth ? 'smooth' : 'auto',
    })
  }

  const isNearBottom = () => {
    const el = listRef.current
    if (!el) return true
    const threshold = 80
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }

  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) return
    previousConversationIdRef.current = conversationId
    setInitialReadBoundary(initialLastReadAt)
    setInitialOtherReadBoundary(otherLastReadAt)
  }, [conversationId, initialLastReadAt, otherLastReadAt])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null)
        if (editingId) cancelEdit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [text])

  useEffect(() => {
    const el = listRef.current
    if (!el) return

    const onScroll = () => {
      userPinnedToBottomRef.current = isNearBottom()
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => scrollToBottom(false), 50)

    return () => clearTimeout(t)
  }, [conversationId])

  useEffect(() => {
    const prevH = prevScrollHeightRef.current

    if (prevH != null) {
      const el = listRef.current
      if (el) {
        const newH = el.scrollHeight
        el.scrollTop += newH - prevH
      }
      prevScrollHeightRef.current = null
      return
    }

    if (userPinnedToBottomRef.current) {
      scrollToBottom(false)
    }

    if (markReadTimeoutRef.current) {
      clearTimeout(markReadTimeoutRef.current)
      markReadTimeoutRef.current = null
    }

    if (latestUnreadIncomingCreatedAt) {
      markReadTimeoutRef.current = setTimeout(() => {
        markReadTimeoutRef.current = null
        void markAsRead(latestUnreadIncomingCreatedAt)
      }, 120)
    }
  }, [latestUnreadIncomingCreatedAt, messages.length, markAsRead])

  useEffect(() => {
    return () => {
      if (markReadTimeoutRef.current) {
        clearTimeout(markReadTimeoutRef.current)
        markReadTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    onMarkedAsRead?.(lastReadAt)
  }, [lastReadAt, onMarkedAsRead])

  const handleSend = async () => {
    if (!canSend) return
    const body = text.trim()
    setText('')
    await sendMessage(body)
    setTimeout(() => scrollToBottom(false), 0)
  }

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const GROUP_GAP_MS = 2 * 60 * 1000

  const toMs = (iso: string) => new Date(iso).getTime()

  const isSameDay = (aIso: string, bIso: string) => {
    const a = new Date(aIso)
    const b = new Date(bIso)
    return a.toDateString() === b.toDateString()
  }

  const formatDayLabel = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()

    if (isSameDay(iso, now.toISOString())) return 'Astăzi'

    now.setDate(now.getDate() - 1)
    if (isSameDay(iso, now.toISOString())) return 'Ieri'

    return d.toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })


  return (
    <section className={`flex h-full min-h-0 flex-col bg-white ${className}`}>
      <div className="z-10 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            {showBackButton && (
              <button
                onClick={onBack}
                className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 md:hidden"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}

            <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-slate-900">{title}</h3>
                {subtitle && (
                    <p className="truncate text-xs text-slate-500">{subtitle}</p>
                )}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        onClick={() => setOpenMenuId(null)}
        className="flex-1 overflow-y-auto bg-slate-50/50 p-4"
      >
        {hasMore && (
          <div className="flex justify-center pb-4 pt-2">
            <button
              onClick={() => {
                prevScrollHeightRef.current = listRef.current?.scrollHeight || null
                void loadMore()
              }}
              disabled={loading}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
            >
              {loading ? 'Se încarcă...' : 'Afișează mesaje mai vechi'}
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        {messages.map((m, idx) => {
          const prev = idx > 0 ? messages[idx - 1] : null
          const next = idx < messages.length - 1 ? messages[idx + 1] : null
          const isMe = !!userId && m.created_by === userId
          const isEditing = editingId === m.id
          const showNewMessagesSeparator = firstUnreadMessageId === m.id
          const showReadReceipt = readOutgoingMessageId === m.id
            
          const prevSameDay = prev ? isSameDay(prev.created_at, m.created_at) : false
          const nextSameDay = next ? isSameDay(m.created_at, next.created_at) : false

          const isSameGroupAsPrev =
            !!prev &&
            prev.created_by === m.created_by &&
            toMs(m.created_at) - toMs(prev.created_at) <= GROUP_GAP_MS &&
            prevSameDay

          const isSameGroupAsNext =
            !!next &&
            next.created_by === m.created_by &&
            toMs(next.created_at) - toMs(m.created_at) <= GROUP_GAP_MS &&
            nextSameDay

          const showDaySeparator = !prev || !prevSameDay
          const shouldShowHeader = !isMe && !isSameGroupAsPrev

          const marginTopClass = showDaySeparator
            ? 'mt-6'
            : isSameGroupAsPrev
            ? 'mt-1'
            : 'mt-4'

          const color = getAvatarColor(
            m.profiles?.full_name || m.profiles?.email || m.created_by
          )
          const initials = getInitials(m.profiles?.full_name, m.profiles?.email)

          const isEdited = !!m.edited_at && m.edited_at !== m.created_at && !m.deleted_at
          const shouldShowMeta = !isSameGroupAsNext || isEdited || showReadReceipt

          let bubbleRadius = 'rounded-2xl'
          if (isMe) {
            if (!isSameGroupAsPrev && isSameGroupAsNext) {
              bubbleRadius = 'rounded-2xl rounded-br-sm'
            } else if (isSameGroupAsPrev && isSameGroupAsNext) {
              bubbleRadius = 'rounded-l-2xl rounded-r-sm'
            } else if (isSameGroupAsPrev && !isSameGroupAsNext) {
              bubbleRadius = 'rounded-2xl rounded-tr-sm'
            }
          } else {
            if (!isSameGroupAsPrev && isSameGroupAsNext) {
              bubbleRadius = 'rounded-2xl rounded-bl-sm'
            } else if (isSameGroupAsPrev && isSameGroupAsNext) {
              bubbleRadius = 'rounded-r-2xl rounded-l-sm'
            } else if (isSameGroupAsPrev && !isSameGroupAsNext) {
              bubbleRadius = 'rounded-2xl rounded-tl-sm'
            }
          }

          return (
            <div key={m.id} className="group/row">
              {showDaySeparator && (
                <div className="my-6 flex justify-center">
                  <span className="rounded-full bg-slate-100/80 px-3 py-1 text-[11px] font-semibold uppercase text-slate-400">
                    {formatDayLabel(m.created_at)}
                  </span>
                </div>
              )}

              {showNewMessagesSeparator && (
                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-emerald-200" />
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase text-emerald-700 ring-1 ring-emerald-100">
                    Mesaje noi
                  </span>
                  <div className="h-px flex-1 bg-emerald-200" />
                </div>
              )}

              <div
                className={`flex w-full flex-col ${
                  isMe ? 'items-end' : 'items-start'
                } ${marginTopClass}`}
              >
                {!isMe && shouldShowHeader && (
                  <span className="mb-1 ml-10 text-[11px] font-medium text-slate-500">
                    {m.profiles?.full_name || m.profiles?.email || 'Necunoscut'}
                  </span>
                )}

                <div
                  className={`flex max-w-[85%] items-end sm:max-w-[75%] ${
                    isMe ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  {!isMe && (
                    <div className="mr-2 flex w-8 flex-shrink-0 justify-center">
                      {!isSameGroupAsNext ? (
                        <div
                          className="mb-[2px] flex h-8 w-8 animate-in items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm fade-in zoom-in-50 duration-200"
                          style={{
                            background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
                          }}
                        >
                          {initials}
                        </div>
                      ) : (
                        <div className="w-8" />
                      )}
                    </div>
                  )}

                    <div
                        className={`relative group/bubble flex items-center gap-2 ${
                            isMe ? 'flex-row-reverse' : 'flex-row'
                        }`}
                    >
                    {isEditing ? (
                      <div className="min-w-[280px] w-full overflow-hidden rounded-2xl border-2 border-slate-900 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-200">
                        <textarea
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="min-h-[100px] w-full resize-none bg-transparent px-4 py-3 text-[14px] text-slate-800 focus:outline-none"
                        />
                        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 p-2">
                          <button
                            onClick={cancelEdit}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-200"
                          >
                            Anulează
                          </button>
                          <button
                            onClick={() => void saveEdit(m.id)}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-md hover:bg-slate-800"
                          >
                            Salvează
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          onContextMenu={(e) => {
                            if (window.innerWidth < 640) {
                              e.preventDefault()
                              setOpenMenuId(m.id)
                            }
                          }}
                          className={`relative px-4 py-2.5 text-[14px] leading-relaxed shadow-sm transition-all ${
                            isMe
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-100 bg-white text-slate-800'
                          } ${bubbleRadius}`}
                        >
                          <div className="whitespace-pre-wrap break-words">
                            {m.deleted_at ? (
                              <span className="text-sm italic text-slate-400/80">
                                Acest mesaj a fost șters.
                              </span>
                            ) : (
                              m.body
                            )}
                          </div>
                        </div>

                        {!m.deleted_at && isMe && (
                        <div
                            className={`relative flex-shrink-0 transition-opacity ${
                                openMenuId === m.id
                                ? 'opacity-100'
                                : 'opacity-0 group-hover/bubble:opacity-100'
                            }`}
                        >
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenMenuId(openMenuId === m.id ? null : m.id)
                              }}
                              className={`rounded-full p-1.5 transition-colors ${
                                openMenuId === m.id
                                  ? 'bg-slate-200 text-slate-800'
                                  : 'text-slate-400 hover:bg-slate-200/50 hover:text-slate-700'
                              }`}
                            >
                              <MoreHorizontal className="h-[18px] w-[18px]" />
                            </button>

                            {openMenuId === m.id && (
                              <div
                                className="absolute bottom-full right-0 z-50 mb-2 min-w-[140px] rounded-xl border border-slate-100 bg-white p-1.5 shadow-xl"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                  onClick={() => {
                                    setOpenMenuId(null)
                                    startEdit(m.id, m.body)
                                  }}
                                >
                                  <Pencil className="h-4 w-4 text-slate-400" />
                                  Editează
                                </button>

                                <button
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
                                  onClick={async () => {
                                    setOpenMenuId(null)
                                    if (confirm('Ești sigur că vrei să ștergi acest mesaj?')) {
                                      await deleteMessage(m.id)
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 text-rose-500" />
                                  Șterge
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {shouldShowMeta && (
                    <div
                        className={`mt-1 flex items-center gap-1.5 text-[10px] font-medium text-slate-400 ${
                        isMe ? 'mr-1 justify-end' : 'ml-10 justify-start'
                        }`}
                    >
                        <span>{formatTime(m.created_at)}</span>

                        {isEdited && (
                        <span className="flex items-center gap-0.5 opacity-70">
                            <span className="h-0.5 w-0.5 rounded-full bg-slate-400" />
                            Editat
                        </span>
                        )}

                        {showReadReceipt && (
                        <span className="flex items-center gap-0.5 opacity-70">
                            <span className="h-0.5 w-0.5 rounded-full bg-slate-400" />
                            Citit
                        </span>
                        )}
                    </div>
                )}
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} className="h-2" />
      </div>

      <div className="z-10 border-t border-slate-100 bg-white p-3 sm:p-4">
        <div className="flex items-end gap-2 rounded-[20px] border border-slate-200 bg-slate-50 p-1.5 shadow-sm transition-all focus-within:border-slate-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-900/10">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder="Scrie un mesaj..."
            className="max-h-[120px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            rows={1}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!canSend}
            className={`mb-0.5 mr-0.5 flex h-[38px] flex-shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-all ${
              canSend
                ? 'bg-slate-900 text-white shadow-md hover:scale-[1.02] hover:bg-slate-800 active:scale-95'
                : 'cursor-not-allowed bg-transparent text-slate-300'
            }`}
          >
            {sending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Send className="h-[18px] w-[18px]" />
            )}
            <span className="hidden sm:inline-block">Trimite</span>
          </button>
        </div>
      </div>
    </section>
  )
}
