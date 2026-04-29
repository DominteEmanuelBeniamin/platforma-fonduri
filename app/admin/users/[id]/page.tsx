/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Building2, Briefcase, Shield } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
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

  const { apiFetch, loading: authLoading, token } = useAuth()

  const [user,     setUser]     = useState<any>(null)
  const [allFiles, setAllFiles] = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, userId])

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
            <h1 className="text-sm font-semibold text-slate-900 truncate">
              {user.full_name || user.email}
            </h1>
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
