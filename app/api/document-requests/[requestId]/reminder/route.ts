/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { getReminderType } from '@/lib/document-reminder'

// POST /api/document-requests/[requestId]/reminder
// Toggle reminder_sent_at: null → now()  |  now() → null
// Stochează și reminder_type_sent pentru a detecta schimbarea urgenței
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()

    // Obține cererea + project_id + deadline pentru a calcula tipul de reminder
    const { data: req, error: reqError } = await admin
      .from('document_requirements')
      .select('id, project_id, deadline_at, reminder_sent_at, reminder_type_sent')
      .eq('id', requestId)
      .maybeSingle()

    if (reqError || !req) {
      return NextResponse.json({ error: 'Cererea nu a fost găsită' }, { status: 404 })
    }

    // Consultantul trebuie să fie admin sau membru al proiectului
    if (ctx.profile.role !== 'admin') {
      const { data: membership } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', req.project_id)
        .eq('consultant_id', ctx.profile.id)
        .maybeSingle()

      if (!membership) {
        return NextResponse.json({ error: 'Acces interzis' }, { status: 403 })
      }
    }

    // Toggle: dacă era trimis → anulează; dacă nu era → marchează cu tipul curent
    const isSent = !!req.reminder_sent_at
    const newSentAt = isSent ? null : new Date().toISOString()
    const newTypeSent = isSent ? null : (getReminderType(req.deadline_at) ?? '1_week')

    const { error: updateError } = await admin
      .from('document_requirements')
      .update({ reminder_sent_at: newSentAt, reminder_type_sent: newTypeSent })
      .eq('id', requestId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ reminder_sent_at: newSentAt, reminder_type_sent: newTypeSent })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
