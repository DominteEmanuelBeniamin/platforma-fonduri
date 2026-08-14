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
import DriveFilesView, { type DriveFolderChange } from './DriveFilesView'

interface ProjectDocumentsViewProps {
  projectId: string
  requests: DriveSourceRequest[]
  phases: DriveSourcePhase[]
  error?: string | null
  onRetry?: () => void
  activeFolderId?: string | null
  onFolderChange?: DriveFolderChange
  /** Lipsă = rândurile nu se deschid (clientul n-are ce face în fișa cererii). */
  onOpenRequest?: (requestId: string) => void
}

export default function ProjectDocumentsView({
  projectId,
  requests,
  phases,
  error = null,
  onRetry,
  activeFolderId = null,
  onFolderChange,
  onOpenRequest,
}: ProjectDocumentsViewProps) {
  const { apiFetch } = useAuth()

  const documents = useMemo((): DriveDocument[] => (
    buildDriveDocuments(requests, phases).map(document => ({
      ...document,
      onRowClick: onOpenRequest ? () => onOpenRequest(document.requestId) : undefined,
    }))
  ), [onOpenRequest, phases, requests])

  const folders = useMemo((): DriveFolder[] => buildDriveFolders(documents, phases), [documents, phases])

  return (
    <DriveFilesView
      documents={documents}
      folders={folders}
      storageKey={projectId}
      activeFolderId={activeFolderId}
      onFolderChange={onFolderChange}
      error={error}
      onRetry={onRetry}
      apiFetch={apiFetch}
    />
  )
}
