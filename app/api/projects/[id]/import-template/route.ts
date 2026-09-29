/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canReadTemplate, requireProfile } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { createStoragePathChecker, loadTemplateTree } from '@/app/api/_utils/template-tree'
import { mapWithConcurrency } from '@/lib/template-tree'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    if (!canReadTemplate(auth.profile.role)) {
      return NextResponse.json({ error: 'Forbidden: template access denied' }, { status: 403 })
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
      .select('id, name, status, is_active')
      .eq('id', template_id)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template negăsit' }, { status: 404 })
    }
    if (template.status !== 'published' || !template.is_active) {
      return NextResponse.json({ error: 'Doar template-urile publicate și active pot fi importate' }, { status: 400 })
    }

    // Arborele vine în patru cereri paralele, iar proiectul se scrie cu câte
    // un insert per nivel. Înainte, fiecare fază, activitate și cerere era o
    // cerere separată, una după alta, deci importul creștea cu mărimea șablonului.
    const tree = await loadTemplateTree(supabaseAdmin, template_id, 'id')
    const templatePhases: any[] = tree?.phases ?? []

    if (templatePhases.length === 0) {
      return NextResponse.json({ error: 'Template-ul nu are faze' }, { status: 400 })
    }

    const attachmentsOf = (tDoc: any) => tDoc.attachments?.length
      ? [...tDoc.attachments].sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
      : tDoc.attachment_path
      ? [{ id: null, storage_path: tDoc.attachment_path, original_name: tDoc.attachment_original_name, missing_at: tDoc.attachment_missing_at }]
      : []

    // Fiecare cale din storage se verifică o singură dată, câteva în paralel.
    const allDocs = templatePhases.flatMap(phase => phase.activities.flatMap((activity: any) => activity.document_requirements))
    const uniquePaths = [...new Set(allDocs.flatMap(doc => attachmentsOf(doc).map((attachment: any) => attachment.storage_path)))]
    const pathExists = createStoragePathChecker(supabaseAdmin)
    const available = new Set<string>()
    await mapWithConcurrency(uniquePaths, 8, async path => {
      if (await pathExists(path)) available.add(path)
    })

    const warnings: Array<{ type: string; template_document_requirement_id: string; name: string; attachment_path: string | null }> = []
    const missingMarks: PromiseLike<unknown>[] = []
    const now = new Date().toISOString()
    const phaseRows: any[] = []
    const activityRows: any[] = []
    const docRows: any[] = []
    const attachmentRows: any[] = []

    templatePhases.forEach((tPhase, phaseIndex) => {
      const phaseId = crypto.randomUUID()
      phaseRows.push({
        id: phaseId,
        project_id: projectId,
        project_status_id: tPhase.project_status_id,
        name: tPhase.name,
        slug: tPhase.slug,
        description: tPhase.description,
        order_index: tPhase.order_index,
        // Prima fază pornește odată cu importul.
        status: phaseIndex === 0 ? 'in_progress' : 'pending',
        ...(phaseIndex === 0 ? { started_at: now } : {}),
        visibility: 'draft',
        source_template_phase_id: tPhase.id,
      })

      for (const tActivity of tPhase.activities) {
        const activityId = crypto.randomUUID()
        activityRows.push({
          id: activityId,
          phase_id: phaseId,
          name: tActivity.name,
          description: tActivity.description,
          order_index: tActivity.order_index,
          status: 'pending',
          visibility: 'draft',
          source_template_activity_id: tActivity.id,
        })

        for (const tDoc of tActivity.document_requirements) {
          const templateAttachments = attachmentsOf(tDoc)
          const checkedAttachments = templateAttachments.map((attachment: any) => ({
            ...attachment,
            available: available.has(attachment.storage_path),
          }))
          const availableAttachments = checkedAttachments.filter((attachment: any) => attachment.available)
          const firstAttachment = availableAttachments[0] || null
          const attachmentAvailable = availableAttachments.length > 0
          const attachmentCheckedAt = templateAttachments.length > 0 ? now : null
          const isOutgoing = tDoc.is_outgoing === true

          if (templateAttachments.length > 0 && !attachmentAvailable) {
            const missingPath = templateAttachments[0].storage_path
            missingMarks.push(
              supabaseAdmin
                .from('template_document_requirements')
                .update({
                  attachment_missing_at: tDoc.attachment_missing_at || attachmentCheckedAt,
                  attachment_missing_checked_at: attachmentCheckedAt,
                })
                .eq('id', tDoc.id),
              supabaseAdmin
                .from('document_requirements')
                .update({
                  attachment_missing_at: tDoc.attachment_missing_at || attachmentCheckedAt,
                  attachment_missing_checked_at: attachmentCheckedAt,
                })
                .eq('attachment_path', missingPath)
                .is('deleted_at', null),
            )
          } else if (templateAttachments.length > 0 && tDoc.attachment_missing_at) {
            missingMarks.push(
              supabaseAdmin
                .from('template_document_requirements')
                .update({ attachment_missing_at: null, attachment_missing_checked_at: attachmentCheckedAt })
                .eq('id', tDoc.id),
              supabaseAdmin
                .from('document_requirements')
                .update({ attachment_missing_at: null, attachment_missing_checked_at: attachmentCheckedAt })
                .eq('attachment_path', firstAttachment.storage_path)
                .is('deleted_at', null),
            )
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

          const documentId = crypto.randomUUID()
          docRows.push({
            id: documentId,
            project_id: projectId,
            activity_id: activityId,
            name: tDoc.name,
            description: tDoc.description,
            is_mandatory: isOutgoing ? false : tDoc.is_mandatory,
            requirement_type: isOutgoing ? 'optional' : tDoc.requirement_type,
            is_outgoing: isOutgoing,
            order_index: tDoc.order_index,
            attachment_path: attachmentAvailable ? firstAttachment.storage_path : null,
            attachment_original_name: firstAttachment?.original_name || null,
            attachment_missing_at: null,
            attachment_missing_checked_at: attachmentCheckedAt,
            status: 'pending',
            visibility: 'draft',
            created_by: auth.profile.id,
            source_template_document_requirement_id: tDoc.id,
          })
          checkedAttachments.forEach((attachment: any, index: number) => attachmentRows.push({
            document_requirement_id: documentId,
            source_template_attachment_id: attachment.id || null,
            storage_path: attachment.storage_path,
            original_name: attachment.original_name || null,
            mime_type: attachment.mime_type || null,
            file_size: typeof attachment.file_size === 'number' ? attachment.file_size : null,
            order_index: index,
            missing_at: attachment.available ? null : attachment.missing_at || attachmentCheckedAt,
            missing_checked_at: attachmentCheckedAt,
            created_by: auth.profile.id,
          }))
        }
      }
    })

    try {
      const { error: phaseError } = await supabaseAdmin.from('project_phases').insert(phaseRows)
      if (phaseError) {
        console.error('import-template phase insert error:', { projectId, error: phaseError })
        throw new Error('Nu s-au putut crea fazele proiectului. Verifică dacă migrarea DB este aplicată.')
      }
      if (activityRows.length > 0) {
        const { error: activityError } = await supabaseAdmin.from('project_activities').insert(activityRows)
        if (activityError) {
          console.error('import-template activity insert error:', { projectId, error: activityError })
          throw new Error('Nu s-au putut crea activitățile proiectului.')
        }
      }
      if (docRows.length > 0) {
        const { error: docInsertError } = await supabaseAdmin.from('document_requirements').insert(docRows)
        if (docInsertError) {
          console.error('import-template document requirement insert error:', { projectId, error: docInsertError })
          throw new Error('Nu s-au putut crea cererile de document ale proiectului.')
        }
      }
      if (attachmentRows.length > 0) {
        const { error: attachmentInsertError } = await supabaseAdmin.from('document_requirement_attachments').insert(attachmentRows)
        if (attachmentInsertError) throw attachmentInsertError
      }
    } catch (error) {
      // Nimic parțial: cererile nu cad odată cu activitatea (SET NULL), deci
      // se șterg explicit; fazele iau activitățile cu ele.
      if (docRows.length > 0) {
        await supabaseAdmin.from('document_requirements').delete().in('id', docRows.map(row => row.id))
      }
      await supabaseAdmin.from('project_phases').delete().in('id', phaseRows.map(row => row.id))
      throw error
    }

    await Promise.all([
      ...missingMarks,
      supabaseAdmin
        .from('projects')
        .update({
          template_id: template_id,
          current_status_id: phaseRows[0].project_status_id
        })
        .eq('id', projectId),
    ])

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
