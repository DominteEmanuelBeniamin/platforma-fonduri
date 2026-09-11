/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/_utils/audit.ts
import { createSupabaseServiceClient } from './supabase.ts'

type AuditActionType =
  | 'create'
  | 'add'
  | 'update'
  | 'delete'
  | 'publish'
  | 'propagate'
  | 'login'
  | 'logout'
  | 'download'

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * Compara `before` (snapshot complet) cu `update` (campurile trimise spre PATCH)
 * si returneaza doar cheile cu valoare diferita. `null`/`undefined` sunt
 * tratate echivalent, ca sa nu marchezi un PATCH no-op drept modificare.
 */
export function computeDiff(
  before: Record<string, any> | null | undefined,
  update: Record<string, any> | null | undefined,
): {
  oldValues: Record<string, any> | null
  newValues: Record<string, any> | null
  changedKeys: string[]
  isEmpty: boolean
} {
  if (!update) return { oldValues: null, newValues: null, changedKeys: [], isEmpty: true }
  const oldValues: Record<string, any> = {}
  const newValues: Record<string, any> = {}
  const changedKeys: string[] = []
  for (const key of Object.keys(update)) {
    const oldVal = before ? before[key] : undefined
    const newVal = update[key]
    const oNorm = oldVal === undefined ? null : oldVal
    const nNorm = newVal === undefined ? null : newVal
    if (!deepEqual(oNorm, nNorm)) {
      changedKeys.push(key)
      oldValues[key] = oldVal ?? null
      newValues[key] = newVal ?? null
    }
  }
  return {
    oldValues: changedKeys.length > 0 ? oldValues : null,
    newValues: changedKeys.length > 0 ? newValues : null,
    changedKeys,
    isEmpty: changedKeys.length === 0,
  }
}

const REDACTED_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'signed_url',
  'signature',
  'secret',
  'api_key',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'private_key',
  'encryption_key',
  'signing_key',
])

const OMITTED_KEYS = [
  /(?:^|_)(?:body|preview|content)(?:_|$)/,
  /^(?:message|message_body|message_preview)$/,
  /(?:^|_)(?:file|image|attachment)(?:_|)(?:name|names|name_list)$/,
  /^(?:files|file_list|file_names|image_names)$/,
  /^(?:original_name|attachment_original_name|storage_path|attachment_path|file_path|image_path|relative_path|zip_name|archive_name)$/,
  /^(?:description|comment|comments|note|notes|observations|observatii)$/,
  /(?:^|_)(?:email|e_mail|phone|telephone|telefon|mobile|fax|address|adresa|postal|zip|postcode|cnp|ssn|tax_id|iban|bank|account|routing|swift|cif|cui)(?:_|$)/,
  /^(?:full_name|fullname|company|company_name|company_contact|firm_name|nume|nume_complet|nume_prenume|nume_persoana|nume_contact|nume_firma|contact|contact_name|contact_person|contact_email|contact_phone|persoana_contact)$/,
]

const MAX_PAYLOAD_BYTES = 32 * 1024

function normalizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[-\s]/g, '_')
}

function shouldOmitKey(key: string) {
  const normalized = normalizeKey(key)
  return normalized.endsWith('_reason') || OMITTED_KEYS.some(pattern => pattern.test(normalized))
}

export function sanitizeAuditPayload(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(sanitizeAuditPayload)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeKey(k)
      if (REDACTED_KEYS.has(normalized) || normalized.endsWith('_token') || normalized.endsWith('_secret')) {
        out[k] = '[redacted]'
      } else if (shouldOmitKey(k)) {
        continue
      } else {
        out[k] = sanitizeAuditPayload(v)
      }
    }
    return out
  }
  return value
}

export function truncatePayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!payload) return null
  const cleaned = sanitizeAuditPayload(payload) as Record<string, unknown>
  try {
    const serialized = JSON.stringify(cleaned)
    const size = new TextEncoder().encode(serialized).byteLength
    if (size <= MAX_PAYLOAD_BYTES) return cleaned
    return {
      _truncated: true,
      _original_size: size,
    }
  } catch {
    return { _truncated: true, _serialization_failed: true }
  }
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const TOKEN_PATTERN = /\bBearer\s+[A-Z0-9._~+/=-]+|\b(?:token|secret|api[_-]?key|authorization)\s*[:=]\s*[A-Z0-9._~+/=-]+|\beyJ[A-Z0-9_-]{10,}\.[A-Z0-9._-]{10,}\.[A-Z0-9._-]{10,}\b|\b(?![0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b)(?=[A-Z0-9_-]{32,}\b)(?=[A-Z0-9_-]*\d)(?=[A-Z0-9_-]*[A-Z])[A-Z0-9_-]{32,}\b/gi

function maskEmail() {
  return '[email redacted]'
}

export function sanitizeAuditText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const maskedEmail = value.replace(EMAIL_PATTERN, maskEmail)
  return maskedEmail.replace(TOKEN_PATTERN, match =>
    /^bearer\s/i.test(match) ? 'Bearer [token redacted]' : '[token redacted]'
  )
}

export interface LogActionParams {
  actorId: string | null
  actionType: AuditActionType | string
  entityType: string
  entityId?: string | null
  entityName?: string | null
  oldValues?: Record<string, any> | null
  newValues?: Record<string, any> | null
  description: string
  request?: Request
  ipAddress?: string
  userAgent?: string
}

