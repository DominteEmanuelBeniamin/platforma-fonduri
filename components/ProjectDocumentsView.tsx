'use client'

import { useMemo } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import { buildDriveDocuments, buildDriveFolders } from '@/lib/drive-grouping'
import DriveFilesView, {
  DriveDocument,
  DriveFolder,
} from './DriveFilesView'

interface DocAttachment {
  id: string
  storage_path: string
  original_name: string | null
  missing_at?: string | null
}

interface DocRequest {
  id: string
  name: string
  status: 'pending' | 'review' | 'approved' | 'rejected'
  is_outgoing?: boolean
  attachment_path: string | null
  attachment_original_name?: string | null
  attachment_missing_at?: string | null
  attachments?: DocAttachment[]
  created_at: string
  activity?: { id: string; name: string; phase_id: string } | null
  activity_id?: string | null
  files?: Array<{
    id: string
    storage_path: string
    original_name: string
    version_number: number
    created_at: string
    deleted_at?: string | null
  }>
}

interface Phase {
  id: string
  name: string
  order_index: number
  activities?: Array<{ id: string; name: string; phase_id?: string; order_index?: number }>
}

interface ProjectDocumentsViewProps {
  projectId: string
  requests: DocRequest[]
  phases: Phase[]
  loading?: boolean
  error?: string | null
  activeFolderId?: string | null
  onFolderChange?: (folderId: string | null) => void
  onOpenRequest?: (request: DocRequest) => void
}

export default function ProjectDocumentsView({
  projectId,
  requests,
  phases,
  loading = false,
  error = null,
  activeFolderId = null,
  onFolderChange,
  onOpenRequest,
}: ProjectDocumentsViewProps) {
  const { apiFetch } = useAuth()

  const documents = useMemo((): DriveDocument[] => {
    const requestById = new Map(requests.map(request => [request.id, request]))
    return (buildDriveDocuments(requests, phases) as DriveDocument[]).map(document => ({
      ...document,
      onRowClick: onOpenRequest
        ? () => {
            const request = requestById.get(document.requestId)
            if (request) onOpenRequest(request)
          }
        : undefined,
    }))
  }, [onOpenRequest, phases, requests])

  const folders = useMemo((): DriveFolder[] => {
    return buildDriveFolders(documents, phases) as DriveFolder[]
  }, [documents, phases])

  return (
    <DriveFilesView
      rows={[]}
      documents={documents}
      folders={folders}
      storageKey={projectId}
      activeFolderId={activeFolderId}
      onFolderChange={onFolderChange}
      loading={loading}
      error={error}
      secondaryColumnLabel="Fază / Activitate"
      apiFetch={apiFetch}
    />
  )
}
