/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardToResponse, requireAdmin } from '@/app/api/_utils/auth'
import { computeDiff, logAction } from '@/app/api/_utils/audit'
import { normalizeRequirementType, requirementTypeToMandatory } from '@/lib/requirement-type'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ documentId: string }>
}

async function loadDocumentChain(templateActivityId: string | null | undefined) {
  if (!templateActivityId) return { activityName: '', phaseName: '', templateName: '' }
  const { data } = await supabaseAdmin
    .from('template_activities')
    .select('name, template_phases(name, project_templates(name))')
    .eq('id', templateActivityId)
    .maybeSingle()
  return {
    activityName: data?.name ?? templateActivityId,
    phaseName: (data as any)?.template_phases?.name ?? '',
    templateName: (data as any)?.template_phases?.project_templates?.name ?? '',
  }
}

// PATCH /api/admin/templates/documents/[documentId]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return guardToResponse(auth)

    const { documentId } = await params
    const body = await req.json()
    const { name, description, is_mandatory, requirement_type, order_index, attachment_path, attachment_original_name, attachments } = body
    const attachmentItems = Array.isArray(attachments)
      ? attachments.filter((item: any) => item && typeof item.storage_path === 'string' && item.storage_path.trim())
      : undefined
    const incomingIsOutgoing = body?.is_outgoing === undefined ? undefined : body?.is_outgoing === true

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (requirement_type !== undefined) {
      const rt = normalizeRequirementType(requirement_type, is_mandatory)
      updateData.requirement_type = rt
      updateData.is_mandatory = requirementTypeToMandatory(rt)
    } else if (is_mandatory !== undefined) {
      updateData.is_mandatory = is_mandatory
    }
    if (order_index !== undefined) updateData.order_index = order_index
    if (attachment_path !== undefined) {
      updateData.attachment_path = attachment_path || null
      updateData.attachment_original_name = attachment_path ? attachment_original_name || null : null
      updateData.attachment_missing_at = null
      updateData.attachment_missing_checked_at = null
    }

    const { data: previousDoc, error: previousError } = await supabaseAdmin
      .from('template_document_requirements')
      .select('*')
      .eq('id', documentId)
      .maybeSingle()

    if (previousError) throw previousError
    if (!previousDoc) {
      return NextResponse.json({ error: 'Documentul nu a fost găsit' }, { status: 404 })
    }

    const finalIsOutgoing = incomingIsOutgoing ?? Boolean(previousDoc.is_outgoing)
    const finalAttachmentPath = attachmentItems !== undefined
      ? attachmentItems[0]?.storage_path || null
      : attachment_path !== undefined
      ? attachment_path || null
      : previousDoc.attachment_path || null

    if (attachmentItems !== undefined) {
      updateData.attachment_path = finalAttachmentPath
      updateData.attachment_original_name = finalAttachmentPath ? attachmentItems[0]?.original_name || null : null
      updateData.attachment_missing_at = null
      updateData.attachment_missing_checked_at = null
    }

    if (finalIsOutgoing && !finalAttachmentPath) {
      return NextResponse.json({ error: 'Trebuie atașat un fișier pentru documentul trimis clientului.' }, { status: 400 })
    }

    if (incomingIsOutgoing !== undefined) updateData.is_outgoing = incomingIsOutgoing
    if (finalIsOutgoing) {
      updateData.requirement_type = 'optional'
      updateData.is_mandatory = false
    }

    const { data: doc, error } = await supabaseAdmin
      .from('template_document_requirements')
      .update(updateData)
      .eq('id', documentId)
      .select()
      .single()

    if (error) throw error

    if (attachmentItems !== undefined) {
      const { error: deleteAttachmentsError } = await supabaseAdmin
        .from('document_requirement_attachments')
        .delete()
        .eq('template_document_requirement_id', documentId)
      if (deleteAttachmentsError) throw deleteAttachmentsError

      if (attachmentItems.length > 0) {
        const { error: insertAttachmentsError } = await supabaseAdmin
          .from('document_requirement_attachments')
          .insert(attachmentItems.map((attachment: any, index: number) => ({
            template_document_requirement_id: documentId,
            storage_path: attachment.storage_path.trim(),
            original_name: typeof attachment.original_name === 'string' ? attachment.original_name : null,
            mime_type: typeof attachment.mime_type === 'string' ? attachment.mime_type : null,
            file_size: typeof attachment.file_size === 'number' ? attachment.file_size : null,
            order_index: index,
            created_by: auth.profile.id,
          })))
        if (insertAttachmentsError) throw insertAttachmentsError
      }
    }

    const diff = computeDiff(previousDoc, updateData)
    if (!diff.isEmpty) {
      const { activityName, phaseName, templateName } = await loadDocumentChain(doc.template_activity_id)
      const attachmentChanged =
        attachment_path !== undefined && (previousDoc?.attachment_path ?? null) !== (doc.attachment_path ?? null)
      const onlyAttachmentChange = diff.changedKeys.every(k =>
        ['attachment_path', 'attachment_original_name', 'attachment_missing_at', 'attachment_missing_checked_at'].includes(k),
      )

      let descriptionText: string
      if (attachmentChanged && onlyAttachmentChange) {
        descriptionText = doc.attachment_path
          ? `Inlocuire model document "${doc.name}" in activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}")`
          : `Eliminare model document "${doc.name}" in activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}")`
      } else {
        descriptionText = `Modificare cerinta document "${doc.name}" in activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}") (${diff.changedKeys.join(', ')})`
      }

      await logAction({
        actorId: auth.profile.id,
        actionType: 'update',
        entityType: 'template_document',
        entityId: documentId,
        entityName: doc.name,
        oldValues: { ...diff.oldValues, template_name: templateName, phase_name: phaseName, activity_name: activityName },
        newValues: { ...diff.newValues, template_name: templateName, phase_name: phaseName, activity_name: activityName },
        description: descriptionText,
        request: req,
      })
    }

    return NextResponse.json({ document: doc })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/documents/[documentId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/documents/[documentId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return guardToResponse(auth)

    const { documentId } = await params

    const { data: before } = await supabaseAdmin
      .from('template_document_requirements')
      .select('*')
      .eq('id', documentId)
      .maybeSingle()

    const { error } = await supabaseAdmin
      .from('template_document_requirements')
      .update({ is_active: false })
      .eq('id', documentId)

    if (error) throw error

    const { activityName, phaseName, templateName } = await loadDocumentChain(before?.template_activity_id)
    await logAction({
      actorId: auth.profile.id,
      actionType: 'delete',
      entityType: 'template_document',
      entityId: documentId,
      entityName: before?.name ?? documentId,
      oldValues: before ? { ...before, template_name: templateName, phase_name: phaseName, activity_name: activityName } : null,
      description: `Eliminare cerinta document "${before?.name ?? documentId}" din activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}")`,
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/documents/[documentId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
