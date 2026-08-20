'use client'

import Link from "next/link"
import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import {useAuth} from "@/app/providers/AuthProvider"
import { usePrivateChatUnread } from "@/hooks/usePrivateChatUnread"
import { useProjectChatUnread } from "@/app/providers/ProjectChatUnreadProvider"

export default function Navbar() {
  const { loading: authLoading, user, profile, signOut } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
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

  // Rândul de pastile se derulează, deci pastila paginii curente poate cădea în
  // afara cadrului — pe telefon, unde din șapte se văd trei. O aducem în mijloc
  // la fiecare schimbare de pagină, ca meniul să arate mereu unde ești.
  //
  // Pastila activă se găsește după chiar adresa ei, fără niciun atribut adăugat
  // celor șapte link-uri. Pe o pagină din afara meniului (un proiect, de pildă)
  // nu se potrivește nimic și nu se derulează nimic.
  const pillRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = pillRow.current
    const active = row?.querySelector<HTMLElement>(`a[href="${pathname}"]`)
    if (!row || !active) return
    const rowBox = row.getBoundingClientRect()
    const pillBox = active.getBoundingClientRect()
    row.scrollBy({ left: pillBox.left - rowBox.left - (rowBox.width - pillBox.width) / 2 })
  }, [pathname, isLoggedIn, profile?.role])

  const isActive = (path: string) => pathname === path 
    ? "text-slate-900 bg-white shadow-sm border-slate-200/60" 
    : "text-slate-500 hover:text-slate-900 hover:bg-white/50"

  return (
    <nav className="fixed top-0 left-0 w-full bg-white/80 backdrop-blur-xl border-b border-slate-200/60 h-16 flex items-center justify-between px-6 lg:px-12 z-50 transition-all">
      
      <div className="flex-shrink-0">
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="relative w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center shadow-lg shadow-slate-900/20 group-hover:rotate-3 transition-transform duration-300">
            <span className="text-white text-sm font-bold">B</span>
          </div>
          <span className="text-lg font-bold text-slate-900 tracking-tight hidden sm:block">
            Bonie<span className="text-indigo-600">.</span>
          </span>
        </Link>
      </div>

      {/* `min-w-0` lasă rândul de pastile să se îngusteze sub lățimea lui
          naturală; fără el, un element flex refuză să scadă sub conținut și
          derularea de mai jos n-ar porni niciodată. */}
      <div className="flex-1 min-w-0 flex justify-center px-4">
        {isLoggedIn && (
          // Se derulează lateral, nu se taie. Adminul are șapte pastile, peste
          // 600px puse cap la cap, într-un ecran de telefon care oferă vreo 330:
          // cu `overflow-hidden`, ultimele două — Utilizatori și Audit — nu erau
          // doar tăiate, ci de neatins.
          <div
            ref={pillRow}
            className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto bg-slate-100/50 p-1 rounded-full border border-slate-200/50"
          >
            <Link
              href="/"
              className={`relative px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive('/')}`}
            >
              Proiecte
              {hasProjectChatUnread && (
                <span
                  className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
                  aria-label={`${unreadProjectCount} proiecte cu mesaje necitite`}
                >
                  {unreadProjectCount > 9 ? '9+' : unreadProjectCount}
                </span>
              )}
            </Link>
            {canUsePrivateChat && (
              <Link
                href="/chat"
                className={`relative px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive('/chat')}`}
              >
                Chat
                {hasPrivateChatUnread && (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
                    aria-label={`${unreadConversationCount} conversații necitite`}
                  >
                    {unreadConversationCount > 9 ? '9+' : unreadConversationCount}
                  </span>
                )}
              </Link>
            )}
            {isTeamMember && (
              <Link
                href="/calendar"
                className={`px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive('/calendar')}`}
              >
                Calendar
              </Link>
            )}
            {isTeamMember && (
              <Link
                href={profile?.role === 'admin' ? '/admin' : '/admin/templates'}
                className={`px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive(profile?.role === 'admin' ? '/admin' : '/admin/templates')}`}
              >
                Șabloane
              </Link>
            )}
            {profile?.role === 'admin' && (
              <>
                <Link
                  href="/admin/proiecte"
                  className={`px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive('/admin/proiecte')}`}
                >
                  Tablou de bord
                </Link>
                <Link
                  href="/admin/users"
                  className={`px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive('/admin/users')}`}
                >
                  Utilizatori
                </Link>
                <Link
                  href="/admin/audit"
                  className={`px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive('/admin/audit')}`}
                >
                  Audit
                </Link>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-4 justify-end">
        {user ? (
          <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
            <div className="hidden lg:block text-right">
              <p className="text-xs font-semibold text-slate-900 truncate max-w-[150px]">
                {profile?.email ?? (typeof user === 'object' && user && 'email' in user ? String(user.email) : '')}
              </p>
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Cont Activ</p>
            </div>
            <button
              onClick={handleLogout}
              className="group flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all"
              title="Deconectare"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="w-8"></div>
        )}
      </div>
    </nav>
  )
}
