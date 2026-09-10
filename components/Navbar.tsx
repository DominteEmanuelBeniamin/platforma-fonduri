'use client'

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { LogOut } from "lucide-react"
import {useAuth} from "@/app/providers/AuthProvider"
import { usePrivateChatUnread } from "@/hooks/usePrivateChatUnread"
import { useProjectChatUnread } from "@/app/providers/ProjectChatUnreadProvider"
import NotificationsBell from "@/components/NotificationsBell"
import { IconButton } from "@/components/ui/IconButton"
import { Counter } from "@/components/ui/Counter"

/**
 * Panoul-director din holul clădirii. Nu pastile plutitoare pe sticlă mată —
 * o fâșie de material prins pe perete, cu o linie sub ea și plăcuțe pentru
 * fiecare etaj. Etajul pe care te afli poartă banda accentului dedesubt.
 */
export default function Navbar() {
  const { loading: authLoading, user, profile, signOut } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const pillsRef = useRef<HTMLDivElement>(null)
  const isLoggedIn = !authLoading && !!user
  // Chatul privat, calendarul general și șabloanele sunt suprafețe de echipă:
  // clientul nu are acces la niciuna.
  const isTeamMember = profile?.role === 'admin' || profile?.role === 'consultant'
  const canUsePrivateChat = isTeamMember
  const {
    hasUnread: hasPrivateChatUnread,
    unreadConversationCount,
  } = usePrivateChatUnread(
    isLoggedIn && canUsePrivateChat
  )
  const {
    hasUnread: hasProjectChatUnread,
    unreadProjectCount,
  } = useProjectChatUnread(isLoggedIn)

  const handleLogout = async () => {
    await signOut()
    router.replace('/login')
  }

  const linkClass = (path: string) =>
    [
      'relative inline-flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-medium pointer-fine:min-h-10 sm:px-4',
      'border-b-2 transition-colors duration-[120ms]',
      pathname === path
        ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] font-semibold text-[var(--sg-accent-ink)]'
        : 'border-transparent text-ink-soft hover:border-rule-strong hover:text-ink',
    ].join(' ')

  useEffect(() => {
    pillsRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [pathname, profile?.role])

  return (
    <nav
      aria-label="Navigare principală"
      className="sticky top-0 z-50 flex h-16 w-full min-w-0 items-center justify-between gap-3 border-b border-rule bg-plate px-4 sm:px-6 lg:px-10"
    >
      <div className="flex-shrink-0">
        {/* Pe telefon linkul e doar pătratul de 32px, sub cei 44 promiși
              degetului: ținta crește, pătratul rămâne la mărimea lui. */}
        <Link href="/" className="group flex min-h-11 min-w-11 items-center justify-center gap-2.5 rounded-[var(--radius-plate)] pointer-fine:min-h-0 pointer-fine:min-w-0 sm:justify-start">
          <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-accent)] text-sm font-bold text-white">
            B
          </span>
          <span className="hidden text-lg font-bold tracking-tight text-ink sm:block">
            Bonie
          </span>
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 justify-center">
        {isLoggedIn && (
          <div ref={pillsRef} className="no-scrollbar min-w-0 max-w-full overflow-x-auto">
            <div className="flex w-max min-w-full items-stretch justify-center">
              <Link
                href="/"
                data-active={pathname === '/' ? 'true' : undefined}
                className={linkClass('/')}
              >
                Proiecte
                {hasProjectChatUnread && (
                  <Counter n={unreadProjectCount} label={`${unreadProjectCount} proiecte cu mesaje necitite`} className="ml-2" />
                )}
              </Link>
              {canUsePrivateChat && (
                <Link
                  href="/chat"
                  data-active={pathname === '/chat' ? 'true' : undefined}
                  className={linkClass('/chat')}
                >
                  Chat
                  {hasPrivateChatUnread && (
                    <Counter n={unreadConversationCount} label={`${unreadConversationCount} conversații necitite`} className="ml-2" />
                  )}
                </Link>
              )}
              {isTeamMember && (
                <Link
                  href="/calendar"
                  data-active={pathname === '/calendar' ? 'true' : undefined}
                  className={linkClass('/calendar')}
                >
                  Calendar
                </Link>
              )}
              {isTeamMember && (
                <Link
                  href={profile?.role === 'admin' ? '/admin' : '/admin/templates'}
                  data-active={pathname === (profile?.role === 'admin' ? '/admin' : '/admin/templates') ? 'true' : undefined}
                  className={linkClass(profile?.role === 'admin' ? '/admin' : '/admin/templates')}
                >
                  Șabloane
                </Link>
              )}
              {profile?.role === 'admin' && (
                <>
                  <Link
                    href="/admin/proiecte"
                    data-active={pathname === '/admin/proiecte' ? 'true' : undefined}
                    className={linkClass('/admin/proiecte')}
                  >
                    Tablou de bord
                  </Link>
                  <Link
                    href="/admin/users"
                    data-active={pathname === '/admin/users' ? 'true' : undefined}
                    className={linkClass('/admin/users')}
                  >
                    Utilizatori
                  </Link>
                  <Link
                    href="/admin/audit"
                    data-active={pathname === '/admin/audit' ? 'true' : undefined}
                    className={linkClass('/admin/audit')}
                  >
                    Audit
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-shrink-0 items-center justify-end gap-2">
        {user ? (
          <>
            {isLoggedIn && <NotificationsBell />}
            <div className="flex items-center gap-2 border-l border-rule pl-2 sm:gap-3 sm:pl-3">
              <p className="hidden max-w-[180px] truncate text-xs font-medium text-ink-soft lg:block">
                {profile?.email ?? (typeof user === 'object' && user && 'email' in user ? String(user.email) : '')}
              </p>
              <IconButton label="Deconectare" tone="danger" onClick={handleLogout}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </div>
          </>
        ) : (
          <div className="w-8" />
        )}
      </div>
    </nav>
  )
}
