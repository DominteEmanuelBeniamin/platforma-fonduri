import { NextResponse } from 'next/server'
import { requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServerClient } from '@/app/api/_utils/supabase'
import { parseNotificationIdsBody } from '@/app/api/notifications/_ids'

export async function POST(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const parsed = await parseNotificationIdsBody(request)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })

  const { ids, hasIds } = parsed
  // Renunțarea e mereu pe rânduri alese. Nu există „golește tot”: notificarea
  // ștearsă din greșeală nu se mai poate recupera din interfață.
  if (!hasIds) return NextResponse.json({ error: 'ids are required' }, { status: 400 })
  if (ids.length === 0) return NextResponse.json({ updated: 0 })

  const supabase = createSupabaseServerClient(request)
  const { data, error } = await supabase.rpc('dismiss_notifications', { p_ids: ids })

  if (error) {
    console.error('POST /api/notifications/dismiss error:', error)
    return NextResponse.json({ error: 'Failed to dismiss notifications' }, { status: 500 })
  }

  return NextResponse.json({ updated: typeof data === 'number' ? data : 0 })
}
