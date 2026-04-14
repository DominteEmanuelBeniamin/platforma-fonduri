'use client'

import { useMemo } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import DriveFilesView, { DriveRow } from './DriveFilesView'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocFile {
  id: string
  storage_path: string
  version_number: number
  comments: string | null
  created_at: string
  uploaded_by: string | null
}

interface DocRequest {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'review' | 'approved' | 'rejected'
  attachment_path: string | null
  deadline_at: string | null
  created_at: string
  creator?: { full_name: string | null; email: string | null }
  activity?: { id: string; name: string; phase_id: string } | null
  files?: DocFile[]
}

interface ProjectDocumentsViewProps {
  projectId: string
  requests: DocRequest[]
  phases: Array<{ id: string; name: string; activities?: Array<{ id: string; name: string }> }>
  onOpenRequest?: (req: DocRequest) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProjectDocumentsView({
  requests,
  phases,
  onOpenRequest,
}: ProjectDocumentsViewProps) {
  const { apiFetch } = useAuth()

  // Phase name lookup by phase id or activity id
  const phaseMap = useMemo(() => {
    const m: Record<string, string> = {}
    phases.forEach(p => {
      m[p.id] = p.name
      p.activities?.forEach(a => { m[`act_${a.id}`] = p.name })
    })
    return m
  }, [phases])

  // Map to DriveRow — one row per uploaded file
  const driveRows = useMemo((): DriveRow[] => {
    const result: DriveRow[] = []
    requests.forEach(req => {
      if (!req.files?.length) return   // only actual uploads
      const phaseName = req.activity
        ? phaseMap[`act_${req.activity.id}`] || phaseMap[req.activity.phase_id] || undefined
        : undefined
      const activityName = req.activity?.name ?? undefined
      req.files.forEach(file => {
        result.push({
          id: `${req.id}_${file.id}`,
          fileId: file.id,
          storagePath: file.storage_path,
          versionNumber: file.version_number,
          uploadedAt: file.created_at,
          docName: req.name,
          docStatus: req.status,
          secondaryMain: phaseName,
          secondarySub: activityName,
          onRowClick: onOpenRequest ? () => onOpenRequest(req) : undefined,
        })
      })
    })
    return result
  }, [requests, phaseMap, onOpenRequest])

  return (
    <DriveFilesView
      rows={driveRows}
      secondaryColumnLabel="Fază / Activitate"
      apiFetch={apiFetch}
    />
  )
}
