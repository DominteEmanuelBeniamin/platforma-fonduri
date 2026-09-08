/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Building2, Briefcase, ChevronDown, Eye, EyeOff, KeyRound, Shield } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import DriveFilesView, { DriveRow } from '@/components/DriveFilesView'

// ── Helpers ───────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  if (role === 'admin')
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200"><Shield className="w-3 h-3" />Administrator</span>
  if (role === 'consultant')
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 ring-1 ring-purple-200"><Briefcase className="w-3 h-3" />Consultant</span>
  return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"><Building2 className="w-3 h-3" />Client</span>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UserFilesPage() {
  const router  = useRouter()
  const params  = useParams()
  const userId  = params?.id as string

  const { apiFetch, loading: authLoading, token, profile } = useAuth()
  const { showToast, confirm } = useToast()

  const [user,     setUser]     = useState<any>(null)
  const [allFiles, setAllFiles] = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [userId])

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    if (!profile) return
    if (profile.role !== 'admin') { router.replace('/'); return }
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, profile, userId])

  async function loadAll() {
    setLoading(true)
    try {
      // Fetch user info
      const userRes = await apiFetch('/api/users')
      if (!userRes.ok) { router.replace('/admin/users'); return }
      const { users: allUsers } = await userRes.json()
      const userData = allUsers.find((u: any) => u.id === userId)
      if (!userData) { router.replace('/admin/users'); return }
      setUser(userData)

      // Fetch projects for this user
      const projRes = await apiFetch('/api/projects')
      if (!projRes.ok) return
      const { projects: allProjects } = await projRes.json()

      const projects = userData.role === 'client'
        ? allProjects.filter((p: any) => p.client_id === userData.id)
        : allProjects

      // Flatten: one row per uploaded FILE
      const fileRows: any[] = []
      await Promise.all(
        projects.map(async (p: any) => {
          const res = await apiFetch(`/api/projects/${p.id}/document-requests`)
          if (!res.ok) return
          const { requests } = await res.json()
          for (const req of requests ?? []) {
            for (const file of req.files ?? []) {
              fileRows.push({
                fileId:           file.id,
                storagePath:      file.storage_path,
                displayName:      file.original_name,
                versionNumber:    file.version_number,
                uploadedAt:       file.created_at,
                reqName:          req.name,
                reqStatus:        req.status,
                projectId:        p.id,
                projectTitle:     p.title,
                projectCodIntern: p.cod_intern ?? null,
              })
            }
          }
        })
      )
      setAllFiles(fileRows)
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || passwordSaving) return

    if (!newPassword || !confirmPassword) {
      showToast('Completează ambele câmpuri de parolă.', 'error')
      return
    }
    if (newPassword !== confirmPassword) {
      showToast('Parolele nu coincid.', 'error')
      return
    }

    const confirmed = await confirm({
      title: 'Confirmă schimbarea parolei',
      description: `Parola pentru ${user.full_name ? `${user.full_name} (${user.email})` : user.email} va fi înlocuită permanent. Comunică parola utilizatorului în siguranță.`,
      confirmText: 'Schimbă parola',
    })
    if (!confirmed) return

    setPasswordSaving(true)
    try {
      const response = await apiFetch(`/api/users/${encodeURIComponent(userId)}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        showToast(data?.message || data?.error || 'Nu am putut schimba parola. Reîncearcă.', 'error')
        return
      }

      if (data?.notificationSent === false) {
        showToast('Parola a fost schimbată, dar emailul de notificare nu a putut fi trimis.', 'warning')
      } else {
        showToast('Parola a fost schimbată. Comunică utilizatorului parola în siguranță.', 'success')
      }
    } catch {
      showToast('Nu am putut schimba parola. Reîncearcă.', 'error')
    } finally {
      setPasswordSaving(false)
      setNewPassword('')
      setConfirmPassword('')
      setShowNewPassword(false)
      setShowConfirmPassword(false)
    }
  }

  // Map to DriveRow
  const driveRows = useMemo((): DriveRow[] => allFiles.map(f => ({
    id:            f.fileId,
    fileId:        f.fileId,
    storagePath:   f.storagePath,
    displayName:   f.displayName,
    versionNumber: f.versionNumber,
    uploadedAt:    f.uploadedAt,
    docName:       f.reqName,
    docStatus:     f.reqStatus as DriveRow['docStatus'],
    secondaryMain: f.projectTitle,
    secondarySub:  f.projectCodIntern ?? undefined,
    onSecondaryClick: () => router.push(`/projects/${f.projectId}`),
  })), [allFiles, router])

  const initials = user ? (user.full_name || user.email).slice(0, 2).toUpperCase() : '??'

  if (authLoading || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Se încarcă...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Google Sans', Roboto, Arial, sans-serif" }}>

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/admin/users')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors flex-shrink-0">
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium hidden sm:block">Utilizatori</span>
          </button>
          <span className="text-slate-300 hidden sm:block">/</span>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-slate-900">{user.full_name || user.email}</h1>
              {user.full_name && <p className="truncate text-xs text-slate-500">{user.email}</p>}
            </div>
            <RoleBadge role={user.role} />
          </div>

          {user.cif && (
            <span className="text-xs bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full hidden sm:block">
              CIF {user.cif}
            </span>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6">
        {(user.role === 'client' || user.role === 'consultant') && (
          <details className="group mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-start gap-2.5 px-5 py-3.5 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="min-w-0 flex-1 sm:flex sm:flex-wrap sm:gap-x-2">
                <span className="block font-semibold text-slate-900">Schimbă parola</span>
                <span className="mt-0.5 block break-all text-slate-500 sm:mt-0">Acțiune manuală pentru {user.email}</span>
              </span>
            </summary>

            <form onSubmit={handlePasswordSubmit} className="space-y-3 border-t border-slate-100 px-5 py-4">
              <p className="text-sm leading-5 text-slate-500">
                Adminul setează manual o parolă permanentă și o comunică utilizatorului în siguranță. Parola nu va fi trimisă prin email.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-900">Parolă nouă</span>
                  <span className="relative block">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={event => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      required
                      disabled={passwordSaving}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2.5 pr-11 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(value => !value)}
                      disabled={passwordSaving}
                      aria-label={showNewPassword ? 'Ascunde parola nouă' : 'Afișează parola nouă'}
                      aria-pressed={showNewPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-900">Confirmă parola</span>
                  <span className="relative block">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={event => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      required
                      disabled={passwordSaving}
                      aria-invalid={confirmPassword.length > 0 && newPassword !== confirmPassword}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2.5 pr-11 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(value => !value)}
                      disabled={passwordSaving}
                      aria-label={showConfirmPassword ? 'Ascunde confirmarea parolei' : 'Afișează confirmarea parolei'}
                      aria-pressed={showConfirmPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </span>
                </label>
              </div>

              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-sm text-red-600" role="alert">Parolele nu coincid.</p>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {passwordSaving ? 'Se schimbă parola...' : 'Schimbă parola'}
                </button>
              </div>
            </form>
          </details>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <DriveFilesView
            rows={driveRows}
            secondaryColumnLabel="Proiect"
            apiFetch={apiFetch}
            standalone
            emptyText={
              user.role === 'client'
                ? 'Clientul nu a încărcat niciun fișier.'
                : 'Nu există fișiere pentru acest utilizator.'
            }
          />
        </div>
      </div>
    </div>
  )
}
