/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/_utils/audit.ts
import { createSupabaseServiceClient } from './supabase'

type AuditActionType = 'create' | 'update' | 'delete' | 'login' | 'logout'

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

export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  
  const realIP = request.headers.get('x-real-ip')
  if (realIP) return realIP
  
  return 'unknown'
}

/**
 * Helper pentru a extrage User Agent
 */
export function getUserAgent(request: Request): string {
  return request.headers.get('user-agent') || 'unknown'
}