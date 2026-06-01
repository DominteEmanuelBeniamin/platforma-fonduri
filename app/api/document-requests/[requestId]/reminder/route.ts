/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { getReminderType } from '@/lib/document-reminder'
import { logAction } from '@/app/api/_utils/audit'

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
      .select('id, project_id, name, deadline_at, reminder_sent_at, reminder_type_sent, deleted_at')
      .eq('id', requestId)
      .is('deleted_at', null)
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

    const { data: projectRow } = await admin
      .from('projects')
      .select('title')
      .eq('id', req.project_id)
      .maybeSingle()
    const projectTitle = projectRow?.title ?? req.project_id
    const requestName = req.name || requestId

    // Toggle: dacă era trimis → anulează; dacă nu era → marchează cu tipul curent
    const isSent = !!req.reminder_sent_at
    const newSentAt = isSent ? null : new Date().toISOString()
    const newTypeSent = isSent ? null : (getReminderType(req.deadline_at) ?? '1_week')

    const { error: updateError } = await admin
      .from('document_requirements')
      .update({ reminder_sent_at: newSentAt, reminder_type_sent: newTypeSent })
      .eq('id', requestId)
      .is('deleted_at', null)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await logAction({
      actorId: ctx.user.id,
      actionType: 'update',
      entityType: 'document',
      entityId: requestId,
      entityName: requestName,
      oldValues: {
        project_id: req.project_id,
        project_title: projectTitle,
        document_request_name: requestName,
        reminder_sent_at: req.reminder_sent_at,
        reminder_type_sent: req.reminder_type_sent,
      },
      newValues: {
        project_id: req.project_id,
        project_title: projectTitle,
        document_request_name: requestName,
        reminder_sent_at: newSentAt,
        reminder_type_sent: newTypeSent,
      },
      description: isSent
        ? `Anulare reminder pentru cererea "${requestName}" din proiectul "${projectTitle}"`
        : `Reminder trimis pentru cererea "${requestName}" din proiectul "${projectTitle}"`,
      request,
    })

    return NextResponse.json({ reminder_sent_at: newSentAt, reminder_type_sent: newTypeSent })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
