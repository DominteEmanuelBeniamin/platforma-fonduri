const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024

export function isValidDocumentActionUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function hasDuplicateUploadPaths(paths: string[]): boolean {
  return new Set(paths).size !== paths.length
}

export function isValidUploadFileSize(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_UPLOAD_FILE_SIZE
  )
}

export function isValidUploadStoragePath(
  storagePath: string,
  projectId: string,
  requestId: string,
  versionNumber: number,
): boolean {
  const prefix = `projects/${projectId}/document-requests/${requestId}/v${versionNumber}/`
  const suffix = storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : ''
  return Boolean(suffix) &&
    !suffix.startsWith('/') &&
    !suffix.endsWith('/') &&
    !suffix.includes('//') &&
    suffix.split('/').every(segment => segment !== '.' && segment !== '..')
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
