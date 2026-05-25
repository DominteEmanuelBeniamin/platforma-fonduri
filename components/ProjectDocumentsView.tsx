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
  deleted_at?: string | null
}

interface DocRequest {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'review' | 'approved' | 'rejected'
  attachment_path: string | null
  attachment_missing_at?: string | null
  deadline_at: string | null
  created_at: string
  creator?: { full_name: string | null; email: string | null }
  activity?: { id: string; name: string; phase_id: string } | null
  files?: DocFile[]
}

function getStorageDisplayName(path: string | null) {
  if (!path) return undefined
  return path.split('/').filter(Boolean).pop() || undefined
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

  // Map to DriveRow: one row for each active request attachment and uploaded file.
  const driveRows = useMemo((): DriveRow[] => {
    const result: DriveRow[] = []
    requests.forEach(req => {
      const phaseName = req.activity
        ? phaseMap[`act_${req.activity.id}`] || phaseMap[req.activity.phase_id] || undefined
        : undefined
      const activityName = req.activity?.name ?? undefined

      if (req.attachment_path && !req.attachment_missing_at) {
        result.push({
          id: `${req.id}_attachment`,
          requestId: req.id,
          downloadKind: 'requestAttachment',
          storagePath: req.attachment_path,
          displayName: getStorageDisplayName(req.attachment_path) || 'Model document',
          uploadedAt: req.created_at,
          docName: req.name,
          entryType: 'request_attachment',
          entryLabel: 'Model/atașament cerere',
          docStatus: null,
          secondaryMain: phaseName,
          secondarySub: activityName,
          onRowClick: onOpenRequest ? () => onOpenRequest(req) : undefined,
        })
      }

      ;(req.files ?? []).filter(file => !file.deleted_at).forEach(file => {
        result.push({
          id: `${req.id}_${file.id}`,
          fileId: file.id,
          downloadKind: 'file',
          storagePath: file.storage_path,
          versionNumber: file.version_number,
          uploadedAt: file.created_at,
          docName: req.name,
          entryType: 'submission_file',
          entryLabel: 'Fișier încărcat',
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
