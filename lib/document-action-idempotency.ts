const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024
export const MAX_UPLOAD_FILES = 50

export function isValidDocumentActionUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export type DocumentActionFailure = {
  status: number
  message: string
}

/**
 * `apiFetch` overwrites `error` on every non-OK response, so the reason a
 * document action was refused only reaches the user through `message` (the
 * convention from #70). These are the P0001 reasons raised inside
 * `review_document_request` and `complete_document_upload_batch`.
 */
const DOCUMENT_ACTION_FAILURES: Record<string, DocumentActionFailure> = {
  'This document version was already reviewed with another action': {
    status: 409,
    message: 'Versiunea aceasta a fost deja verificată cu altă decizie. Reîncarcă pagina ca să vezi rezultatul.',
  },
  'Document request is not ready for review': {
    status: 409,
    message: 'Cererea nu mai este în verificare. Reîncarcă pagina și vezi în ce stare a ajuns.',
  },
  'Notes are required for rejection': {
    status: 400,
    message: 'Scrie motivul respingerii, ca utilizatorul să știe ce să corecteze.',
  },
  'No uploaded files to review': {
    status: 400,
    message: 'Cererea nu are fișiere încărcate de verificat.',
  },
  'Document request not found': {
    status: 404,
    message: 'Cererea nu mai există.',
  },
  'Outgoing document requests do not enter review': {
    status: 400,
    message: 'Documentele trimise clientului nu intră în fluxul de verificare.',
  },
  'Outgoing document requests do not accept uploads': {
    status: 400,
    message: 'Documentele trimise clientului nu acceptă răspunsuri încărcate.',
  },
  'Document request disappeared during review': {
    status: 409,
    message: 'Cererea a fost ștearsă între timp. Reîncarcă pagina.',
  },
  'Document request disappeared during upload': {
    status: 409,
    message: 'Cererea a fost ștearsă între timp. Reîncarcă pagina.',
  },
  'Upload batch already exists with a different file set': {
    status: 409,
    message: 'Încărcarea a fost deja finalizată cu alte fișiere. Reîncarcă pagina și încearcă din nou.',
  },
  'Upload batch contains duplicate storage paths': {
    status: 400,
    message: 'Ai selectat același fișier de două ori. Verifică selecția.',
  },
  'Upload path is outside the document request version directory': {
    status: 400,
    message: 'Fișierele nu au putut fi salvate în dosarul cererii. Reîncarcă pagina și încearcă din nou.',
  },
  'Document upload batch was not inserted completely': {
    status: 500,
    message: 'Încărcarea nu a fost salvată complet. Reîncearcă.',
  },
  'Invalid document upload batch': {
    status: 400,
    message: 'Selecția de fișiere nu este validă. Verifică-o și încearcă din nou.',
  },
}

export function describeDocumentActionFailure(
  rawMessage: string | null | undefined,
  code: string | null | undefined,
): DocumentActionFailure {
  const known = rawMessage && Object.prototype.hasOwnProperty.call(DOCUMENT_ACTION_FAILURES, rawMessage)
    ? DOCUMENT_ACTION_FAILURES[rawMessage]
    : undefined
  if (known) return known
  return code === 'P0001'
    ? { status: 409, message: 'Acțiunea nu a putut fi finalizată. Reîncarcă pagina și încearcă din nou.' }
    : { status: 500, message: 'Nu am putut finaliza acțiunea. Reîncearcă.' }
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
