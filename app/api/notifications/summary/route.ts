import { NextResponse } from 'next/server'
import { requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServerClient } from '@/app/api/_utils/supabase'

type UnreadByProject = { projectId: string; count: number }

export async function GET(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Numărătoarea stă în baza de date. Ruta se cheamă la fiecare focus, revenire
  // în tab și eveniment realtime, iar un admin e destinatarul tuturor
  // notificărilor din toate proiectele — paginarea rândurilor în memorie
  // creștea liniar cu vechimea contului.
  const supabase = createSupabaseServerClient(request)
  const { data, error } = await supabase.rpc('notification_unread_summary')

  if (error) {
    console.error('GET /api/notifications/summary error:', error)
    return NextResponse.json({ error: 'Failed to load notification summary' }, { status: 500 })
  }

  const unreadByProject = (Array.isArray(data) ? data : []) as UnreadByProject[]

  return NextResponse.json({
    unreadCount: unreadByProject.reduce((total, row) => total + (row?.count ?? 0), 0),
    unreadByProject,
  })
}
