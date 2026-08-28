import { MAX_UPLOAD_FILE_SIZE } from '@/lib/document-action-idempotency'

/**
 * Încărcarea răspunsului clientului la o cerere de document. Aceleași reguli și
 * aceiași pași, indiferent de unde pornește: panoul din pagina proiectului sau
 * modalul cererii. Cât timp erau două copii, un fișier putea fi refuzat într-un
 * loc și acceptat în celălalt.
 */

export { MAX_UPLOAD_FILE_SIZE }

export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]

export const ALLOWED_UPLOAD_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp',
]

export type UploadValidationError = {
  type: 'size' | 'type' | 'duplicate'
  message: string
}

/** Ce știe modulul despre un fișier ales. Componentele adaugă restul (progres, stare). */
export type ClientUploadCandidate = {
  id: string
  file: File
  name: string
  size: number
  type: string
  relativePath: string | null
}

/** Fișierele urcate, păstrate până la confirmare, ca un retry să nu le urce din nou. */
export type PendingClientUploadCompletion = {
  requestId: string
  batchId: string
  fileIds: string[]
  failed: number
}

export type ClientUploadOutcome = {
  total: number
  successful: number
  failed: number
}

export type ClientUploadFileState =
  | { status: 'uploading' }
  | { status: 'success' }
  | { status: 'error'; message: string }

type ApiFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>

type ClientUploadInit = {
  batchId: string
  uploads: {
    fileId: string
    clientFileId: number
    signedUploadUrl: string
    token: string
    storagePath: string
  }[]
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${parseFloat((bytes / 1024 ** index).toFixed(1))} ${units[index]}`
}

export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

export function isAllowedUploadFile(file: { name: string; type: string }): boolean {
  return ALLOWED_UPLOAD_TYPES.includes(file.type) ||
    ALLOWED_UPLOAD_EXTENSIONS.includes(getFileExtension(file.name))
}

export function validateUploadFile(
  file: File,
  existingFiles: readonly { name: string; size: number }[] = [],
): UploadValidationError | null {
  if (file.size > MAX_UPLOAD_FILE_SIZE) {
    return { type: 'size', message: `Fișierul depășește ${formatFileSize(MAX_UPLOAD_FILE_SIZE)}` }
  }
  if (!isAllowedUploadFile(file)) {
    return { type: 'type', message: 'Tip de fișier nepermis' }
  }
  if (existingFiles.some(existing => existing.name === file.name && existing.size === file.size)) {
    return { type: 'duplicate', message: 'Fișier duplicat' }
  }
  return null
}

/** `apiFetch` rescrie `error`; motivul real al serverului vine în `message`. */
async function failureMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null)
  return (typeof body?.message === 'string' && body.message) || fallback
}

async function completeClientUpload(apiFetch: ApiFetch, pending: PendingClientUploadCompletion) {
  const res = await apiFetch(`/api/document-requests/${pending.requestId}/uploads/complete`, {
    method: 'POST',
    body: JSON.stringify({
      batchId: pending.batchId,
      fileIds: pending.fileIds,
    }),
  })
  if (!res.ok) throw new Error(await failureMessage(res, 'Nu am putut finaliza încărcarea fișierelor.'))
}

/**
 * Init → PUT-uri în paralel → confirmare. Când confirmarea e singura care a
 * eșuat, `onPending` a primit deja payload-ul: următoarea apăsare îl retrimite
 * fără să reurce nimic.
 */
export async function runClientUpload(options: {
  apiFetch: ApiFetch
  requestId: string
  files: readonly ClientUploadCandidate[]
  pending: PendingClientUploadCompletion | null
  onPending: (pending: PendingClientUploadCompletion | null) => void
  onFileState?: (id: string, state: ClientUploadFileState) => void
}): Promise<ClientUploadOutcome> {
  const { apiFetch, requestId, files, pending, onPending, onFileState } = options

  if (pending) {
    await completeClientUpload(apiFetch, pending)
    onPending(null)
    return {
      total: pending.fileIds.length + pending.failed,
      successful: pending.fileIds.length,
      failed: pending.failed,
    }
  }

  if (files.length === 0) throw new Error('Niciun fișier valid de încărcat.')

  const initRes = await apiFetch(`/api/document-requests/${requestId}/uploads/init`, {
    method: 'POST',
    body: JSON.stringify({
      files: files.map(file => ({
        name: file.name,
        size: file.size,
        type: file.type,
        relativePath: file.relativePath,
      })),
    }),
  })
  if (!initRes.ok) throw new Error(await failureMessage(initRes, 'Nu am putut inițializa încărcarea fișierelor.'))
  const init = await initRes.json().catch(() => null) as ClientUploadInit | null
  if (!init?.uploads?.length) throw new Error('Nu am putut inițializa încărcarea fișierelor.')

  const results = await Promise.all(init.uploads.map(async upload => {
    const candidate = files[upload.clientFileId]
    onFileState?.(candidate.id, { status: 'uploading' })
    try {
      const res = await fetch(upload.signedUploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${upload.token}`,
          'Content-Type': candidate.type,
        },
        body: candidate.file,
      })
      if (!res.ok) throw new Error('Încărcarea fișierului a eșuat.')
      onFileState?.(candidate.id, { status: 'success' })
      return { success: true as const, upload, candidate }
    } catch {
      onFileState?.(candidate.id, { status: 'error', message: 'Încărcarea fișierului a eșuat. Reîncearcă.' })
      return { success: false as const, upload, candidate }
    }
  }))

  const successful = results.filter(result => result.success)
  const failures = results.filter(result => !result.success)
  if (successful.length === 0) throw new Error('Toate fișierele au eșuat la încărcare.')

  const completion: PendingClientUploadCompletion = {
    requestId,
    batchId: init.batchId,
    fileIds: successful.map(result => result.upload.fileId),
    failed: failures.length,
  }
  onPending(completion)
  await completeClientUpload(apiFetch, completion)
  onPending(null)

  return {
    total: results.length,
    successful: successful.length,
    failed: failures.length,
  }
}
