/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectManager } from '@/app/api/_utils/auth'
import { logActions, type LogActionParams } from '@/app/api/_utils/audit'
import { sendActivityAssignedEmails } from '@/app/api/_utils/activity-assignment-email'
import { createStoragePathChecker, loadTemplateTree } from '@/app/api/_utils/template-tree'
import { buildAssignmentEmailIdempotencyKey, isUuid } from '@/lib/notification-utils'
import { mapWithConcurrency } from '@/lib/template-tree'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * assignments conține numai alegerile explicite: cheia absentă păstrează
 * consultantul implicit din șablon, iar null înseamnă neasignat explicit.
 */
function parseAssignments(value: unknown): Map<string, string | null> | null {
  if (value === undefined || value === null) return new Map()
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const assignments = new Map<string, string | null>()
  for (const [templateActivityId, consultantId] of Object.entries(value)) {
    if (!isUuid(templateActivityId)) return null
    if (consultantId === null) {
      assignments.set(templateActivityId, null)
      continue
    }
    if (typeof consultantId !== 'string' || !isUuid(consultantId.trim())) return null
    assignments.set(templateActivityId, consultantId.trim())
  }
  return assignments
}

type InactiveAssignment = { activity_id: string; consultant_id: string; reason: 'inactive_consultant' | 'consultant_not_found' | 'not_consultant' }

function inactiveAssignmentDetails(error: unknown): InactiveAssignment[] | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown }
  if (candidate.code !== 'P0001' || candidate.message !== 'INACTIVE_ASSIGNMENT' || typeof candidate.details !== 'string') return null
  try {
    const parsed = JSON.parse(candidate.details) as { invalid_assignments?: unknown }
    if (!Array.isArray(parsed.invalid_assignments)) return null
    const assignments = parsed.invalid_assignments
    if (!assignments.every(item =>
      item && typeof item === 'object'
      && typeof item.activity_id === 'string'
      && typeof item.consultant_id === 'string'
      && (item.reason === 'inactive_consultant'
        || item.reason === 'consultant_not_found'
        || item.reason === 'not_consultant')
    )) return null
    return assignments.map((item: any) => ({
      activity_id: item.activity_id,
      consultant_id: item.consultant_id,
      reason: item.reason,
    }))
  } catch {
    return null
  }
}

