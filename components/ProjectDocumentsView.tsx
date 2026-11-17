'use client'

import { useMemo } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import {
  buildDriveDocuments,
  buildDriveFolders,
  visibleDriveFileCount,
  type DriveDocument,
  type DriveFolder,
  type DriveSourcePhase,
  type DriveSourceRequest,
} from '@/lib/drive-grouping'
import DriveFilesView, { type DriveFolderChange } from './DriveFilesView'
import type { InternalEntry } from './ProjectInternalDossier'
import type { ProjectPhase } from './ProjectPhasesSidebar'

interface ProjectDocumentsViewProps {
  projectId: string
  requests: DriveSourceRequest[]
  phases: (DriveSourcePhase & Pick<ProjectPhase, 'activities'>)[]
  internalEntries?: InternalEntry[]
  onOpenInternalEntry?: (entryId: string) => void
  onDownloadInternal?: (entryId: string, attachmentId: string) => Promise<void>
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
  internalEntries,
  onOpenInternalEntry,
  onDownloadInternal,
}: ProjectDocumentsViewProps) {
  const { apiFetch } = useAuth()

  const documents = useMemo((): DriveDocument[] => (
    [...buildDriveDocuments(requests, phases).map(document => ({
      ...document,
      onRowClick: onOpenRequest ? () => onOpenRequest(document.requestId) : undefined,
    })), ...(internalEntries ?? []).flatMap(entry => {
      if (!entry.attachments.length) return []
      const request = requests.find(item => item.id === entry.document_requirement_id)
      const activityId = entry.activity_id ?? request?.activity?.id ?? request?.activity_id
      const phase = phases.find(item => item.id === entry.phase_id || item.activities?.some(activity => activity.id === activityId) || (request?.activity?.phase_id && item.id === request.activity.phase_id))
      const activity = phase?.activities?.find(item => item.id === activityId)
      return [{
        id: `internal:${entry.id}`,
        requestId: '',
        docName: entry.title,
        docStatus: null,
        publicationStatus: 'published' as const,
        publicationReason: '',
        folderId: phase ? `phase:${phase.id}` : 'general',
        folderName: phase?.name ?? 'General',
        folderOrderIndex: phase?.order_index ?? Number.MAX_SAFE_INTEGER,
        activityName: activity?.name ?? request?.activity?.name ?? undefined,
        uploadedAt: entry.attachments.reduce((latest, file) => file.created_at > latest ? file.created_at : latest, entry.attachments[0].created_at),
        internal: true,
        onRowClick: onOpenInternalEntry ? () => onOpenInternalEntry(entry.id) : undefined,
        attachments: entry.attachments.map(file => ({ id: `internal:${file.id}`, downloadKind: 'file' as const, storagePath: file.original_name, displayName: file.original_name, mimeType: file.mime_type, previewUrl: `/preview/internal/${file.id}?${new URLSearchParams({ projectId, entryId: entry.id, name: file.original_name })}`, uploadedAt: file.created_at, entryLabel: 'Fișier intern', onDownload: () => onDownloadInternal!(entry.id, file.id) })),
        versions: [],
      }]
    })]
  ), [onOpenRequest, phases, requests, internalEntries, onOpenInternalEntry, onDownloadInternal, projectId])

  const folders = useMemo((): DriveFolder[] => {
    const result = buildDriveFolders(documents, phases)
    if (internalEntries) result.push({ id: 'internal', name: 'Documente interne', documentCount: documents.filter(document => document.internal).reduce((count, document) => count + visibleDriveFileCount(document), 0) })
    return result
  }, [documents, phases, internalEntries])

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
