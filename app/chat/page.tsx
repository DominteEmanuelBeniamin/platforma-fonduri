'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import { usePrivateConversations } from '@/hooks/usePrivateConversations'
import { usePrivateChatUsers } from '@/hooks/usePrivateChatUsers'
import PrivateChatView from '@/components/PrivateChatView'
import { getAvatarColor, getInitials } from '@/lib/avatar'

function formatConversationTime(iso: string | null) {
  if (!iso) return ''

  const d = new Date(iso)
  const now = new Date()

  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
  })
}

function ChatPageContent() {
  const { loading: authLoading, profile } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const conversationParam = searchParams.get('conversation')

  const {
    items,
    loading,
    creating,
    error,
    selectedConversationId,
    selectedConversation,
    openConversation,
    clearSelection,
    openOrCreateConversation,
    getIsUnread,
    markConversationReadLocally,
  } = usePrivateConversations()

  const [searchTerm, setSearchTerm] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)

  const {
    items: userSearchItems,
    loading: userSearchLoading,
    error: userSearchError,
    search: searchUsers,
  } = usePrivateChatUsers()

  const canAccess = useMemo(() => {
    return profile?.role === 'admin' || profile?.role === 'consultant'
  }, [profile?.role])

  const hasSearchQuery = searchTerm.trim().length > 0
  const showSearchDropdown = searchOpen && hasSearchQuery

  const handleMarkedAsRead = useCallback(
    (lastReadAt: string | null) => {
      if (!selectedConversationId) return
      markConversationReadLocally(selectedConversationId, lastReadAt)
    },
    [markConversationReadLocally, selectedConversationId]
  )

  const handleSearchChange = useCallback(
    async (value: string) => {
      setSearchTerm(value)
      setSearchOpen(value.trim().length > 0)
      await searchUsers(value)
    },
    [searchUsers]
  )

  const setConversationParam = useCallback(
    (conversationId: string | null) => {
      const nextParams = new URLSearchParams(searchParams.toString())

      if (conversationId) {
        nextParams.set('conversation', conversationId)
      } else {
        nextParams.delete('conversation')
      }

      const query = nextParams.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const handleOpenConversation = useCallback(
    (conversationId: string) => {
      openConversation(conversationId)
      setConversationParam(conversationId)
    },
    [openConversation, setConversationParam]
  )

  const handleClearSelection = useCallback(() => {
    clearSelection()
    setConversationParam(null)
  }, [clearSelection, setConversationParam])

  const handleUserPick = useCallback(
    async (user: {
      id: string
      conversationId?: string | null
      hasConversation?: boolean
    }) => {
      if (user.hasConversation && user.conversationId) {
        handleOpenConversation(user.conversationId)
      } else {
        const conversationId = await openOrCreateConversation(user.id)
        if (conversationId) {
          setConversationParam(conversationId)
        }
      }

      setSearchTerm('')
      setSearchOpen(false)
      await searchUsers('')
    },
    [handleOpenConversation, openOrCreateConversation, searchUsers, setConversationParam]
  )

  useEffect(() => {
    if (!conversationParam) {
      if (selectedConversationId) {
        clearSelection()
      }
      return
    }

    if (conversationParam !== selectedConversationId) {
      openConversation(conversationParam)
    }
  }, [clearSelection, conversationParam, openConversation, selectedConversationId])

  useEffect(() => {
    if (!conversationParam) return
    if (loading) return

    const conversationExists = items.some((item) => item.id === conversationParam)
    if (conversationExists) return

    clearSelection()
    setConversationParam(null)
  }, [clearSelection, conversationParam, items, loading, setConversationParam])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (searchBoxRef.current?.contains(target)) return
      setSearchOpen(false)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (authLoading) {
    return (
      <div className="flex min-h-[calc(100vh-120px)] items-center justify-center">
        <div className="text-sm text-slate-500">Se încarcă...</div>
      </div>
    )
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Chat indisponibil</h1>
          <p className="mt-2 text-sm text-slate-600">
            Momentan această secțiune este disponibilă doar pentru admin și consultant.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-88px)] min-h-[600px] overflow-hidden px-4 pb-4 pt-2 md:px-6">
      <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm md:grid-cols-[360px_minmax(0,1fr)]">
        <aside
          className={`${
            selectedConversationId ? 'hidden md:flex' : 'flex'
          } min-h-0 flex-col border-r border-slate-200 bg-white`}
        >
          <div className="border-b border-slate-100 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Chat</h1>
              </div>

            </div>

            <div ref={searchBoxRef} className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onFocus={() => {
                  if (hasSearchQuery) setSearchOpen(true)
                }}
                onChange={(e) => {
                  void handleSearchChange(e.target.value)
                }}
                placeholder="Caută utilizatori..."
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none transition focus:border-slate-300 focus:bg-white"
              />

              {showSearchDropdown && (
                <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                  {userSearchLoading && (
                    <div className="px-4 py-3 text-sm text-slate-500">
                      Se caută utilizatori...
                    </div>
                  )}

                  {!userSearchLoading && userSearchError && (
                    <div className="px-4 py-3 text-sm text-rose-600">
                      {userSearchError}
                    </div>
                  )}

                  {!userSearchLoading &&
                    !userSearchError &&
                    userSearchItems.length === 0 &&
                    searchTerm.trim().length > 0 && (
                      <div className="px-4 py-3 text-sm text-slate-500">
                        Niciun utilizator găsit.
                      </div>
                    )}

                  {!userSearchLoading &&
                    !userSearchError &&
                    userSearchItems.map((user) => {
                      const displayName = user.full_name || user.email || 'Utilizator'
                      const color = getAvatarColor(displayName)
                      const initials = getInitials(user.full_name, user.email)

                      return (
                        <button
                          key={user.id}
                          onClick={() => void handleUserPick(user)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                        >
                          <div
                            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                            style={{
                              background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
                            }}
                          >
                            {initials}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {displayName}
                            </div>
                            {user.email && (
                              <div className="truncate text-xs text-slate-500">
                                {user.email}
                              </div>
                            )}
                          </div>

                          <div className="flex-shrink-0 text-xs text-slate-400">
                            {user.hasConversation ? 'Deschide' : 'Conversație nouă'}
                          </div>
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="p-4 text-sm text-slate-500">Se încarcă conversațiile...</div>
            )}

            {error && (
              <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            {!loading && items.length === 0 && !error && (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-3 rounded-2xl bg-slate-100 p-4 text-slate-400">
                  <MessageSquare className="h-6 w-6" />
                </div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Nu ai conversații încă
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Folosește căutarea de mai sus pentru a începe o conversație nouă.
                </p>
              </div>
            )}

            <div className="p-2">
              {items.map((item) => {
                const active = item.id === selectedConversationId
                const unread = getIsUnread(item)

                const displayName =
                  item.other_user?.full_name || item.other_user?.email || 'Utilizator'
                const email = item.other_user?.email
                const preview = item.last_message?.body || 'Fără mesaje încă'
                const color = getAvatarColor(displayName)
                const initials = getInitials(item.other_user?.full_name, item.other_user?.email)

                return (
                  <button
                    key={item.id}
                    onClick={() => handleOpenConversation(item.id)}
                    className={`mb-1 flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition ${
                      active ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{
                        background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
                      }}
                    >
                      {initials}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div
                            className={`truncate text-sm ${
                              unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'
                            }`}
                          >
                            {displayName}
                          </div>

                          {email && (
                            <div className="truncate text-xs text-slate-400">{email}</div>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          <span className="whitespace-nowrap text-[11px] text-slate-400">
                            {formatConversationTime(item.last_message_at)}
                          </span>

                          {unread && (
                            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          )}
                        </div>
                      </div>

                      <p
                        className={`mt-1 truncate text-sm ${
                          unread ? 'text-slate-700' : 'text-slate-500'
                        }`}
                      >
                        {preview}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        <main className={`${selectedConversationId ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}>
          {!selectedConversation || !selectedConversationId ? (
            <div className="flex h-full flex-col items-center justify-center bg-slate-50/40 px-6 text-center">
              <div className="mb-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <MessageSquare className="h-8 w-8 text-slate-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">
                Selectează o conversație
              </h2>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Alege o conversație din listă sau caută un utilizator pentru a începe una nouă.
              </p>
            </div>
          ) : (
            <PrivateChatView
              key={selectedConversation.id}
              conversationId={selectedConversation.id}
              title={
                selectedConversation.other_user?.full_name ||
                selectedConversation.other_user?.email ||
                'Conversație'
              }
              subtitle={selectedConversation.other_user?.email ?? null}
              initialLastReadAt={selectedConversation.last_read_at}
              otherLastReadAt={selectedConversation.other_last_read_at}
              showBackButton
              onBack={handleClearSelection}
              onMarkedAsRead={handleMarkedAsRead}
            />
          )}
        </main>
      </div>

      {(creating || userSearchLoading) && (
        <div className="pointer-events-none fixed bottom-4 right-4 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {creating ? 'Se creează conversația...' : 'Se caută...'}
        </div>
      )}
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-120px)] items-center justify-center">
          <div className="text-sm text-slate-500">Se încarcă...</div>
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  )
}