/** Rândul de audit_logs pentru o acțiune, cu payload-urile deja curățate. */
export function auditRow(params: LogActionParams) {
  return {
    user_id: params.actorId,
    action_type: params.actionType,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    entity_name: sanitizeAuditText(params.entityName),
    old_values: truncatePayload(params.oldValues ?? null),
    new_values: truncatePayload(params.newValues ?? null),
    description: sanitizeAuditText(params.description),
    ip_address:
      params.ipAddress ??
      (params.request ? getClientIP(params.request) : 'unknown'),
    user_agent:
      params.userAgent ??
      (params.request ? getUserAgent(params.request) : 'unknown'),
  }
}

/**
 * Scrie mai multe intrari deodata: un singur insert, nu unul per element.
 * Duplicarea unei faze mari producea peste o suta de inserturi secventiale
 * inainte de raspuns, deci userul astepta auditul mai mult decat copierea.
 *
 * Insertul in bloc e totul-sau-nimic, asa ca la eroare se reincearca rand cu
 * rand: un singur rand refuzat n-are voie sa stearga restul istoricului. Ca si
 * `logAction`, nu arunca — auditul nu blocheaza operatia pe care o descrie.
 */
export async function logActions(entries: LogActionParams[]): Promise<void> {
  if (entries.length === 0) return
  if (entries.length === 1) return logAction(entries[0])

  try {
    const admin = createSupabaseServiceClient()
    const { error } = await admin.from('audit_logs').insert(entries.map(auditRow))
    if (!error) return

    console.error('[audit_log_failure]', {
      batch: entries.length,
      error: error.message,
      retry: 'per rand',
    })
    await Promise.all(entries.map(entry => logAction(entry)))
  } catch (e) {
    const err = e as Error
    console.error('[audit_log_failure]', {
      batch: entries.length,
      error: err?.message ?? String(e),
    })
  }
}

/**
 * Helper generic pentru a scrie o intrare in audit_logs.
 * Sanitizeaza chei sensibile si truncheaza payload-uri peste 32 KB.
 * Nu arunca exceptii — esuarea scrierii este loggata structurat.
 */
export async function logAction(params: LogActionParams): Promise<void> {
  try {
    const admin = createSupabaseServiceClient()

    const { error } = await admin.from('audit_logs').insert(auditRow(params))

    if (error) {
      console.error('[audit_log_failure]', {
        entityType: params.entityType,
        entityId: params.entityId,
        error: error.message,
      })
    }
  } catch (e) {
    const err = e as Error
    console.error('[audit_log_failure]', {
      entityType: params.entityType,
      entityId: params.entityId,
      error: err?.message ?? String(e),
    })
  }
}

interface LogUserActionParams {
  adminId: string
  actionType: AuditActionType
  userId: string
  /** Kept for compatibility with older callers; never written to audit_logs. */
  userEmail?: string
  oldValues?: Record<string, any> | null
  newValues?: Record<string, any> | null
  description: string
  ipAddress: string
  userAgent: string
}

/**
 * Salvează o acțiune în audit_logs
 */
export async function logUserAction(params: LogUserActionParams) {
  return logAction({
    actorId: params.adminId,
    actionType: params.actionType,
    entityType: 'user',
    entityId: params.userId,
    entityName: `user:${params.userId}`,
    oldValues: params.oldValues,
    newValues: params.newValues,
    description: params.description,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })
}

interface LogProjectActionParams {
  adminId: string
  actionType: AuditActionType
  projectId: string
  projectTitle: string
  oldValues?: Record<string, any> | null
  newValues?: Record<string, any> | null
  description: string
  ipAddress: string
  userAgent: string
}

/**
 * Salvează o acțiune pe proiect în audit_logs
 */
export async function logProjectAction(params: LogProjectActionParams) {
  return logAction({
    actorId: params.adminId,
    actionType: params.actionType,
    entityType: 'project',
    entityId: params.projectId,
    entityName: params.projectTitle,
    oldValues: params.oldValues,
    newValues: params.newValues,
    description: params.description,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })
} 

interface LogChatMessageActionParams {
  actorId: string
  actionType: Extract<AuditActionType, 'update' | 'delete' | 'create'>
  projectId: string
  messageId: string
  messagePreview?: string | null
  oldValues?: Record<string, any> | null
  newValues?: Record<string, any> | null
  description: string
  ipAddress: string
  userAgent: string
}

/**
 * Salvează o acțiune pe mesaje (chat) în audit_logs. `messagePreview` is kept
 * in the public shape for old callers but is deliberately ignored.
 */
export async function logChatMessageAction(params: LogChatMessageActionParams) {
  return logAction({
    actorId: params.actorId,
    actionType: params.actionType,
    entityType: 'chat_message',
    entityId: params.messageId,
    entityName: `message:${params.messageId}`,
    oldValues: params.oldValues,
    newValues: params.newValues,
    description: params.description,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })
}

export function getClientIP(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip')
  if (cf) return cf.trim()

  const realIP = request.headers.get('x-real-ip')
  if (realIP) return realIP.trim()

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  return 'unknown'
}

/**
 * Helper pentru a extrage User Agent
 */
export function getUserAgent(request: Request): string {
  return request.headers.get('user-agent') || 'unknown'
}