// POST /api/projects/[id]/import-template
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId } = await params
    // Importul face parte din deschiderea dosarului și poate aduce consultanți
    // în echipă: doar adminul și seniorul membru, ca la gestionarea echipei.
    // Juniorul nu deschide dosare, iar clientul nu are acces la șabloane.
    const auth = await requireProjectManager(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json()
    const { template_id } = body

    if (typeof template_id !== 'string' || !isUuid(template_id)) {
      return NextResponse.json({ error: 'template_id este obligatoriu' }, { status: 400 })
    }
    const assignments = parseAssignments(body.assignments)
    if (!assignments) {
      return NextResponse.json({ error: 'assignments trebuie să fie { id activitate din șablon: id consultant sau null }' }, { status: 400 })
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

    // Cheile vechi din formular se ignoră. Cheia absentă folosește implicitul;
    // cheia cu null îl suprascrie explicit.
    const templateActivityTargets = templatePhases.flatMap((phase: any) =>
      phase.activities.map((activity: any) => {
        const explicit = assignments.has(activity.id)
        return {
          activity,
          phase,
          explicit,
          consultantId: explicit ? assignments.get(activity.id) : activity.default_consultant_id ?? null,
        }
      })
    )
    const assigneeIds = [...new Set(templateActivityTargets
      .map((target: any) => target.consultantId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))]
    const [{ data: assigneeRows, error: assigneesError }] = await Promise.all([
      assigneeIds.length === 0
        ? Promise.resolve({ data: [] as any[], error: null })
        : supabaseAdmin.from('profiles').select('id, role, is_active, email, full_name').in('id', assigneeIds),
      mapWithConcurrency(uniquePaths, 8, async path => {
        if (await pathExists(path)) available.add(path)
      }),
    ])
    if (assigneesError) throw assigneesError
    const assigneeById = new Map((assigneeRows ?? []).map((row: any) => [row.id as string, row]))
    const invalidAssignments = templateActivityTargets
      .filter((target: any) => target.explicit && typeof target.consultantId === 'string')
      .flatMap((target: any) => {
        const profile = assigneeById.get(target.consultantId)
        const reason = !profile ? 'consultant_not_found'
          : profile.role !== 'consultant' ? 'not_consultant'
          : profile.is_active === false ? 'inactive_consultant'
          : null
        return reason
          ? [{ activity_id: target.activity.id, consultant_id: target.consultantId, reason }]
          : []
      })
    if (invalidAssignments.length > 0) {
      return NextResponse.json({
        code: 'INACTIVE_ASSIGNMENT',
        message: 'Un consultant selectat nu mai poate fi atribuit. Alege un consultant activ și reîncearcă.',
        details: { invalid_assignments: invalidAssignments },
      }, { status: 409 })
    }

    const warnings: Array<{ type: string; template_document_requirement_id: string; name: string; attachment_path: string | null }> = []
    const missingMarks: PromiseLike<unknown>[] = []
    const now = new Date().toISOString()
    const phaseRows: any[] = []
    const activityRows: any[] = []
    const docRows: any[] = []
    const attachmentRows: any[] = []
    // Payloadul conține doar activitățile cu un consultant efectiv: cheia null
    // blochează implicitul fără a crea o atribuire.
    const assignmentInputs: Array<{ activity_id: string; consultant_id: string; explicit: boolean; template_activity_id: string }> = []
    const assignmentContextById = new Map<string, { id: string; consultantId: string; name: string; phaseName: string; explicit: boolean }>()
    let assignedActivities: Array<{ id: string; consultantId: string; name: string; phaseName: string; updatedAt: string }> = []
    let omittedAssignments: Array<{ activity_id: string; consultant_id: string; template_activity_id: string }> = []

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
        const explicit = assignments.has(tActivity.id)
        const consultantId = explicit ? assignments.get(tActivity.id) : tActivity.default_consultant_id ?? null
        if (typeof consultantId === 'string' && consultantId.length > 0) {
          assignmentInputs.push({
            activity_id: activityId,
            consultant_id: consultantId,
            explicit,
            template_activity_id: tActivity.id,
          })
          assignmentContextById.set(activityId, { id: activityId, consultantId, name: tActivity.name, phaseName: tPhase.name, explicit })
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
    let finalizeCommitted = false
    try {
      const { error: phaseError } = await supabaseAdmin.from('project_phases').insert(phaseRows)
      if (phaseError) {
        console.error('import-template phase insert error:', { projectId, error: phaseError })
        throw new Error('Nu s-au putut crea fazele proiectului.')
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

      const { data: finalized, error: finalizeError } = await supabaseAdmin.rpc('finalize_template_import', {
        p_project_id: projectId,
        p_template_id: template_id,
        p_first_status_id: phaseRows[0].project_status_id,
        p_actor_id: auth.user.id,
        p_assignments: assignmentInputs,
      })
      if (finalizeError) throw finalizeError
      finalizeCommitted = true

      if (!finalized || !Array.isArray(finalized.assigned)
        || !Array.isArray(finalized.added_members) || !Array.isArray(finalized.omitted)) {
        throw new Error('Contract invalid pentru finalizarea importului.')
      }

      addedMembers = finalized.added_members
      omittedAssignments = finalized.omitted
      const assignedRows = finalized.assigned
      const returnedAssignmentIds = new Set<string>()
      assignedActivities = assignedRows.map((row: any) => {
        const context = assignmentContextById.get(row?.id)
        if (!context || context.consultantId !== row.consultant_id
          || typeof row.updated_at !== 'string' || !isUuid(row.id) || !isUuid(row.consultant_id)
          || returnedAssignmentIds.has(row.id)) {
          throw new Error('Contract invalid pentru asignările importului.')
        }
        returnedAssignmentIds.add(row.id)
        return { ...context, consultantId: row.consultant_id, updatedAt: row.updated_at }
      })

      const omittedIds = new Set<string>()
      for (const row of omittedAssignments) {
        const context = assignmentContextById.get(row?.activity_id)
        if (!context || context.explicit || context.consultantId !== row.consultant_id
          || !isUuid(row.activity_id) || !isUuid(row.consultant_id)
          || !isUuid(row.template_activity_id) || omittedIds.has(row.activity_id)) {
          throw new Error('Contract invalid pentru asignările omise la import.')
        }
        omittedIds.add(row.activity_id)
      }
      if (returnedAssignmentIds.size + omittedIds.size !== assignmentInputs.length
        || assignmentInputs.some(item => !returnedAssignmentIds.has(item.activity_id) && !omittedIds.has(item.activity_id))) {
        throw new Error('Contract incomplet pentru asignările importului.')
      }
      if (addedMembers.some((row: any) => !row || !isUuid(row.id) || !isUuid(row.consultant_id))) {
        throw new Error('Contract invalid pentru membrii adăugați la import.')
      }
    } catch (error) {
      if (finalizeCommitted) {
        console.error('import-template could not validate committed result:', error)
        return NextResponse.json({ error: 'Nu putem confirma importul. Verifică proiectul înainte de a încerca din nou.' }, { status: 500 })
      }
      // RPC-ul este atomic; la eșec curățăm doar rândurile create înaintea lui.
      const cleanupErrors: Array<{ step: string; error: unknown }> = []
      if (docRows.length > 0) {
        const { error: deleteDocsError } = await supabaseAdmin
          .from('document_requirements')
          .delete()
          .in('id', docRows.map(row => row.id))
        if (deleteDocsError) cleanupErrors.push({ step: 'document_requirements', error: deleteDocsError })
      }
      const { error: deletePhasesError } = await supabaseAdmin
        .from('project_phases')
        .delete()
        .in('id', phaseRows.map(row => row.id))
      if (deletePhasesError) cleanupErrors.push({ step: 'project_phases', error: deletePhasesError })

      if (cleanupErrors.length > 0) {
        console.error('import-template cleanup failed:', { projectId, cleanupErrors })
        return NextResponse.json({
          error: 'Importul a eșuat și nu am putut curăța toate datele create. Contactează un administrator.',
        }, { status: 500 })
      }

      const invalid = inactiveAssignmentDetails(error)
      if (invalid) {
        return NextResponse.json({
          code: 'INACTIVE_ASSIGNMENT',
          message: 'Un consultant selectat nu mai poate fi atribuit. Alege un consultant activ și reîncearcă.',
          details: { invalid_assignments: invalid },
        }, { status: 409 })
      }
      throw error
    }

    const importWarnings = [
      ...warnings,
      ...omittedAssignments.map(item => ({
        type: 'inactive_default_assignment',
        activity_id: item.activity_id,
        template_activity_id: item.template_activity_id,
        consultant_id: item.consultant_id,
        name: assignmentContextById.get(item.activity_id)?.name ?? item.template_activity_id,
      })),
    ]

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
          warnings_count: importWarnings.length,
          assignments: assignedActivities.map(activity => ({ activity: activity.name, consultant: memberLabel(activity.consultantId) })),
          assignments_omitted: omittedAssignments.map(item => ({ template_activity_id: item.template_activity_id, consultant_id: item.consultant_id })),
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

    // Finalizarea atomică a actualizat deja proiectul și atribuirea. Auditul
    // și emailurile folosesc numai asignările confirmate de RPC.
    await Promise.all([
      ...missingMarks,
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
          version: activity.updatedAt,
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
      assignments_omitted: omittedAssignments.map(item => ({
        activity_id: item.activity_id,
        template_activity_id: item.template_activity_id,
        consultant_id: item.consultant_id,
      })),
      warnings: importWarnings,
    })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/import-template error:', error)
    return NextResponse.json({ error: 'Importul șablonului a eșuat.' }, { status: 500 })
  }
}
