/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { logAction } from '@/app/api/_utils/audit'
import { sendDocumentReminder } from '@/app/api/_utils/document-reminder'
import { REMINDER_LABELS } from '@/lib/document-reminder'

// POST /api/document-requests/[requestId]/reminder
// Trimite real (prin Resend) reminder-ul de termen limită către client și
// marchează automat reminder_sent_at / reminder_type_sent — nu mai e un toggle manual.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
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
      console.error('POST reminder fetch error:', reqError)
      return NextResponse.json({ error: 'Eroare la încărcarea cererii' }, { status: 500 })
    }
    if (!reqRow) {
      return NextResponse.json({ error: 'Cererea nu a fost găsită' }, { status: 404 })
    }

    // Consultantul trebuie să fie admin sau membru al proiectului
    if (ctx.profile.role !== 'admin') {
      const { data: membership } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', reqRow.project_id)
        .eq('consultant_id', ctx.profile.id)
        .maybeSingle()

      if (!membership) {
        return NextResponse.json({ error: 'Acces interzis' }, { status: 403 })
      }
    }

    const result = await sendDocumentReminder(admin, requestId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    await logAction({
      actorId: ctx.user.id,
      actionType: 'notify',
      entityType: 'document',
      entityId: requestId,
      entityName: result.requestName,
      newValues: {
        project_id: result.projectId,
        project_title: result.projectTitle,
        client_email: result.clientEmail,
        reminder_type_sent: result.reminderType,
        reminder_sent_at: result.sentAt,
        ...(result.stateSaveFailed ? { state_save_failed: true } : {}),
      },
      description: result.stateSaveFailed
        ? `${ctx.profile.email || 'User'} a trimis „${REMINDER_LABELS[result.reminderType]}” pentru cererea "${result.requestName}" din proiectul "${result.projectTitle}" — ATENȚIE: salvarea reminder_sent_at a eșuat, verifică manual`
        : `${ctx.profile.email || 'User'} a trimis „${REMINDER_LABELS[result.reminderType]}” pentru cererea "${result.requestName}" din proiectul "${result.projectTitle}"`,
      request,
    })

    return NextResponse.json({
      reminder_sent_at: result.sentAt,
      reminder_type_sent: result.reminderType,
      ...(result.stateSaveFailed
        ? { warning: 'Emailul a fost trimis, dar actualizarea stării a eșuat. Reîmprospătează pagina pentru starea reală.' }
        : {}),
    })
  } catch (e: any) {
    console.error('POST reminder exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
