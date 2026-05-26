/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/_utils/audit.ts
import { createSupabaseServiceClient } from './supabase'

type AuditActionType = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'download'

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

/**
 * Helper generic pentru a scrie o intrare in audit_logs.
 * Sanitizeaza chei sensibile si truncheaza payload-uri peste 32 KB.
 * Nu arunca exceptii — esuarea scrierii este loggata structurat.
 */
export async function logAction(params: LogActionParams): Promise<void> {
  try {
    const admin = createSupabaseServiceClient()

    const ipAddress =
      params.ipAddress ??
      (params.request ? getClientIP(params.request) : 'unknown')
    const userAgent =
      params.userAgent ??
      (params.request ? getUserAgent(params.request) : 'unknown')

    const oldValues = truncatePayload(params.oldValues ?? null)
    const newValues = truncatePayload(params.newValues ?? null)

    const { error } = await admin.from('audit_logs').insert({
      user_id: params.actorId,
      action_type: params.actionType,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      entity_name: params.entityName ?? null,
      old_values: oldValues,
      new_values: newValues,
      description: params.description,
      ip_address: ipAddress,
      user_agent: userAgent,
    })

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