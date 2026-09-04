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

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'signed_url',
  'signature',
  'secret',
  'api_key',
])

const MAX_PAYLOAD_BYTES = 32 * 1024

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(sanitize)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = '[redacted]'
      } else {
        out[k] = sanitize(v)
      }
    }
    return out
  }
  return value
}

function truncatePayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!payload) return null
  const cleaned = sanitize(payload) as Record<string, unknown>
  try {
    const serialized = JSON.stringify(cleaned)
    if (serialized.length <= MAX_PAYLOAD_BYTES) return cleaned
    return {
      _truncated: true,
      _original_size: serialized.length,
      _preview: serialized.slice(0, 1024),
    }
  } catch {
    return { _truncated: true, _serialization_failed: true }
  }
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
function auditRow(params: LogActionParams) {
  return {
    user_id: params.actorId,
    action_type: params.actionType,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    entity_name: params.entityName ?? null,
    old_values: truncatePayload(params.oldValues ?? null),
    new_values: truncatePayload(params.newValues ?? null),
    description: params.description,
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
  userEmail: string
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
  try {
    const admin = createSupabaseServiceClient()
    
    const { error } = await admin.from('audit_logs').insert({
      user_id: params.adminId,
      action_type: params.actionType,
      entity_type: 'user',
      entity_id: params.userId,
      entity_name: params.userEmail,
      old_values: params.oldValues || null,
      new_values: params.newValues || null,
      description: params.description,
      ip_address: params.ipAddress,
      user_agent: params.userAgent
    })

    if (error) {
      console.error('❌ Audit log failed:', error)
    }
  } catch (e) {
    console.error('❌ Audit log exception:', e)
  }
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
  try {
    const admin = createSupabaseServiceClient()
    
    const { error } = await admin.from('audit_logs').insert({
      user_id: params.adminId,
      action_type: params.actionType,
      entity_type: 'project',
      entity_id: params.projectId,
      entity_name: params.projectTitle,
      old_values: params.oldValues || null,
      new_values: params.newValues || null,
      description: params.description,
      ip_address: params.ipAddress,
      user_agent: params.userAgent
    })

    if (error) {
      console.error('❌ Audit log (project) failed:', error)
    }
  } catch (e) {
    console.error('❌ Audit log (project) exception:', e)
  }
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
 * Salvează o acțiune pe mesaje (chat) în audit_logs
 * entity_type: 'chat_message' (text liber)
 * entity_id: messageId
 * entity_name: preview (sau fallback)
 */
export async function logChatMessageAction(params: LogChatMessageActionParams) {
  try {
    const admin = createSupabaseServiceClient()

    const entityName =
      (params.messagePreview && params.messagePreview.trim()) ||
      `message:${params.messageId}`

    const { error } = await admin.from('audit_logs').insert({
      user_id: params.actorId,
      action_type: params.actionType,
      entity_type: 'chat_message',
      entity_id: params.messageId,
      entity_name: entityName,
      old_values: params.oldValues || null,
      new_values: params.newValues || null,
      description: params.description,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
    })

    if (error) {
      console.error('❌ Audit log (chat_message) failed:', error)
    }
  } catch (e) {
    console.error('❌ Audit log (chat_message) exception:', e)
  }
}


// Helper: preview sigur pentru mesaj (nu logăm gigantic)
export function toMessagePreview(body: string | null | undefined, maxLen = 200) {
  if (!body) return null
  const s = String(body).trim()
  if (!s) return null
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '…'
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
