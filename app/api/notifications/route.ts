/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { guardToResponse, requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  isUuid,
} from '@/lib/notification-utils'
import { NOTIFICATION_TYPES } from '@/lib/notification-display'

const PAGE_SIZE = 40

function parseUnreadOnly(value: string | null): boolean | null {
  if (value === null) return false
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return null
}

// Clopoțelul cere o listă scurtă, pagina cere o pagină întreagă. Plafonul
// rămâne al serverului: un `limit` din query string nu are voie să ceară
// oricâte rânduri.
function parseLimit(value: string | null): number | null {
  if (value === null) return PAGE_SIZE
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (parsed < 1 || parsed > PAGE_SIZE) return null
  return parsed
}

export async function GET(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return guardToResponse(ctx)

  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId')
  if (projectId !== null && !isUuid(projectId)) {
    return NextResponse.json({ error: 'projectId must be a UUID' }, { status: 400 })
  }

  const type = url.searchParams.get('type')
  if (type !== null && !NOTIFICATION_TYPES.includes(type as any)) {
    return NextResponse.json(
      { error: `type must be one of ${NOTIFICATION_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const unreadOnly = parseUnreadOnly(url.searchParams.get('unreadOnly'))
  if (unreadOnly === null) {
    return NextResponse.json({ error: 'unreadOnly must be true or false' }, { status: 400 })
  }

  const limit = parseLimit(url.searchParams.get('limit'))
  if (limit === null) {
    return NextResponse.json({ error: `limit must be between 1 and ${PAGE_SIZE}` }, { status: 400 })
  }

  const cursorValue = url.searchParams.get('cursor')
  const cursor = decodeNotificationCursor(cursorValue)
  if (cursorValue !== null && !cursor) {
    return NextResponse.json({ error: 'Invalid notification cursor' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient(request)
  let query = supabase
    .from('notifications')
    .select('id, project_id, type, severity, entity_type, entity_id, title, actor_name, actor_id, entity_label, item_count, created_at, read_at, project:project_id(title)')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (projectId) query = query.eq('project_id', projectId)
  if (type) query = query.eq('type', type)
  if (unreadOnly) query = query.is('read_at', null)
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) {
    console.error('GET /api/notifications error:', error)
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
  }

  const rows = (data ?? []) as any[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const actorIds = [...new Set(page
    .map(row => row.actor_id)
    .filter((id): id is string => typeof id === 'string' && isUuid(id)))]
  let activeByActorId = new Map<string, boolean>()
  if (actorIds.length > 0) {
    const admin = createSupabaseServiceClient()
    const { data: actors, error: actorsError } = await admin
      .from('profiles')
      .select('id, is_active')
      .in('id', actorIds)

    if (actorsError) {
      console.error('GET /api/notifications actor-state lookup failed:', actorsError)
      return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
    }
    activeByActorId = new Map((actors ?? []).map((actor: any) => [actor.id, actor.is_active === true]))
  }

  const items = page.map(row => ({
    id: row.id,
    projectId: row.project_id,
    projectTitle: Array.isArray(row.project) ? row.project[0]?.title ?? null : row.project?.title ?? null,
    type: row.type,
    severity: row.severity,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    actorName: row.actor_name,
    actorId: typeof row.actor_id === 'string' && isUuid(row.actor_id) ? row.actor_id : null,
    actorIsActive: typeof row.actor_id === 'string' && isUuid(row.actor_id)
      ? activeByActorId.get(row.actor_id) ?? null
      : null,
    entityLabel: row.entity_label,
    itemCount: row.item_count,
    createdAt: row.created_at,
    readAt: row.read_at,
  }))

  const last = page[page.length - 1]
  return NextResponse.json({
    items,
    nextCursor: hasMore && last
      ? encodeNotificationCursor({ createdAt: last.created_at, id: last.id })
      : null,
  })
}
