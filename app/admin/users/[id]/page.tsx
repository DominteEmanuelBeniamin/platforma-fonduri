/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Building2, Briefcase, Shield } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { LocationStrip } from '@/components/ui/LocationStrip'
import DriveFilesView, { DriveRow } from '@/components/DriveFilesView'
import { Spinner } from '@/components/ui/Spinner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const { Icon, label } =
    role === 'admin' ? { Icon: Shield, label: 'Administrator' }
    : role === 'consultant' ? { Icon: Briefcase, label: 'Consultant' }
    : { Icon: Building2, label: 'Client' }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-plate)] border border-rule bg-paper-sunk px-2.5 py-1 text-xs font-semibold text-ink-soft">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
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


  if (authLoading || loading) {
    return (
      <div className="flex h-screen items-center justify-center" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-ink-soft">Se încarcă utilizatorul…</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div>
      <LocationStrip
        segments={[
          { label: 'Bonie', href: '/' },
          { label: 'Utilizatori', href: '/admin/users' },
          { label: user.full_name || user.email },
        ]}
        action={
          <>
            <RoleBadge role={user.role} />
            {user.cif && (
              <span className="hidden shrink-0 rounded-[var(--radius-plate)] bg-paper-sunk px-2.5 py-1 text-xs text-ink-soft sm:block">
                CIF {user.cif}
              </span>
            )}
          </>
        }
      />

      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">
        {user.full_name || user.email}
      </h1>
      <p className="mb-6 mt-2 text-sm text-ink-soft">
        Fișierele acestui utilizator, din toate proiectele lui.
      </p>

      <div className="pb-10">
        <div className="overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
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
