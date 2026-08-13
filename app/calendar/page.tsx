'use client'

import { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Loader2 } from 'lucide-react'

import { useAuth } from '@/app/providers/AuthProvider'
import CalendarSurface from '@/components/calendar/CalendarSurface'

/**
 * Calendarul general (cerința 20): termenele din toate proiectele în care
 * utilizatorul lucrează, prin aceeași suprafață ca tabul din pagina
 * proiectului. Suprafață de lucru intern — clientul e trimis înapoi la
 * proiectele lui, la fel ca în rută.
 */
function GeneralCalendarContent() {
  const router = useRouter()
  const { loading: authLoading, token, profile } = useAuth()

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    if (profile?.role === 'client') router.replace('/')
  }, [authLoading, token, profile?.role, router])

  // `!profile` face parte din gardă: cât profilul se încarcă, rolul e
  // necunoscut, iar fără el clientul ar apuca să monteze calendarul și ar vedea
  // eroarea de 403 licărind înainte de redirect.
  if (authLoading || !token || !profile || profile.role === 'client') {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Se încarcă...
      </div>
    )
  }

  return (
    // `project-scope` aduce paleta `--p-*`, ca ambele calendare să arate la fel.
    <div className="project-scope space-y-4">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--p-accent-soft)]">
          <CalendarDays className="h-5 w-5 text-[var(--p-accent)]" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold text-[var(--p-ink)]">Calendar</h1>
          <p className="text-xs text-[var(--p-ink-soft)]">
            Termenele activităților și ale cererilor de documente din proiectele tale.
          </p>
        </div>
      </header>

      <CalendarSurface />
    </div>
  )
}

export default function GeneralCalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
        </div>
      }
    >
      <GeneralCalendarContent />
    </Suspense>
  )
}
