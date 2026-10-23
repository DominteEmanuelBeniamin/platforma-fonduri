import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'
import type { AuditLog } from '@/lib/database.types'

type AuditLogRow = AuditLog & { user_agent?: string | null }

/**
 * GET /api/audit
 * 
 * Query params:
 * - action_type: 'login' | 'logout' | 'create' | 'update' | 'delete'
 * - entity_type: 'user' | 'project' | 'document' | 'phase' | 'activity'
 * - user_id: UUID al utilizatorului
 * - from_date: ISO date string (data de început)
 * - to_date: ISO date string (data de sfârșit)
 * - search: text de căutare (#112) în descriere, entitate, autor și utilizatorul
 *   afectat, cu regulile din `lib/search.ts` (fără diacritice, orice ordine, greșeli mici)
 * - page: numărul paginii (default 1)
 * - limit: numărul de rezultate per pagină (default 50, max 100)
 * 
 * Returnează lista de audit logs cu paginare.
 * Doar adminii pot accesa acest endpoint.
 */
export async function GET(request: Request) {
  try {
    // Verificăm că utilizatorul este admin
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const { searchParams } = new URL(request.url)
    
    // Parametri de filtrare
    const actionType = searchParams.get('action_type')
    const entityType = searchParams.get('entity_type')
    const entityId = searchParams.get('entity_id')
    const userId = searchParams.get('user_id')
    const fromDate = searchParams.get('from_date')
    const toDate = searchParams.get('to_date')
    const search = searchParams.get('search')
    
    // Parametri de paginare
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const offset = (page - 1) * limit

    const admin = createSupabaseServiceClient()

    // Data de sfârșit include toată ziua.
    const endDate = toDate ? new Date(toDate) : null
    endDate?.setDate(endDate.getDate() + 1)

    let logs: AuditLogRow[] | null
    let count: number | null

    if (search?.trim()) {
      // Căutarea se face în DB (`search_audit_log_ids`), cu aceleași reguli ca
      // în interfață; ordinea vine de acolo: potrivirile exacte, apoi cele noi.
      const { data: matched, error: searchError } = await admin.rpc('search_audit_log_ids', {
        p_query: search,
        p_action_type: actionType,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_user_id: userId,
        p_from: fromDate,
        p_to: endDate?.toISOString() ?? null,
        p_limit: limit,
        p_offset: offset,
      })
      if (searchError) {
        console.error('Audit logs search error:', searchError)
        return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
      }
      const rows = (matched ?? []) as { id: string; total: number }[]
      const ids = rows.map(row => row.id)
      count = rows[0]?.total ?? 0
      if (ids.length === 0) {
        logs = []
      } else {
        const { data, error } = await admin.from('audit_logs').select('*').in('id', ids)
        if (error) {
          console.error('Audit logs fetch error:', error)
          return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
        }
        const byId = new Map(((data ?? []) as AuditLogRow[]).map(log => [log.id, log]))
        logs = ids.map(id => byId.get(id)).filter((log): log is AuditLogRow => Boolean(log))
      }
    } else {
      let query = admin
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (actionType) query = query.eq('action_type', actionType)
      if (entityType) query = query.eq('entity_type', entityType)
      if (entityId) query = query.eq('entity_id', entityId)
      if (userId) query = query.eq('user_id', userId)
      if (fromDate) query = query.gte('created_at', fromDate)
      if (endDate) query = query.lt('created_at', endDate.toISOString())

      const result = await query.range(offset, offset + limit - 1)
      if (result.error) {
        console.error('Audit logs fetch error:', result.error)
        return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
      }
      logs = result.data
      count = result.count
    }

    const userIds = [...new Set((logs || []).map(log => log.user_id).filter((id): id is string => Boolean(id)))]
    const { data: profiles, error: profilesError } = userIds.length
      ? await admin.from('profiles').select('id, email, full_name, is_active').in('id', userIds)
      : { data: [], error: null }
    if (profilesError) {
      console.error('Audit users fetch error:', profilesError)
      return NextResponse.json({ error: 'Failed to fetch audit users' }, { status: 500 })
    }
    const usersById = new Map((profiles || []).map(profile => [profile.id, profile]))
    // Preserve existing rows; recover missing auth-event email from the atomic deletion snapshot.
    const snapshotIds = [...new Set((logs || [])
      .filter(log => !usersById.has(log.user_id ?? '') && !log.entity_name?.trim()
        && log.entity_type === 'user' && (log.action_type === 'login' || log.action_type === 'logout')
        && (log.entity_id === log.user_id || log.entity_id === null))
      .map(log => log.user_id).filter((id): id is string => Boolean(id)))]
    const { data: deletedAccounts, error: snapshotError } = snapshotIds.length
      ? await admin.from('audit_logs').select('entity_id, old_values')
        .eq('action_type', 'delete').eq('entity_type', 'user').in('entity_id', snapshotIds)
        .order('created_at', { ascending: false })
      : { data: [], error: null }
    if (snapshotError) {
      console.error('Historical audit users fetch error:', snapshotError)
      return NextResponse.json({ error: 'Failed to fetch historical audit users' }, { status: 500 })
    }
    const actorEmails = new Map<string, string>()
    for (const row of deletedAccounts || []) {
      const snapshot = row.old_values
      if (row.entity_id && snapshot?.id === row.entity_id && typeof snapshot.email === 'string'
        && !actorEmails.has(row.entity_id)) actorEmails.set(row.entity_id, snapshot.email)
    }

    // Calculăm informațiile de paginare
    const totalPages = Math.ceil((count || 0) / limit)

    return NextResponse.json({
      logs: (logs || []).map(log => ({
        ...log,
        user: usersById.get(log.user_id ?? '') ?? null,
        actor_email: actorEmails.get(log.user_id ?? '') ?? null,
      })),
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    })

  } catch (e: unknown) {
    const error = e as Error
    console.error('GET /api/audit error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}

/**
 * POST /api/audit
 * 
 * Body: { action: 'stats' }
 * Returnează statistici generale despre audit logs.
 */
export async function POST(request: Request) {
  try {
    // Verificăm că utilizatorul este admin
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const body = await request.json().catch(() => null)
    
    if (body?.action === 'stats') {
      const admin = createSupabaseServiceClient()

      // Agregat în DB, nu rând cu rând: citite prin PostgREST, statisticile se
      // opreau tăcut la lotul implicit de 1000, iar pe un jurnal de câteva mii
      // de intrări „Autentificări" și „Modificări" ajungeau să arate 0.
      const { data: counts, error: countsError } = await admin.rpc('audit_log_counts')
      if (countsError || !counts) {
        console.error('[audit_log_failure]', { op: 'stats', error: countsError?.message })
        return NextResponse.json({
          error: 'Statisticile nu pot fi calculate: aplică migrarea audit_contract_probes.',
        }, { status: 503 })
      }

      const stats = counts as {
        total?: number
        recent?: number
        by_action?: Record<string, number>
        by_entity?: Record<string, number>
      }

      return NextResponse.json({
        totalLogs: stats.total ?? 0,
        recentLogs: stats.recent ?? 0,
        byAction: stats.by_action ?? {},
        byEntity: stats.by_entity ?? {},
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  } catch (e: unknown) {
    const error = e as Error
    console.error('POST /api/audit error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}