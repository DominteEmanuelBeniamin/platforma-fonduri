import { NextResponse } from 'next/server'
import { requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServerClient } from '@/app/api/_utils/supabase'
import { parseNotificationIdsBody } from '@/app/api/notifications/_ids'

export async function POST(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const parsed = await parseNotificationIdsBody(request)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })

  const { body, ids, hasIds } = parsed
  const read = body.read === undefined ? true : body.read
  if (typeof read !== 'boolean') {
    return NextResponse.json({ error: 'read must be a boolean' }, { status: 400 })
  }

  // „Marchează tot ca citit” e o acțiune pe care utilizatorul o cere explicit.
  // Inversul ei nu există: a face totul necitit ar anula o decizie pe care
  // contorul a raportat-o deja.
  if (!read && !hasIds) {
    return NextResponse.json({ error: 'ids are required when read is false' }, { status: 400 })
  }
  if (hasIds && ids.length === 0) return NextResponse.json({ updated: 0 })

  // Un singur UPDATE, cu aceeași condiție de vizibilitate ca politica de
  // select. Selectarea id-urilor cu clientul de utilizator, ca să treacă prin
  // RLS înaintea clientului de serviciu, însemna zeci de round-trip-uri.
  const supabase = createSupabaseServerClient(request)
  const { data, error } = read
    ? await supabase.rpc('mark_notifications_read', hasIds ? { p_ids: ids } : {})
    : await supabase.rpc('mark_notifications_unread', { p_ids: ids })

  if (error) {
    console.error('POST /api/notifications/read error:', error)
    return NextResponse.json({ error: 'Failed to update notification read state' }, { status: 500 })
  }

  return NextResponse.json({ updated: typeof data === 'number' ? data : 0 })
}
