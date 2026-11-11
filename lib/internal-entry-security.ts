import type { AppProfile } from '@/app/api/_utils/auth'
import { ALLOWED_UPLOAD_EXTENSIONS, getFileExtension } from './upload-file-types.ts'

export const INTERNAL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
export const INTERNAL_ENTRY_TITLE_MAX_LENGTH = 200
export const INTERNAL_ENTRY_BODY_MAX_LENGTH = 50_000

export const INTERNAL_CONTEXT_FIELDS = [
  'phase_id',
  'activity_id',
  'document_requirement_id',
] as const

export type InternalContextField = typeof INTERNAL_CONTEXT_FIELDS[number]

export type InternalEntryInput = {
  title?: string
  body?: string
} & Partial<Record<InternalContextField, string | null>>

export type InternalEntryOwner = { created_by: string | null }

export function canEditInternalEntry(
  profile: Pick<AppProfile, 'id' | 'role' | 'consultant_level'>,
  entry: InternalEntryOwner,
) {
  return profile.role === 'admin' ||
    (profile.role === 'consultant' && (profile.consultant_level === 'senior' || entry.created_by === profile.id))
}

export function parseInternalEntryInput(value: unknown, partial = false):
  | { ok: true; value: InternalEntryInput }
  | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Invalid JSON body' }
  }

  const body = value as Record<string, unknown>
  const allowed = new Set<string>(['title', 'body', ...INTERNAL_CONTEXT_FIELDS])
  if (Object.keys(body).some(key => !allowed.has(key))) {
    return { ok: false, error: 'Request contains unsupported fields' }
  }
  if (!partial && (typeof body.title !== 'string' || !body.title.trim())) {
    return { ok: false, error: 'Title is required' }
  }
  if (body.title !== undefined &&
      (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > INTERNAL_ENTRY_TITLE_MAX_LENGTH)) {
    return { ok: false, error: 'Title must be 1 to 200 characters' }
  }
  if (body.body !== undefined &&
      (typeof body.body !== 'string' || body.body.length > INTERNAL_ENTRY_BODY_MAX_LENGTH)) {
    return { ok: false, error: 'Body must be a string of at most 50000 characters' }
  }

  const parsed: InternalEntryInput = {}
  if (body.title !== undefined) parsed.title = (body.title as string).trim()
  if (body.body !== undefined) parsed.body = body.body as string

  let selectedContexts = 0
  for (const field of INTERNAL_CONTEXT_FIELDS) {
    const contextId = body[field]
    if (contextId === undefined) continue
    if (contextId !== null && (typeof contextId !== 'string' || !UUID.test(contextId))) {
      return { ok: false, error: `${field} must be a UUID or null` }
    }
    if (contextId !== null) selectedContexts += 1
    parsed[field] = contextId as string | null
  }

  if (selectedContexts > 1) {
    return { ok: false, error: 'Choose at most one context' }
  }
  return { ok: true, value: parsed }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isInternalEntryUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function resolveInternalEntryContext(
  current: Pick<InternalEntryInput, InternalContextField>,
  changes: Pick<InternalEntryInput, InternalContextField>,
) {
  const context = Object.fromEntries(
    INTERNAL_CONTEXT_FIELDS.map(field => [field, changes[field] === undefined ? current[field] ?? null : changes[field]]),
  ) as Record<InternalContextField, string | null>
  return Object.values(context).filter(Boolean).length <= 1 ? context : null
}

export function normalizeInternalAttachmentName(name: string) {
  const filename = name.replaceAll('\\', '/').split('/').pop() ?? ''
  return filename.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
}

export function isAllowedInternalAttachmentName(name: string) {
  return ALLOWED_UPLOAD_EXTENSIONS.includes(getFileExtension(name))
}

export function parseInternalAttachmentInput(value: unknown):
  | { ok: true; value: { originalName: string; mimeType: string; fileSize: number } }
  | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Invalid JSON body' }
  }
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !['originalName', 'mimeType', 'fileSize'].includes(key))) {
    return { ok: false, error: 'Request contains unsupported fields' }
  }
  if (typeof body.originalName !== 'string') return { ok: false, error: 'originalName is required' }
  const originalName = normalizeInternalAttachmentName(body.originalName)
  if (!originalName) return { ok: false, error: 'originalName is required' }
  if (typeof body.mimeType !== 'string' || body.mimeType.length > 255) {
    return { ok: false, error: 'mimeType must be a string of at most 255 characters' }
  }
  if (!isAllowedInternalAttachmentName(originalName)) {
    return { ok: false, error: 'Tip de fișier nepermis' }
  }
  if (typeof body.fileSize !== 'number' || !Number.isSafeInteger(body.fileSize) ||
      body.fileSize < 0 || body.fileSize > INTERNAL_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: 'fileSize must be between 0 and 26214400 bytes' }
  }
  return {
    ok: true,
    value: {
      originalName,
      mimeType: body.mimeType.trim() || 'application/octet-stream',
      fileSize: body.fileSize,
    },
  }
}
