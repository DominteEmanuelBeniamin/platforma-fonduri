/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectManager } from '@/app/api/_utils/auth'
import { logActions, type LogActionParams } from '@/app/api/_utils/audit'
import { sendActivityAssignedEmails } from '@/app/api/_utils/activity-assignment-email'
import { createStoragePathChecker, loadTemplateTree } from '@/app/api/_utils/template-tree'
import { buildAssignmentEmailIdempotencyKey } from '@/lib/notification-utils'
import { mapWithConcurrency } from '@/lib/template-tree'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * `assignments`: consultantul ales în formularul „Dosar nou” pentru fiecare
 * activitate din șablon, `{ id activitate din șablon: id consultant }`.
 * Lipsa lui înseamnă import fără atribuiri; `null` la o formă greșită.
 */
function parseAssignments(value: unknown): Map<string, string> | null {
  if (value === undefined || value === null) return new Map()
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const assignments = new Map<string, string>()
  for (const [templateActivityId, consultantId] of Object.entries(value)) {
    if (typeof consultantId !== 'string' || !consultantId.trim()) return null
    assignments.set(templateActivityId, consultantId.trim())
  }
  return assignments
}

// POST /api/projects/[id]/import-template
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId } = await params
    // Importul face parte din deschiderea dosarului și poate aduce consultanți
    // în echipă: doar adminul și seniorul membru, ca la gestionarea echipei.
    // Juniorul nu deschide dosare, iar clientul nu are acces la șabloane.
    const auth = await requireProjectManager(req, projectId, { write: true })
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status })
    }

    const body = await req.json()
    const { template_id } = body

    if (!template_id) {
      return NextResponse.json({ error: 'template_id este obligatoriu' }, { status: 400 })
    }
    const assignments = parseAssignments(body.assignments)
    if (!assignments) {
      return NextResponse.json({ error: 'assignments trebuie să fie { id activitate din șablon: id consultant }' }, { status: 400 })
    }

    // Cele trei verificări nu depind una de alta: pleacă împreună, iar
    // răspunsurile se judecă în aceeași ordine ca înainte.
    const [
      { data: project, error: projectError },
      { data: existingPhases },
      { data: template, error: templateError },
    ] = await Promise.all([
      supabaseAdmin
        .from('projects')
        .select('id, title')
        .eq('id', projectId)
        .single(),
      supabaseAdmin
        .from('project_phases')
        .select('id')
        .eq('project_id', projectId)
        .limit(1),
      supabaseAdmin
        .from('project_templates')
        .select('id, name, status, is_active')
        .eq('id', template_id)
        .single(),
    ])

    if (projectError || !project) {
      return NextResponse.json({ error: 'Proiect negăsit' }, { status: 404 })
    }

    if (existingPhases && existingPhases.length > 0) {
      return NextResponse.json({ 
        error: 'Proiectul are deja faze.' 
      }, { status: 400 })
    }

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

    // Atribuirile pentru activități care nu mai sunt în șablon (formular vechi)
    // nu au unde să se aplice și se ignoră. Consultanții se verifică odată cu
    // fișierele, înainte de orice scriere.
    const templateActivityIds = new Set(templatePhases.flatMap(phase => phase.activities.map((activity: any) => activity.id as string)))
    const assigneeIds = [...new Set([...assignments]
      .filter(([templateActivityId]) => templateActivityIds.has(templateActivityId))
      .map(([, consultantId]) => consultantId))]
    const loadAssignees = async () => assigneeIds.length === 0
      ? { data: [] as any[], error: null }
      : await supabaseAdmin.from('profiles').select('id, role, is_active, email, full_name').in('id', assigneeIds)

    const [{ data: assigneeRows, error: assigneesError }] = await Promise.all([
      loadAssignees(),
      mapWithConcurrency(uniquePaths, 8, async path => {
        if (await pathExists(path)) available.add(path)
      }),
    ])
    if (assigneesError) throw assigneesError
    const assigneeById = new Map((assigneeRows ?? []).map((row: any) => [row.id as string, row]))
    // Aceleași condiții ca triggerul de notificare, care ar refuza atribuirea
    // după ce proiectul a fost deja scris.
    if (assigneeIds.some(id => {
      const assignee = assigneeById.get(id)
      return assignee?.role !== 'consultant' || assignee.is_active === false
    })) {
      return NextResponse.json({ error: 'Activitățile se pot atribui doar consultanților activi.' }, { status: 400 })
    }

    const warnings: Array<{ type: string; template_document_requirement_id: string; name: string; attachment_path: string | null }> = []
    const missingMarks: PromiseLike<unknown>[] = []
    const now = new Date().toISOString()
    const phaseRows: any[] = []
    const activityRows: any[] = []
    const docRows: any[] = []
    const attachmentRows: any[] = []
    // Activitățile noi cu consultant ales, legate de șablon prin id, nu prin nume.
    const assignedActivities: Array<{ id: string; consultantId: string; name: string; phaseName: string }> = []

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
        const consultantId = assignments.get(tActivity.id)
        if (consultantId) {
          assignedActivities.push({ id: activityId, consultantId, name: tActivity.name, phaseName: tPhase.name })
        }

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

    let addedMembers: Array<{ id: string; consultant_id: string }> = []
    const assignedAt = new Map<string, string>()
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

      if (assignedActivities.length > 0) {
        // Consultantul ales pe o activitate intră în echipă, altfel n-ar vedea
        // proiectul. Supervizorii și cine a creat dosarul sunt deja membri;
        // `ignoreDuplicates` întoarce doar rândurile adăugate acum.
        const { data: added, error: membersError } = await supabaseAdmin
          .from('project_members')
          .upsert(
            assigneeIds.map(consultant_id => ({ project_id: projectId, consultant_id, role_in_project: 'member' })),
            { onConflict: 'project_id,consultant_id', ignoreDuplicates: true },
          )
          .select('id, consultant_id')
        if (membersError) throw membersError
        addedMembers = added ?? []

        // Atribuirea trece printr-un UPDATE, câte unul per consultant, nu prin
        // insert: triggerul de notificări pornește doar la UPDATE, deci fiecare
        // consultant e anunțat ca la o atribuire făcută din proiect.
        const activityIdsByConsultant = new Map<string, string[]>()
        for (const activity of assignedActivities) {
          activityIdsByConsultant.set(activity.consultantId, [...(activityIdsByConsultant.get(activity.consultantId) ?? []), activity.id])
        }
        const updates = await Promise.all([...activityIdsByConsultant].map(([consultantId, activityIds]) => supabaseAdmin
          .from('project_activities')
          .update({ assigned_to: consultantId, assigned_by: auth.user.id })
          .in('id', activityIds)
          .select('id, updated_at')))
        for (const { data, error: assignError } of updates) {
          if (assignError) throw assignError
          for (const row of data ?? []) assignedAt.set(row.id, row.updated_at)
        }
      }
    } catch (error) {
      // Nimic parțial: cererile nu cad odată cu activitatea (SET NULL), deci
      // se șterg explicit; fazele iau activitățile cu ele.
      if (docRows.length > 0) {
        await supabaseAdmin.from('document_requirements').delete().in('id', docRows.map(row => row.id))
      }
      await supabaseAdmin.from('project_phases').delete().in('id', phaseRows.map(row => row.id))
      if (addedMembers.length > 0) {
        await supabaseAdmin.from('project_members').delete().in('id', addedMembers.map(member => member.id))
      }
      throw error
    }

    const memberLabel = (consultantId: string) => {
      const profile = assigneeById.get(consultantId)
      return profile?.email ?? profile?.full_name ?? consultantId
    }
    const auditEntries: LogActionParams[] = [
      {
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
          assignments: assignedActivities.map(activity => ({ activity: activity.name, consultant: memberLabel(activity.consultantId) })),
          members_added: addedMembers.map(member => memberLabel(member.consultant_id)),
        },
        description: `Import template "${template.name}" in proiectul ${project.title} (${templatePhases.length} faze)`,
        request: req,
      },
      // Ca la adăugarea din panoul echipei, fiecare membru nou are intrarea lui.
      ...addedMembers.map(member => {
        const profile = assigneeById.get(member.consultant_id)
        return {
          actorId: auth.profile.id,
          actionType: 'create',
          entityType: 'project_member',
          entityId: member.id,
          entityName: memberLabel(member.consultant_id),
          newValues: {
            project_id: projectId,
            project_title: project.title,
            consultant_id: member.consultant_id,
            consultant_name: profile?.full_name ?? null,
            consultant_email: profile?.email ?? null,
            role_in_project: 'member',
            source: 'import-template',
          },
          description: `Adaugare membru ${memberLabel(member.consultant_id)} in proiectul "${project.title}" (consultant pe activitati din sablon)`,
          request: req,
        }
      }),
    ]

    // Emailurile de atribuire pleacă într-un singur lot, iar auditul într-un
    // singur insert, în paralel cu ultimele actualizări ale proiectului.
    await Promise.all([
      ...missingMarks,
      supabaseAdmin
        .from('projects')
        .update({
          template_id: template_id,
          current_status_id: phaseRows[0].project_status_id
        })
        .eq('id', projectId),
      sendActivityAssignedEmails(assignedActivities.map(activity => ({
        consultantId: activity.consultantId,
        activityName: activity.name,
        phaseName: activity.phaseName,
        projectId,
        projectTitle: project.title,
        deadlineAt: null,
        idempotencyKey: buildAssignmentEmailIdempotencyKey({
          projectId,
          entityType: 'activity',
          entityId: activity.id,
          recipientId: activity.consultantId,
          version: assignedAt.get(activity.id) ?? now,
        }),
      }))),
      logActions(auditEntries),
    ])

    return NextResponse.json({
      success: true,
      message: `Template "${template.name}" importat cu succes`,
      phases_created: templatePhases.length,
      assignments: assignedActivities.length,
      members_added: addedMembers.length,
      warnings,
    })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/import-template error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
