const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024
export const MAX_UPLOAD_FILES = 50

export function isValidDocumentActionUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function normalizeUploadFileIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_UPLOAD_FILES) return null
  if (value.some(fileId => !isValidDocumentActionUuid(fileId))) return null
  const ids = [...value] as string[]
  if (new Set(ids).size !== ids.length) return null
  return ids.sort()
}

export type ReviewDecision = 'new' | 'retry' | 'conflict' | 'status-invalid'

export function decideReview(
  status: string,
  requestedAction: 'approved' | 'rejected',
  existingAction: 'approved' | 'rejected' | null,
): ReviewDecision {
  if (existingAction === requestedAction) return 'retry'
  if (existingAction) return 'conflict'
  return status === 'review' ? 'new' : 'status-invalid'
}
