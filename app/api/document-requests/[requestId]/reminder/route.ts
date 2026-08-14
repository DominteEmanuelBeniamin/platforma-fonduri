/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { logAction } from '@/app/api/_utils/audit'
import { sendDocumentReminder } from '@/app/api/_utils/document-reminder'
import { REMINDER_LABELS } from '@/lib/document-reminder'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()
    const { data: reqRow, error: reqError } = await admin
      .from('document_requirements')
      .select('id, project_id, deleted_at')
      .eq('id', requestId)
      .is('deleted_at', null)
      .maybeSingle()

    if (reqError) {
      console.error('POST reminder fetch error:', { requestId, code: 'request_query_failed' })
      return NextResponse.json({ error: 'Eroare la încărcarea cererii' }, { status: 500 })
    }
    if (!reqRow) return NextResponse.json({ error: 'Cererea nu a fost găsită' }, { status: 404 })

    if (ctx.profile.role !== 'admin') {
      const { data: membership } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', reqRow.project_id)
        .eq('consultant_id', ctx.profile.id)
        .maybeSingle()
      if (!membership) return NextResponse.json({ error: 'Acces interzis' }, { status: 403 })
    }

    const result = await sendDocumentReminder(admin, requestId, { triggeredBy: ctx.user.id })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    await logAction({
      actorId: ctx.user.id,
      actionType: 'notify',
      entityType: 'document',
      entityId: requestId,
      entityName: result.requestName,
      newValues: {
        project_id: result.projectId,
        project_title: result.projectTitle,
        threshold: result.reminderType,
        source: result.source,
        sent_at: result.sentAt,
        reminder_log_id: result.reminderLogId,
        provider_id: result.providerId,
        delivery_overridden: result.deliveryOverridden,
        ...(result.journalSaveFailed ? { journal_save_failed: true } : {}),
      },
      description: result.journalSaveFailed
        ? `Utilizatorul a trimis „${REMINDER_LABELS[result.reminderType]}” pentru cererea "${result.requestName}" din proiectul "${result.projectTitle}" — jurnalul reminderului nu a putut fi finalizat, verifică manual`
        : `Utilizatorul a trimis „${REMINDER_LABELS[result.reminderType]}” pentru cererea "${result.requestName}" din proiectul "${result.projectTitle}"`,
      request,
    })

    return NextResponse.json({
      reminder_log_id: result.reminderLogId,
      threshold: result.reminderType,
      source: result.source,
      sent_at: result.sentAt,
      provider_id: result.providerId,
      delivery_overridden: result.deliveryOverridden,
      ...(result.journalSaveFailed
        ? { warning: 'Emailul a fost trimis, dar jurnalul reminderului nu a putut fi finalizat. Reîmprospătează pagina pentru starea reală.' }
        : {}),
    })
  } catch (error: any) {
    console.error('POST reminder exception:', { code: 'route_failed', message: error?.message })
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}
