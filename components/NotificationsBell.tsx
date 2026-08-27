'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Bell, CheckCheck, LoaderCircle, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useNotifications } from '@/app/providers/NotificationsProvider'
import NotificationRow from '@/components/notifications/NotificationRow'
import { useNotificationFeed } from '@/components/notifications/useNotificationFeed'

const PANEL_SIZE = 8

export default function NotificationsBell() {
  const { unreadCount } = useNotifications()
  const [open, setOpen] = useState(false)
  const feed = useNotificationFeed({ limit: PANEL_SIZE, active: open })
  const [markingAll, setMarkingAll] = useState(false)

  // Panoul e o privire scurtă: filtrele, ștergerea și marcarea rând cu rând
  // stau pe pagina de notificări, ca să nu existe două seturi de controale
  // pentru aceleași acțiuni.
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) feed.reset()
  }

  const markAllRead = async () => {
    setMarkingAll(true)
    await feed.setRead(null, true)
    setMarkingAll(false)
  }

  const busy = markingAll || feed.pendingId !== null

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `${unreadCount} notificări necitite` : 'Notificări'}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999998] bg-slate-950/25 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[999999] flex max-h-[min(80dvh,36rem)] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl focus:outline-none sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-[min(28rem,calc(100vw-2rem))] sm:rounded-3xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-slate-900">Notificări</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-slate-500">
                {unreadCount > 0 ? `${unreadCount} necitite` : 'Nimic nou'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Închide notificările" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">
            {feed.error ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
                <AlertCircle className="h-8 w-8 text-rose-400" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-700">Notificările nu au putut fi încărcate.</p>
                <button type="button" onClick={() => void feed.reload()} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Încearcă din nou</button>
              </div>
            ) : feed.loading && feed.items.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center text-sm text-slate-400">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Se încarcă notificările…
              </div>
            ) : feed.items.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
                <Bell className="h-8 w-8 text-slate-300" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-600">Nu ai notificări.</p>
                <p className="max-w-xs text-xs leading-relaxed text-slate-400">Aici vor apărea publicări, atribuiri, termene și acțiuni sau verificări de documente.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {feed.items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    disabled={busy}
                    onOpen={(current) => void feed.openTarget(current)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={busy || unreadCount === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              {markingAll ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              Marchează tot ca citit
            </button>
            <Link
              href="/notificari"
              onClick={() => handleOpenChange(false)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Vezi toate
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
