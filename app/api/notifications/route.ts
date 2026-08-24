/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServerClient } from '@/app/api/_utils/supabase'
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  isUuid,
} from '@/lib/notification-utils'

const PAGE_SIZE = 40

function parseUnreadOnly(value: string | null): boolean | null {
  if (value === null) return false
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return null
}

export async function GET(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId')
  if (projectId !== null && !isUuid(projectId)) {
    return NextResponse.json({ error: 'projectId must be a UUID' }, { status: 400 })
  }

  const unreadOnly = parseUnreadOnly(url.searchParams.get('unreadOnly'))
  if (unreadOnly === null) {
    return NextResponse.json({ error: 'unreadOnly must be true or false' }, { status: 400 })
  }

  const cursorValue = url.searchParams.get('cursor')
  const cursor = decodeNotificationCursor(cursorValue)
  if (cursorValue !== null && !cursor) {
    return NextResponse.json({ error: 'Invalid notification cursor' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient(request)
  let query = supabase
    .from('notifications')
    .select('id, project_id, type, entity_type, entity_id, title, item_count, created_at, read_at, project:project_id(title)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (projectId) query = query.eq('project_id', projectId)
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
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const items = page.map(row => ({
    id: row.id,
    projectId: row.project_id,
    projectTitle: Array.isArray(row.project) ? row.project[0]?.title ?? null : row.project?.title ?? null,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
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
