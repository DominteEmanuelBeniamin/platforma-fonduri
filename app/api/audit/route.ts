import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'

/**
 * GET /api/audit
 * 
 * Query params:
 * - action_type: 'login' | 'logout' | 'create' | 'update' | 'delete'
 * - entity_type: 'user' | 'project' | 'document' | 'phase' | 'activity'
 * - user_id: UUID al utilizatorului
 * - from_date: ISO date string (data de început)
 * - to_date: ISO date string (data de sfârșit)
 * - search: text de căutare în description sau entity_name
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

    // Construim query-ul
    let query = admin
      .from('audit_logs')
      .select(`
        *,
        user:profiles!audit_logs_user_id_fkey(email, full_name)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })

    // Aplicăm filtrele
    if (actionType) {
      query = query.eq('action_type', actionType)
    }

    if (entityType) {
      query = query.eq('entity_type', entityType)
    }

    if (entityId) {
      query = query.eq('entity_id', entityId)
    }

    if (userId) {
      query = query.eq('user_id', userId)
    }

    if (fromDate) {
      query = query.gte('created_at', fromDate)
    }

    if (toDate) {
      // Adăugăm o zi pentru a include toată ziua
      const endDate = new Date(toDate)
      endDate.setDate(endDate.getDate() + 1)
      query = query.lt('created_at', endDate.toISOString())
    }

    if (search) {
      // Căutăm în description sau entity_name
      query = query.or(`description.ilike.%${search}%,entity_name.ilike.%${search}%`)
    }

    // Aplicăm paginarea
    query = query.range(offset, offset + limit - 1)

    const { data: logs, error, count } = await query

    if (error) {
      console.error('Audit logs fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
    }

    // Calculăm informațiile de paginare
    const totalPages = Math.ceil((count || 0) / limit)

    return NextResponse.json({
      logs: logs || [],
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