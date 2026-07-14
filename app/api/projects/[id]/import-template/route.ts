/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'project-files'

async function storagePathExists(path: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60)

  if (error || !data?.signedUrl) return false

  try {
    const res = await fetch(data.signedUrl, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST /api/projects/[id]/import-template
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { id: projectId } = await params
    const body = await req.json()
    const { template_id } = body

    if (!template_id) {
      return NextResponse.json({ error: 'template_id este obligatoriu' }, { status: 400 })
    }

    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, title')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Proiect negăsit' }, { status: 404 })
    }

    const { data: existingPhases } = await supabaseAdmin
      .from('project_phases')
      .select('id')
      .eq('project_id', projectId)
      .limit(1)

    if (existingPhases && existingPhases.length > 0) {
      return NextResponse.json({ 
        error: 'Proiectul are deja faze.' 
      }, { status: 400 })
    }

    const { data: template, error: templateError } = await supabaseAdmin
      .from('project_templates')
      .select('id, name')
      .eq('id', template_id)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template negăsit' }, { status: 404 })
    }

    const { data: templatePhases } = await supabaseAdmin
      .from('template_phases')
      .select('*')
      .eq('template_id', template_id)
      .eq('is_active', true)
      .order('order_index')

    if (!templatePhases || templatePhases.length === 0) {
      return NextResponse.json({ error: 'Template-ul nu are faze' }, { status: 400 })
    }

    const warnings: Array<{ type: string; template_document_requirement_id: string; name: string; attachment_path: string | null }> = []

    for (const tPhase of templatePhases) {
      const { data: newPhase, error: phaseError } = await supabaseAdmin
        .from('project_phases')
        .insert({
          project_id: projectId,
          project_status_id: tPhase.project_status_id,
          name: tPhase.name,
          slug: tPhase.slug,
          description: tPhase.description,
          order_index: tPhase.order_index,
          status: 'pending',
          source_template_phase_id: tPhase.id,
        })
        .select()
        .single()

      if (phaseError) {
        console.error('import-template phase insert error:', { projectId, templatePhaseId: tPhase.id, error: phaseError })
        throw new Error(`Nu s-a putut crea faza "${tPhase.name}". Verifică dacă migrarea DB este aplicată.`)
      }
      if (!newPhase) {
        throw new Error(`Faza "${tPhase.name}" nu a returnat un ID după creare.`)
      }

      const { data: templateActivities } = await supabaseAdmin
        .from('template_activities')
        .select('*')
        .eq('template_phase_id', tPhase.id)
        .eq('is_active', true)
        .order('order_index')

      for (const tActivity of templateActivities || []) {
        const { data: newActivity, error: activityError } = await supabaseAdmin
          .from('project_activities')
          .insert({
            phase_id: newPhase.id,
            name: tActivity.name,
            description: tActivity.description,
            order_index: tActivity.order_index,
            status: 'pending',
            source_template_activity_id: tActivity.id,
          })
          .select()
          .single()

        if (activityError) {
          console.error('import-template activity insert error:', {
            projectId,
            templateActivityId: tActivity.id,
            templatePhaseId: tPhase.id,
            error: activityError,
          })
          throw new Error(`Nu s-a putut crea activitatea "${tActivity.name}".`)
        }
        if (!newActivity) {
          throw new Error(`Activitatea "${tActivity.name}" nu a returnat un ID după creare.`)
        }

        const { data: templateDocs } = await supabaseAdmin
          .from('template_document_requirements')
          .select('*, attachments:document_requirement_attachments(id, storage_path, original_name, mime_type, file_size, order_index, missing_at, missing_checked_at)')
          .eq('template_activity_id', tActivity.id)
          .eq('is_active', true)
          .order('order_index')

        for (const tDoc of templateDocs || []) {
          const templateAttachments = tDoc.attachments?.length
            ? [...tDoc.attachments].sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
            : tDoc.attachment_path
            ? [{ id: null, storage_path: tDoc.attachment_path, original_name: tDoc.attachment_original_name, missing_at: tDoc.attachment_missing_at }]
            : []
          const checkedAttachments = await Promise.all(templateAttachments.map(async (attachment: any) => ({
            ...attachment,
            available: await storagePathExists(attachment.storage_path),
          })))
          const availableAttachments = checkedAttachments.filter((attachment: any) => attachment.available)
          const firstAttachment = availableAttachments[0] || null
          const attachmentPath = firstAttachment?.storage_path || null
          const attachmentAvailable = availableAttachments.length > 0
          const attachmentCheckedAt = templateAttachments.length > 0 ? new Date().toISOString() : null
          const isOutgoing = tDoc.is_outgoing === true

          if (templateAttachments.length > 0 && !attachmentAvailable) {
            await Promise.all([
              supabaseAdmin
                .from('template_document_requirements')
                .update({
                  attachment_missing_at: tDoc.attachment_missing_at || attachmentCheckedAt,
                  attachment_missing_checked_at: attachmentCheckedAt,
                })
                .eq('attachment_path', attachmentPath),
              supabaseAdmin
                .from('document_requirements')
                .update({
                  attachment_missing_at: tDoc.attachment_missing_at || attachmentCheckedAt,
                  attachment_missing_checked_at: attachmentCheckedAt,
                })
                .eq('attachment_path', attachmentPath)
                .is('deleted_at', null),
            ])
          } else if (templateAttachments.length > 0 && tDoc.attachment_missing_at) {
            await Promise.all([
              supabaseAdmin
                .from('template_document_requirements')
                .update({
                  attachment_missing_at: null,
                  attachment_missing_checked_at: attachmentCheckedAt,
                })
                .eq('attachment_path', attachmentPath),
              supabaseAdmin
                .from('document_requirements')
                .update({
                  attachment_missing_at: null,
                  attachment_missing_checked_at: attachmentCheckedAt,
                })
                .eq('attachment_path', attachmentPath)
                .is('deleted_at', null),
            ])
          }

          checkedAttachments.filter((attachment: any) => !attachment.available).forEach((attachment: any) => warnings.push({
            type: 'missing_template_attachment',
            template_document_requirement_id: tDoc.id,
            name: tDoc.name,
            attachment_path: attachment.storage_path,
          }))

          if (isOutgoing && (!templateAttachments.length || !attachmentAvailable)) {
            if (!templateAttachments.length) {
              warnings.push({
                type: 'missing_template_attachment',
                template_document_requirement_id: tDoc.id,
                name: tDoc.name,
                attachment_path: null,
              })
            }
            continue
          }

          const { data: createdDocument, error: docInsertError } = await supabaseAdmin
            .from('document_requirements')
            .insert({
              project_id: projectId,
              activity_id: newActivity.id,
              name: tDoc.name,
              description: tDoc.description,
              is_mandatory: isOutgoing ? false : tDoc.is_mandatory,
              requirement_type: isOutgoing ? 'optional' : tDoc.requirement_type,
              is_outgoing: isOutgoing,
              order_index: tDoc.order_index,
              attachment_path: attachmentAvailable ? attachmentPath : null,
              attachment_original_name: firstAttachment?.original_name || null,
              attachment_missing_at: null,
              attachment_missing_checked_at: attachmentCheckedAt,
              status: 'pending',
              created_by: auth.profile.id,
              source_template_document_requirement_id: tDoc.id,
            })
            .select('id')
            .single()

          if (docInsertError) {
            console.error('import-template document requirement insert error:', {
              projectId,
              templateDocumentRequirementId: tDoc.id,
              templateActivityId: tActivity.id,
              error: docInsertError,
            })
            throw new Error(`Nu s-a putut crea cererea de document "${tDoc.name}".`)
          }

          if (createdDocument && checkedAttachments.length > 0) {
            const { error: attachmentInsertError } = await supabaseAdmin
              .from('document_requirement_attachments')
              .insert(checkedAttachments.map((attachment: any, index: number) => ({
                document_requirement_id: createdDocument.id,
                source_template_attachment_id: attachment.id || null,
                storage_path: attachment.storage_path,
                original_name: attachment.original_name || null,
                mime_type: attachment.mime_type || null,
                file_size: typeof attachment.file_size === 'number' ? attachment.file_size : null,
                order_index: index,
                missing_at: attachment.available ? null : attachment.missing_at || attachmentCheckedAt,
                missing_checked_at: attachmentCheckedAt,
                created_by: auth.profile.id,
              })))
            if (attachmentInsertError) throw attachmentInsertError
          }
        }
      }
    }

    const { data: firstPhase } = await supabaseAdmin
      .from('project_phases')
      .select('id, project_status_id')
      .eq('project_id', projectId)
      .order('order_index')
      .limit(1)
      .single()

    if (firstPhase) {
      await supabaseAdmin
        .from('project_phases')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', firstPhase.id)

      await supabaseAdmin
        .from('projects')
        .update({ 
          template_id: template_id,
          current_status_id: firstPhase.project_status_id
        })
        .eq('id', projectId)
    }

    await logAction({
      actorId: auth.profile.id,
      actionType: 'create',
      entityType: 'project',
      entityId: projectId,
      entityName: project.title,
      newValues: {
        template_id,
        template_name: template.name,
        phases_created: templatePhases.length,
        warnings_count: warnings.length,
      },
      description: `Import template "${template.name}" in proiectul ${project.title} (${templatePhases.length} faze)`,
      request: req,
    })

    return NextResponse.json({
      success: true,
      message: `Template "${template.name}" importat cu succes`,
      phases_created: templatePhases.length,
      warnings,
    })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/import-template error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
