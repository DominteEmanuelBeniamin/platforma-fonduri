/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { isUuid } from '@/lib/notification-utils'

const PAGE_SIZE = 1000
const UPDATE_CHUNK_SIZE = 500
const MAX_EXPLICIT_IDS = 500

export async function POST(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  let body: any = {}
  const rawBody = await request.text()
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 })
  }

  const hasIds = body && Object.prototype.hasOwnProperty.call(body, 'ids')
  if (hasIds && (!Array.isArray(body.ids) || body.ids.some((id: unknown) => !isUuid(id)))) {
    return NextResponse.json({ error: 'ids must be an array of UUIDs' }, { status: 400 })
  }

  const ids = hasIds ? [...new Set(body.ids as string[])] : []
  if (ids.length > MAX_EXPLICIT_IDS) {
    return NextResponse.json({ error: `ids may contain at most ${MAX_EXPLICIT_IDS} values` }, { status: 400 })
  }

  const userClient = createSupabaseServerClient(request)
  const selectedIds: string[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let selection = userClient
      .from('notifications')
      .select('id')
      .is('read_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (hasIds) {
      if (ids.length === 0) return NextResponse.json({ updated: 0 })
      selection = selection.in('id', ids)
    }

    const { data: selected, error: selectionError } = await selection
    if (selectionError) {
      console.error('POST /api/notifications/read selection error:', selectionError)
      return NextResponse.json({ error: 'Failed to select notifications' }, { status: 500 })
    }

    const batch = (selected ?? []).map((row: { id: string }) => row.id)
    selectedIds.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  if (selectedIds.length === 0) return NextResponse.json({ updated: 0 })

  const service = createSupabaseServiceClient()
  let updatedCount = 0
  for (let from = 0; from < selectedIds.length; from += UPDATE_CHUNK_SIZE) {
    const chunk = selectedIds.slice(from, from + UPDATE_CHUNK_SIZE)
    const { data: updated, error: updateError } = await service
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', ctx.user.id)
      .is('read_at', null)
      .in('id', chunk)
      .select('id')

    if (updateError) {
      console.error('POST /api/notifications/read update error:', updateError)
      return NextResponse.json({ error: 'Failed to mark notifications as read' }, { status: 500 })
    }
    updatedCount += updated?.length ?? 0
  }

  return NextResponse.json({ updated: updatedCount })
}
