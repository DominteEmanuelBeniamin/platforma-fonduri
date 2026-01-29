'use client'

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {useAuth} from "@/app/providers/AuthProvider"

export default function Navbar() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { loading: authLoading, user, profile, signOut } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const isLoggedIn = !authLoading && !!user


  const handleLogout = async () => {
    await signOut()
    router.replace('/login')
  }
  

  const isActive = (path: string) => pathname === path 
    ? "text-slate-900 bg-white shadow-sm border-slate-200/60" 
    : "text-slate-500 hover:text-slate-900 hover:bg-white/50"

  return (
    // Folosim h-16 (height) fix și justify-between pentru a împărți spațiul
    <nav className="fixed top-0 left-0 w-full bg-white/80 backdrop-blur-xl border-b border-slate-200/60 h-16 flex items-center justify-between px-6 lg:px-12 z-50 transition-all">
      
      {/* 1. Logo (Stânga) */}
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

      {/* 2. Navigație Centrală (Doar dacă e logat) */}
      {/* Folosim flex-1 și justify-center pentru a-l centra natural, fără overlap */}
      <div className="flex-1 flex justify-center px-4">
        {isLoggedIn && (
          <div className="flex items-center gap-1 bg-slate-100/50 p-1 rounded-full border border-slate-200/50 overflow-hidden">
            <Link 
              href="/" 
              className={`px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive('/')}`}
            >
              Proiecte
            </Link>
            {profile?.role === 'admin' && (
            <Link 
              href="/admin/users" 
              className={`px-4 sm:px-6 py-1.5 text-xs sm:text-sm font-medium rounded-full border border-transparent transition-all whitespace-nowrap ${isActive('/admin/users')}`}
            >
              Utilizatori
            </Link>
            )}
          </div>
        )}
      </div>

      {/* 3. Zona Utilizator & Logout (Dreapta) */}
      <div className="flex-shrink-0 flex items-center gap-4 justify-end">
        {user ? (
          <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
            <div className="hidden lg:block text-right">
                <p className="text-xs font-semibold text-slate-900 truncate max-w-[150px]">{user.email}</p>
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