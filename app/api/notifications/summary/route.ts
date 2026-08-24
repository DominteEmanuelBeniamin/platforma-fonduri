import { NextResponse } from 'next/server'
import { requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServerClient } from '@/app/api/_utils/supabase'

const PAGE_SIZE = 1000

export async function GET(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const supabase = createSupabaseServerClient(request)
  const rows: { project_id: string }[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('notifications')
      .select('project_id')
      .is('read_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error('GET /api/notifications/summary error:', error)
      return NextResponse.json({ error: 'Failed to load notification summary' }, { status: 500 })
    }

    const batch = (data ?? []) as { project_id: string }[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1)
  }

  return NextResponse.json({
    unreadCount: rows.length,
    unreadByProject: [...counts.entries()].map(([projectId, count]) => ({ projectId, count })),
  })
}
