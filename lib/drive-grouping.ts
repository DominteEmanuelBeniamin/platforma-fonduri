// Grupează cererile de documente ale unui proiect în „documente logice"
// (cerere + atașamente + versiuni de fișiere) și în dosare per fază.

export type DriveDocStatus = 'pending' | 'review' | 'approved' | 'rejected' | 'sent' | null

type Visibility = 'draft' | 'published' | null | undefined

// ── Ce intră ──────────────────────────────────────────────────────────────────

export interface DriveSourceAttachment {
  id?: string
  storage_path: string
  original_name?: string | null
  missing_at?: string | null
}

export interface DriveSourceFile {
  id: string
  storage_path: string
  original_name: string
  version_number: number
  created_at: string
  deleted_at?: string | null
}

export interface DriveSourceRequest {
  id: string
  name: string
  status: 'pending' | 'review' | 'approved' | 'rejected'
  visibility?: Visibility
  is_outgoing?: boolean
  created_at: string
  attachment_path?: string | null
  attachment_original_name?: string | null
  attachment_missing_at?: string | null
  attachments?: DriveSourceAttachment[]
  activity_id?: string | null
  activity?: {
    id?: string
    name?: string | null
    phase_id?: string | null
    visibility?: Visibility
    phase?: { visibility?: Visibility } | null
  } | null
  files?: DriveSourceFile[]
}

export interface DriveSourcePhase {
  id: string
  name: string
  order_index: number
  visibility?: Visibility
}

// ── Ce iese ───────────────────────────────────────────────────────────────────

export interface DriveAsset {
  id: string
  fileId?: string
  requestId?: string
  attachmentId?: string
  downloadKind: 'file' | 'requestAttachment'
  storagePath: string
  displayName?: string
  versionNumber?: number
  uploadedAt: string
  entryLabel?: string
}

export interface DriveVersion {
  version: number
  assets: DriveAsset[]
  createdAt: string
}

export interface DriveDocument {
  id: string
  requestId: string
  docName: string
  docStatus: DriveDocStatus
  publicationStatus: 'published' | 'unpublished'
  publicationReason: string
  folderId: string
  folderName: string
  folderOrderIndex: number
  activityName?: string
  uploadedAt: string
  attachments: DriveAsset[]
  versions: DriveVersion[]
  /** Adăugat de stratul de UI — biblioteca nu îl produce. */
  onRowClick?: () => void
}

export interface DriveFolder {
  id: string
  name: string
  documentCount: number
}

// ── Helperi ───────────────────────────────────────────────────────────────────

function getStorageDisplayName(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  return path.split('/').filter(Boolean).pop() || undefined
}

function latestDate(values: Array<string | null | undefined>, fallback: string): string {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  return valid[0] || fallback
}

function getPublication(
  request: DriveSourceRequest,
  phase: DriveSourcePhase | undefined,
): { status: 'published' | 'unpublished'; reason: string } {
  const blockers: string[] = []
  if (request.visibility !== 'published') blockers.push('cererea')

  if (request.activity_id || request.activity) {
    if (request.activity?.visibility !== 'published') blockers.push('activitatea')
    const phaseVisibility = request.activity?.phase?.visibility ?? phase?.visibility
    if (phaseVisibility !== 'published') blockers.push('faza')
  }

  return blockers.length === 0
    ? { status: 'published', reason: '' }
    : { status: 'unpublished', reason: `Nepublicat: ${blockers.join(', ')}` }
}

// ── API ───────────────────────────────────────────────────────────────────────

export function buildDriveDocuments(
  requests: DriveSourceRequest[] = [],
  phases: DriveSourcePhase[] = [],
): DriveDocument[] {
  const phaseById = new Map(phases.map(phase => [phase.id, phase]))

  return requests.flatMap((request): DriveDocument[] => {
    const phaseId = request.activity?.phase_id ?? null
    const phase = phaseId ? phaseById.get(phaseId) : undefined
    const folderId = phase ? `phase:${phase.id}` : 'general'
    const folderName = phase?.name ?? 'General'
    const folderOrderIndex = phase?.order_index ?? Number.MAX_SAFE_INTEGER
    const publication = getPublication(request, phase)

    const attachmentRows: DriveSourceAttachment[] = request.attachments?.length
      ? request.attachments
      : request.attachment_path
      ? [{
          id: `${request.id}_legacy`,
          storage_path: request.attachment_path,
          original_name: request.attachment_original_name || null,
          missing_at: request.attachment_missing_at,
        }]
      : []

    const attachments: DriveAsset[] = attachmentRows
      .filter(attachment => !attachment.missing_at)
      .map((attachment, index) => ({
        id: `${request.id}_attachment_${attachment.id || index}`,
        requestId: request.id,
        attachmentId: attachment.id,
        downloadKind: 'requestAttachment',
        storagePath: attachment.storage_path,
        displayName: attachment.original_name || getStorageDisplayName(attachment.storage_path) || 'Model document',
        uploadedAt: request.created_at,
        entryLabel: request.is_outgoing ? 'Document trimis clientului' : 'Model/atașament cerere',
      }))

    const versionsByNumber = new Map<number, DriveAsset[]>()
    for (const file of request.files ?? []) {
      if (file.deleted_at) continue
      const assets = versionsByNumber.get(file.version_number) ?? []
      assets.push({
        id: `${request.id}_${file.id}`,
        fileId: file.id,
        requestId: request.id,
        downloadKind: 'file',
        storagePath: file.storage_path,
        displayName: file.original_name,
        versionNumber: file.version_number,
        uploadedAt: file.created_at,
        entryLabel: 'Fișier încărcat',
      })
      versionsByNumber.set(file.version_number, assets)
    }

    const versions: DriveVersion[] = Array.from(versionsByNumber.entries())
      .sort(([a], [b]) => b - a)
      .map(([version, assets]) => ({
        version,
        assets,
        createdAt: latestDate(assets.map(asset => asset.uploadedAt), request.created_at),
      }))

    if (attachments.length === 0 && versions.length === 0) return []

    return [{
      id: request.id,
      requestId: request.id,
      docName: request.name,
      docStatus: request.is_outgoing ? 'sent' : request.status,
      publicationStatus: publication.status,
      publicationReason: publication.reason,
      folderId,
      folderName,
      folderOrderIndex,
      activityName: request.activity?.name ?? undefined,
      uploadedAt: latestDate([
        ...attachments.map(asset => asset.uploadedAt),
        ...versions.flatMap(version => version.assets.map(asset => asset.uploadedAt)),
      ], request.created_at),
      attachments,
      versions,
    }]
  })
}

export function buildDriveFolders(
  documents: DriveDocument[] = [],
  phases: DriveSourcePhase[] = [],
): DriveFolder[] {
  const countByFolder = new Map<string, number>()
  documents.forEach(document => {
    countByFolder.set(document.folderId, (countByFolder.get(document.folderId) ?? 0) + 1)
  })

  const folders: DriveFolder[] = [...phases]
    .sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id))
    .map(phase => ({
      id: `phase:${phase.id}`,
      name: phase.name,
      documentCount: countByFolder.get(`phase:${phase.id}`) ?? 0,
    }))

  if (countByFolder.has('general')) {
    folders.push({
      id: 'general',
      name: 'General',
      documentCount: countByFolder.get('general') ?? 0,
    })
  }

  return folders
}
