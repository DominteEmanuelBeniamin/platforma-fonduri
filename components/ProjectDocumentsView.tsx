'use client'

import { useMemo } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import {
  buildDriveDocuments,
  buildDriveFolders,
  type DriveDocument,
  type DriveFolder,
  type DriveSourcePhase,
  type DriveSourceRequest,
} from '@/lib/drive-grouping'
import DriveFilesView from './DriveFilesView'

interface ProjectDocumentsViewProps {
  projectId: string
  requests: DriveSourceRequest[]
  phases: DriveSourcePhase[]
  loading?: boolean
  error?: string | null
  activeFolderId?: string | null
  onFolderChange?: (folderId: string | null) => void
  onOpenRequest?: (request: DriveSourceRequest) => void
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
    return buildDriveDocuments(requests, phases).map(document => ({
      ...document,
      onRowClick: onOpenRequest
        ? () => {
            const request = requestById.get(document.requestId)
            if (request) onOpenRequest(request)
          }
        : undefined,
    }))
  }, [onOpenRequest, phases, requests])

  const folders = useMemo((): DriveFolder[] => buildDriveFolders(documents, phases), [documents, phases])

  return (
    <DriveFilesView
      documents={documents}
      folders={folders}
      storageKey={projectId}
      activeFolderId={activeFolderId}
      onFolderChange={onFolderChange}
      loading={loading}
      error={error}
      apiFetch={apiFetch}
    />
  )
}
