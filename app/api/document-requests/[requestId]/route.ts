/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { computeDiff, logAction } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { escapeHtml, resendFromAddress, sanitizeHeaderText } from '@/app/api/_utils/email'
import { isRequirementType, requirementTypeToMandatory } from '@/lib/requirement-type'
import { blockersIntroducedBy, publishBlockedError, publishBlockers } from '@/lib/publish-rules'
import { buildAssignmentEmailIdempotencyKey, isRealAssignmentChange } from '@/lib/notification-utils'

// Inițializat în handler ca să preia env-ul la runtime, nu la cold-start

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const rawName = (body as any).name
    const name: string | undefined =
      rawName === undefined
        ? undefined
        : typeof rawName === 'string'
        ? rawName.trim()
        : undefined
    if (rawName !== undefined && !name) {
      return NextResponse.json({ error: 'Numele cererii este obligatoriu' }, { status: 400 })
    }

    const rawDescription = (body as any).description
    const description: string | null | undefined =
      rawDescription === undefined
        ? undefined
        : rawDescription === null || rawDescription === ''
        ? null
        : typeof rawDescription === 'string'
        ? rawDescription.trim() || null
        : undefined
    if (rawDescription !== undefined && description === undefined) {
      return NextResponse.json({ error: 'Descrierea trebuie să fie text sau null' }, { status: 400 })
    }

    const rawRequirementType = (body as any).requirement_type
    if (rawRequirementType !== undefined && !isRequirementType(rawRequirementType)) {
      return NextResponse.json({ error: 'Tipul cerinței este invalid' }, { status: 400 })
    }

    // assigned_to trebuie să fie string (UUID), null sau omis
    const visibility = (body as any).visibility
    if (visibility !== undefined && visibility !== 'published') {
      return NextResponse.json({ error: 'Invalid visibility transition' }, { status: 400 })
    }

    const rawAssigned = (body as any).assigned_to
    if (rawAssigned !== undefined && rawAssigned !== null && typeof rawAssigned !== 'string') {
      return NextResponse.json({ error: 'assigned_to trebuie să fie un UUID sau null' }, { status: 400 })
    }
    const assigned_to: string | null | undefined = rawAssigned === undefined ? undefined : rawAssigned

    // deadline_at — string ISO sau null (undefined = nu se modifică). O dată
    // nevalidă trecea nefiltrată și ajungea eroare de Postgres, adică 500 în
    // loc de 400; același tratament ca pe ruta de activități.
    const rawDeadline = (body as any).deadline_at
    if (
      rawDeadline !== undefined && rawDeadline !== null && rawDeadline !== '' &&
      (typeof rawDeadline !== 'string' || Number.isNaN(Date.parse(rawDeadline)))
    ) {
      return NextResponse.json({ error: 'deadline_at trebuie să fie o dată validă sau null' }, { status: 400 })
    }
    const deadline_at: string | null | undefined =
      rawDeadline === undefined
        ? undefined
        : rawDeadline === null || rawDeadline === ''
        ? null
        : (rawDeadline as string)

    const rawAttachmentPath = (body as any).attachment_path
    const attachment_path: string | null | undefined =
      rawAttachmentPath === undefined
        ? undefined
        : rawAttachmentPath === null || rawAttachmentPath === ''
        ? null
        : typeof rawAttachmentPath === 'string'
        ? rawAttachmentPath
        : undefined
    const rawAttachmentOriginalName = (body as any).attachment_original_name
    const attachment_original_name: string | null | undefined =
      rawAttachmentOriginalName === undefined
        ? undefined
        : rawAttachmentOriginalName === null || rawAttachmentOriginalName === ''
        ? null
        : typeof rawAttachmentOriginalName === 'string'
        ? rawAttachmentOriginalName
        : undefined
    const attachments = Array.isArray((body as any).attachments)
      ? (body as any).attachments.filter((item: any) => item && typeof item.storage_path === 'string' && item.storage_path.trim())
      : undefined

    const admin = createSupabaseServiceClient()

    // Obține cererea pentru a afla project_id și detalii email
    const { data: req, error: reqError } = await admin
      .from('document_requirements')
      .select('id, project_id, activity_id, name, description, deadline_at, requirement_type, is_mandatory, is_outgoing, visibility, assigned_to, attachment_path, attachment_original_name, attachment_missing_at, attachment_missing_checked_at, deleted_at, activity:activity_id(id, assigned_to), document_requirement_attachments(id, storage_path, original_name, mime_type, file_size, order_index, missing_at, missing_checked_at, source_template_attachment_id, created_at)')
      .eq('id', requestId)
      .is('deleted_at', null)
      .maybeSingle()

    if (reqError) {
      console.error('PATCH document-requests fetch error:', reqError)
      return NextResponse.json({ error: 'Eroare la încărcarea cererii' }, { status: 500 })
    }
    if (!req) {
      return NextResponse.json({ error: 'Cererea nu a fost găsită' }, { status: 404 })
    }

    const currentRequest = req
    const access = await requireProjectAccess(request, req.project_id)
    if (!access.ok) return guardToResponse(access)
    if (access.profile.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea să modifici cereri' }, { status: 403 })
    }

    if (visibility === 'published' && req.visibility !== 'draft') {
      return NextResponse.json({ error: 'Document request is already published' }, { status: 400 })
    }

    const { data: projectRow, error: projectError } = await admin
      .from('projects')
      .select('title, general_consultant_id')
      .eq('id', req.project_id)
      .maybeSingle()
    if (projectError) {
      console.error('PATCH document-requests project fetch error:', projectError)
      return NextResponse.json({ error: 'Eroare la încărcarea proiectului' }, { status: 500 })
    }
    const projectTitle = projectRow?.title ?? req.project_id

    // `general_consultant_id` se scrie fără nicio verificare de apartenență
    // (app/api/projects/[id]/route.ts), deci îl acceptăm drept responsabil doar
    // dacă persoana chiar e membru — aceeași condiție ca pentru `assigned_to`.
    let generalConsultantId: string | null = null
    if (!req.activity_id && projectRow?.general_consultant_id) {
      const { data: generalMembership, error: generalMembershipError } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', req.project_id)
        .eq('consultant_id', projectRow.general_consultant_id)
        .maybeSingle()
      if (generalMembershipError) {
        console.error('PATCH document-requests general membership error:', generalMembershipError)
        return NextResponse.json({ error: 'Eroare la verificarea consultantului general' }, { status: 500 })
      }
      if (generalMembership) generalConsultantId = projectRow.general_consultant_id
    }

    // #70 — nu se publică nimic incomplet. Verificarea stă înaintea oricărei
    // scrieri, ca o cerere respinsă să nu modifice parțial rândul.
    // Relația vine ca obiect sau ca listă, după cum o întoarce PostgREST.
    const parentActivity = Array.isArray(req.activity) ? req.activity[0] : req.activity
    const publishState = {
      kind: 'document' as const,
      isOutgoing: Boolean(req.is_outgoing),
      currentDeadline: req.deadline_at,
      incomingDeadline: deadline_at,
      currentAssignee: req.assigned_to,
      incomingAssignee: assigned_to,
      // O cerere din activitate răspunde de consultantul activității; una
      // generală, de consultantul general al proiectului — exact persoana
      // aleasă din selectul secțiunii „Cereri generale".
      parentAssignee: req.activity_id
        ? parentActivity?.assigned_to ?? null
        : generalConsultantId,
    }

    if (visibility === 'published') {
      const blockers = publishBlockers(publishState)
      if (blockers.length > 0) {
        return NextResponse.json(publishBlockedError(blockers), { status: 400 })
      }
    } else if (req.visibility === 'published') {
      // Deja publicată: regula nu se cere retroactiv — cele publicate înainte
      // de #70 rămân editabile — dar ce e completat nu poate fi golit.
      const removed = blockersIntroducedBy(publishState)
      if (removed.length > 0) {
        return NextResponse.json(
          publishBlockedError(removed, { alreadyPublished: true }),
          { status: 400 },
        )
      }
    }

    // Dacă se atribuie cuiva, verifică că este consultant membru al proiectului
    if (assigned_to !== undefined && assigned_to !== null) {
      const { data: membership, error: memberError } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', req.project_id)
        .eq('consultant_id', assigned_to)
        .maybeSingle()

      if (memberError) {
        console.error('PATCH document-requests membership error:', memberError)
        return NextResponse.json({ error: 'Eroare la verificarea membrului' }, { status: 500 })
      }
      if (!membership) {
        return NextResponse.json(
          { error: 'Consultantul nu este membru al acestui proiect' },
          { status: 400 }
        )
      }
    }

    // Construiește obiectul de update (doar câmpurile trimise)
    const updatePayload: Record<string, any> = {}
    if (name !== undefined) updatePayload.name = name
    if (description !== undefined) updatePayload.description = description
    if (rawRequirementType !== undefined) {
      updatePayload.requirement_type = rawRequirementType
      updatePayload.is_mandatory = requirementTypeToMandatory(rawRequirementType)
    }
    if (assigned_to !== undefined) updatePayload.assigned_to = assigned_to
    if (deadline_at !== undefined) updatePayload.deadline_at = deadline_at
    if (attachment_path !== undefined) {
      updatePayload.attachment_path = attachment_path
      updatePayload.attachment_original_name = attachment_path
        ? attachment_original_name ?? null
        : null
      updatePayload.attachment_missing_at = null
      updatePayload.attachment_missing_checked_at = null
    }
    if (attachments !== undefined) {
      const firstAttachment = attachments[0]
      updatePayload.attachment_path = firstAttachment?.storage_path || null
      updatePayload.attachment_original_name = firstAttachment?.original_name || null
      updatePayload.attachment_missing_at = null
      updatePayload.attachment_missing_checked_at = null
    }

    if (visibility === 'published') updatePayload.visibility = 'published'

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'Nu există câmpuri de actualizat' }, { status: 400 })
    }

    const diff = computeDiff(req as Record<string, any>, updatePayload)
    // atașamentele (2+) pot rămâne neschimbate pe primul din listă — nu ne
    // putem baza doar pe diff-ul câmpurilor de request pentru a ști dacă
    // trebuie resincronizat document_requirement_attachments
    if (diff.isEmpty && attachments === undefined) {
      return NextResponse.json({ ok: true })
    }
    if (attachments !== undefined && !diff.changedKeys.includes('attachments')) {
      diff.changedKeys.push('attachments')
    }

    const assignmentChanged = assigned_to !== undefined && assigned_to !== req.assigned_to
    const assignmentEventAt = assignmentChanged ? new Date().toISOString() : null
    // Ca la activități: triggerul nu vede autorul, așa că îl scriem pe rând.
    // `assigned_at` se scrie în aceeași actualizare pentru că e versiunea pe
    // care o poartă cheia de idempotență a emailului — una calculată doar în
    // memorie ar fi diferită la fiecare încercare, deci n-ar deduplica nimic.
    if (assignmentChanged) {
      updatePayload.assigned_by = access.user.id
      updatePayload.assigned_at = assignmentEventAt
    }
    let requestUpdate = admin
      .from('document_requirements')
      .update(updatePayload)
      .eq('id', requestId)
      .is('deleted_at', null)
    if (assignmentChanged) {
      requestUpdate = req.assigned_to === null
        ? requestUpdate.is('assigned_to', null)
        : requestUpdate.eq('assigned_to', req.assigned_to)
    }
    const { data: updatedRequest, error: updateError } = await requestUpdate
      .select('*')
      .maybeSingle()

    if (updateError) {
      console.error('PATCH document-requests update error:', updateError)
      return NextResponse.json({ error: 'Eroare la actualizarea cererii' }, { status: 500 })
    }
    if (!updatedRequest) {
      return NextResponse.json(
        { error: assignmentChanged ? 'Cererea a fost modificată între timp. Reîncarcă și încearcă din nou.' : 'Cererea nu mai există' },
        { status: assignmentChanged ? 409 : 404 },
      )
    }

    await notifyAssignment()

    if (attachments !== undefined) {
      const { error: deleteAttachmentsError } = await admin
        .from('document_requirement_attachments')
        .delete()
        .eq('document_requirement_id', requestId)
      if (deleteAttachmentsError) throw deleteAttachmentsError

      if (attachments.length > 0) {
        const { error: insertAttachmentsError } = await admin
          .from('document_requirement_attachments')
          .insert(attachments.map((attachment: any, index: number) => ({
            document_requirement_id: requestId,
            storage_path: attachment.storage_path.trim(),
            original_name: typeof attachment.original_name === 'string' ? attachment.original_name : null,
            mime_type: typeof attachment.mime_type === 'string' ? attachment.mime_type : null,
            file_size: typeof attachment.file_size === 'number' ? attachment.file_size : null,
            order_index: index,
            source_template_attachment_id: typeof attachment.source_template_attachment_id === 'string'
              ? attachment.source_template_attachment_id
              : null,
            created_by: access.profile.id,
          })))
        if (insertAttachmentsError) throw insertAttachmentsError
      }
    }

    await logAction({
      actorId: access.user.id,
      actionType: 'update',
      entityType: 'document',
      entityId: requestId,
      entityName: name ?? req.name ?? (req.is_outgoing ? 'Document trimis clientului' : 'Cerere document'),
      oldValues: {
        project_id: req.project_id,
        project_title: projectTitle,
        is_outgoing: Boolean(req.is_outgoing),
        ...(diff.oldValues ?? {}),
      },
      newValues: {
        project_id: req.project_id,
        project_title: projectTitle,
        is_outgoing: Boolean(req.is_outgoing),
        ...(diff.newValues ?? {}),
      },
      description: req.is_outgoing
        ? `${access.profile.email || 'User'} a modificat documentul trimis clientului "${name ?? req.name ?? requestId}" din proiectul "${projectTitle}" (${diff.changedKeys.join(', ')})`
        : `${access.profile.email || 'User'} a modificat cererea de document "${name ?? req.name ?? requestId}" din proiectul "${projectTitle}" (${diff.changedKeys.join(', ')})`,
      request,
    })

    // Trimite email consultantului atribuit, doar când atribuirea chiar se
    // schimbă — altfel orice salvare care retrimite `assigned_to` îl anunță din
    // nou. (Ca la activități, care compară deja cu valoarea dinainte.)
    async function notifyAssignment() {
      if (isRealAssignmentChange(currentRequest.assigned_to, assigned_to) && assignmentEventAt) {
      // Versiunea vine din rândul actualizat, nu din variabila locală: două
      // servere care ajung amândouă să scrie aceeași tranziție citesc aceeași
      // valoare, deci aceeași cheie, deci un singur email.
      const idempotencyKey = buildAssignmentEmailIdempotencyKey({
        projectId: currentRequest.project_id,
        entityType: 'document_request',
        entityId: requestId,
        recipientId: assigned_to,
        version: updatedRequest.assigned_at,
      })
      try {
        // Proiectul e deja citit mai sus, în `projectRow`/`projectTitle`.
        const { data: consultant, error: consultantError } = await admin
          .from('profiles').select('full_name, email').eq('id', assigned_to).maybeSingle()
        if (consultantError) throw consultantError

        if (consultant?.email) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
          const projectUrl = `${appUrl}/projects/${currentRequest.project_id}`
          const safeProjectTitle = escapeHtml(projectTitle)
          const safeRequestName = escapeHtml(updatedRequest.name ?? '')
          const salut = consultant.full_name ? `Salut, ${escapeHtml(consultant.full_name)}!` : 'Salut!'
          const deadline = updatedRequest.deadline_at
            ? new Date(updatedRequest.deadline_at).toLocaleDateString('ro-RO', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })
            : null

          const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

    <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:32px 40px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Cerere nouă atribuită</h1>
      <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">${safeProjectTitle}</p>
    </div>

    <div style="padding:32px 40px;">
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">${salut}</p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;">
        Ți-a fost atribuită o nouă cerere de document în proiectul <strong>${safeProjectTitle}</strong>.
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 28px;">
        <p style="margin:0 0 12px;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Detalii cerere</p>
        <p style="margin:0 0 8px;color:#111827;font-size:16px;font-weight:600;">${safeRequestName}</p>
        ${updatedRequest.description ? `<p style="margin:0 0 10px;color:#4b5563;font-size:14px;line-height:1.6;">${escapeHtml(updatedRequest.description)}</p>` : ''}
        ${deadline ? `<p style="margin:0;color:#d97706;font-size:13px;font-weight:500;">⏱ Termen limită: ${deadline}</p>` : ''}
      </div>

      <a href="${projectUrl}"
         style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.01em;">
        Mergi la proiect →
      </a>
    </div>

    <div style="padding:20px 40px;border-top:1px solid #f1f5f9;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Acest email a fost generat automat de Platforma Fonduri EU. Nu răspunde la acest mesaj.
      </p>
    </div>
  </div>
</body>
</html>`

          const resend = new Resend(process.env.RESEND_API_KEY)
          const { error: emailError } = await resend.emails.send({
            from: resendFromAddress(),
            to: consultant.email,
            subject: sanitizeHeaderText(`Ți-a fost atribuită o cerere nouă — ${projectTitle}`),
            html,
          }, { idempotencyKey })
          if (emailError) {
            console.error('Resend error:', emailError)
          }
        }
      } catch (emailError) {
        console.error('Email send error (non-blocking):', emailError)
      }
    }
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('PATCH document-requests exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const body = await request.json().catch(() => null)
    const deleteReason =
      body && typeof body === 'object' && typeof (body as any).delete_reason === 'string'
        ? (body as any).delete_reason.trim() || null
        : null
    const admin = createSupabaseServiceClient()

    const { data: req, error: reqError } = await admin
      .from('document_requirements')
      .select('id, project_id, name, status, is_outgoing, deleted_at, deleted_by, delete_reason')
      .eq('id', requestId)
      .maybeSingle()

    if (reqError) {
      console.error('DELETE document-requests fetch error:', reqError)
      return NextResponse.json({ error: 'Eroare la încărcarea cererii' }, { status: 500 })
    }
    if (!req) {
      return NextResponse.json({ error: 'Cererea nu a fost găsită' }, { status: 404 })
    }

    const access = await requireProjectAccess(request, req.project_id)
    if (!access.ok) return guardToResponse(access)

    if (access.profile.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea să ștergi cereri' }, { status: 403 })
    }

    const { data: deleteProjectRow } = await admin
      .from('projects')
      .select('title')
      .eq('id', req.project_id)
      .maybeSingle()
    const deleteProjectTitle = deleteProjectRow?.title ?? req.project_id

    if (req.deleted_at) {
      return NextResponse.json({
        ok: true,
        deleted_at: req.deleted_at,
        deleted_by: req.deleted_by,
        already_deleted: true,
      })
    }

    const deletedAt = new Date().toISOString()
    const deletedBy = access.user.id

    const { error: filesError } = await admin
      .from('files')
      .update({ deleted_at: deletedAt, deleted_by: deletedBy })
      .eq('requirement_id', requestId)
      .is('deleted_at', null)

    if (filesError) {
      console.error('DELETE document-requests files soft-delete error:', filesError)
      return NextResponse.json({ error: 'Eroare la ștergerea fișierelor cererii' }, { status: 500 })
    }

    const { error: updateError } = await admin
      .from('document_requirements')
      .update({ deleted_at: deletedAt, deleted_by: deletedBy, delete_reason: deleteReason })
      .eq('id', requestId)
      .is('deleted_at', null)

    if (updateError) {
      console.error('DELETE document-requests update error:', updateError)
      return NextResponse.json({ error: 'Eroare la ștergerea cererii' }, { status: 500 })
    }

    await logAction({
      actorId: access.user.id,
      actionType: 'delete',
      entityType: 'document',
      entityId: requestId,
      entityName: req.name || (req.is_outgoing ? 'Document trimis clientului' : 'Cerere document'),
      oldValues: {
        project_id: req.project_id,
        project_title: deleteProjectTitle,
        status: req.status,
        is_outgoing: Boolean(req.is_outgoing),
        deleted_at: req.deleted_at,
      },
      newValues: {
        project_id: req.project_id,
        project_title: deleteProjectTitle,
        is_outgoing: Boolean(req.is_outgoing),
        deleted_at: deletedAt,
        deleted_by: deletedBy,
        delete_reason: deleteReason,
      },
      description: req.is_outgoing
        ? `${access.profile.email || 'User'} a șters documentul trimis clientului "${req.name || requestId}" din proiectul "${deleteProjectTitle}"`
        : `${access.profile.email || 'User'} a șters cererea de document "${req.name || requestId}" din proiectul "${deleteProjectTitle}"`,
      request,
    })

    return NextResponse.json({ ok: true, deleted_at: deletedAt })
  } catch (e: any) {
    console.error('DELETE document-requests exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
