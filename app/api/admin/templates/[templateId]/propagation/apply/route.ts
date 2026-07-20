/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'project-files'

interface RouteParams {
  params: Promise<{ templateId: string }>
}

type RollbackTracker = {
  phaseIds: string[]
  activityIds: string[]
  documentRequirementIds: string[]
  phaseUpdates: Array<{ id: string; name: string; project_status_id: string | null }>
  activityUpdates: Array<{ id: string; name: string }>
  documentRequirementUpdates: Array<{
    id: string
    activity_id: string | null
    is_outgoing: boolean | null
    is_mandatory: boolean | null
    requirement_type: string | null
    attachment_path: string | null
    attachment_original_name: string | null
    attachment_missing_at: string | null
    attachment_missing_checked_at: string | null
  }>
  restoredDocumentRequirements: Array<{
    id: string
    activity_id: string | null
    name: string
    description: string | null
    is_outgoing: boolean | null
    is_mandatory: boolean | null
    requirement_type: string | null
    status: string
    order_index: number
    attachment_path: string | null
    attachment_original_name: string | null
    attachment_missing_at: string | null
    attachment_missing_checked_at: string | null
    deleted_at: string | null
    deleted_by: string | null
    delete_reason: string | null
  }>
}

async function storagePathExists(path: string) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) return false

  try {
    const res = await fetch(data.signedUrl, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function syncProjectAttachments(documentId: string, attachments: any[], actorId: string) {
  const { error: deleteError } = await supabaseAdmin
    .from('document_requirement_attachments')
    .delete()
    .eq('document_requirement_id', documentId)
  if (deleteError) throw deleteError
  if (attachments.length === 0) return
  const { error } = await supabaseAdmin.from('document_requirement_attachments').insert(
    attachments.map((attachment: any, index: number) => ({
      document_requirement_id: documentId,
      source_template_attachment_id: attachment.id || null,
      storage_path: attachment.storage_path,
      original_name: attachment.original_name || null,
      mime_type: attachment.mime_type || null,
      file_size: typeof attachment.file_size === 'number' ? attachment.file_size : null,
      order_index: index,
      missing_at: attachment.missing_at || null,
      missing_checked_at: attachment.missing_checked_at || null,
      created_by: actorId,
    }))
  )
  if (error) throw error
}

async function loadTemplate(templateId: string) {
  const { data: phases, error: phasesError } = await supabaseAdmin
    .from('template_phases')
    .select('*')
    .eq('template_id', templateId)
    .eq('is_active', true)
    .order('order_index')

  if (phasesError) throw phasesError

  return Promise.all((phases ?? []).map(async (phase: any) => {
    const { data: activities, error: activitiesError } = await supabaseAdmin
      .from('template_activities')
      .select('*')
      .eq('template_phase_id', phase.id)
      .eq('is_active', true)
      .order('order_index')

    if (activitiesError) throw activitiesError

    const activitiesWithDocs = await Promise.all((activities ?? []).map(async (activity: any) => {
      const { data: docs, error: docsError } = await supabaseAdmin
        .from('template_document_requirements')
        .select('*, attachments:document_requirement_attachments(id, storage_path, original_name, mime_type, file_size, order_index, missing_at, missing_checked_at)')
        .eq('template_activity_id', activity.id)
        .eq('is_active', true)
        .order('order_index')

      if (docsError) throw docsError
      return { ...activity, document_requirements: docs ?? [] }
    }))

    return { ...phase, activities: activitiesWithDocs }
  }))
}

async function loadProjectLineage(projectId: string) {
  const { data: phases, error: phasesError } = await supabaseAdmin
    .from('project_phases')
    .select('id, source_template_phase_id, name, project_status_id')
    .eq('project_id', projectId)

  if (phasesError) throw phasesError

  const phaseRows = phases ?? []
  const phaseIds = phaseRows.map((phase: any) => phase.id)
  const { data: activities, error: activitiesError } = await supabaseAdmin
    .from('project_activities')
    .select('id, phase_id, source_template_activity_id, name')
    .in('phase_id', phaseIds)

  if (activitiesError) throw activitiesError
  const activityRows = activities ?? []

  const { data: docs, error: docsError } = await supabaseAdmin
    .from('document_requirements')
    .select(`
      id,
      activity_id,
      name,
      description,
      is_outgoing,
      is_mandatory,
      requirement_type,
      status,
      order_index,
      source_template_document_requirement_id,
      attachment_path,
      attachment_original_name,
      attachment_missing_at,
      attachment_missing_checked_at,
      deleted_at,
      deleted_by,
      delete_reason,
      attachments:document_requirement_attachments(id, storage_path, original_name, mime_type, file_size, order_index, missing_at, missing_checked_at, source_template_attachment_id)
    `)
    .eq('project_id', projectId)

  if (docsError) throw docsError
  const docRows = docs ?? []
  const activeDocRows = docRows.filter((doc: any) => !doc.deleted_at)
  const deletedDocRows = docRows.filter((doc: any) => doc.deleted_at)

  return {
    eligible: true,
    reason: null as string | null,
    phaseBySource: new Map(
      phaseRows
        .filter((phase: any) => phase.source_template_phase_id)
        .map((phase: any) => [phase.source_template_phase_id, phase])
    ),
    activityBySource: new Map(
      activityRows
        .filter((activity: any) => activity.source_template_activity_id)
        .map((activity: any) => [activity.source_template_activity_id, activity])
    ),
    docBySource: new Map(
      activeDocRows
        .filter((doc: any) => doc.source_template_document_requirement_id)
        .map((doc: any) => [doc.source_template_document_requirement_id, doc])
    ),
    deletedDocBySource: new Map(
      deletedDocRows
        .filter((doc: any) => doc.source_template_document_requirement_id)
        .map((doc: any) => [doc.source_template_document_requirement_id, doc])
    ),
  }
}

async function insertDocs(
  projectId: string,
  activityId: string,
  templateDocs: any[],
  actorId: string,
  rollback: RollbackTracker,
  deletedDocBySource: Map<string, any>
) {
  let applied = 0
  let skipped = 0
  const warnings: any[] = []

  if (!activityId) {
    throw new Error('Activitatea proiectului nu a putut fi identificată pentru propagarea cererilor de document.')
  }

  for (const tDoc of templateDocs) {
    const templateAttachments = tDoc.attachments?.length
      ? [...tDoc.attachments].sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
      : tDoc.attachment_path
      ? [{ id: null, storage_path: tDoc.attachment_path, original_name: tDoc.attachment_original_name, missing_at: tDoc.attachment_missing_at }]
      : []
    const attachmentPath = templateAttachments[0]?.storage_path || null
    const attachmentAvailable = attachmentPath && !tDoc.attachment_missing_at
      ? await storagePathExists(attachmentPath)
      : false
    const attachmentCheckedAt = attachmentPath ? new Date().toISOString() : null
    const isOutgoing = tDoc.is_outgoing === true

    if (attachmentPath && !attachmentAvailable) {
      warnings.push({
        type: 'missing_template_attachment',
        template_document_requirement_id: tDoc.id,
        name: tDoc.name,
      })
      await supabaseAdmin
        .from('template_document_requirements')
        .update({
          attachment_missing_at: tDoc.attachment_missing_at || attachmentCheckedAt,
          attachment_missing_checked_at: attachmentCheckedAt,
        })
        .eq('id', tDoc.id)
    }

    if (isOutgoing && (!attachmentPath || !attachmentAvailable)) {
      if (!attachmentPath) {
        warnings.push({
          type: 'missing_template_attachment',
          template_document_requirement_id: tDoc.id,
          name: tDoc.name,
        })
      }
      skipped += 1
      continue
    }

    const deletedDoc = deletedDocBySource.get(tDoc.id)
    if (deletedDoc) {
      rollback.restoredDocumentRequirements.push({
        id: deletedDoc.id,
        activity_id: deletedDoc.activity_id ?? null,
        name: deletedDoc.name,
        description: deletedDoc.description ?? null,
        is_outgoing: deletedDoc.is_outgoing ?? null,
        is_mandatory: deletedDoc.is_mandatory ?? null,
        requirement_type: deletedDoc.requirement_type ?? null,
        status: deletedDoc.status,
        order_index: deletedDoc.order_index ?? 0,
        attachment_path: deletedDoc.attachment_path ?? null,
        attachment_original_name: deletedDoc.attachment_original_name ?? null,
        attachment_missing_at: deletedDoc.attachment_missing_at ?? null,
        attachment_missing_checked_at: deletedDoc.attachment_missing_checked_at ?? null,
        deleted_at: deletedDoc.deleted_at ?? null,
        deleted_by: deletedDoc.deleted_by ?? null,
        delete_reason: deletedDoc.delete_reason ?? null,
      })

      const { error } = await supabaseAdmin
        .from('document_requirements')
        .update({
          activity_id: activityId,
          name: tDoc.name,
          description: tDoc.description,
          is_outgoing: isOutgoing,
          is_mandatory: isOutgoing ? false : tDoc.is_mandatory,
          requirement_type: isOutgoing ? 'optional' : tDoc.requirement_type,
          order_index: tDoc.order_index,
          attachment_path: attachmentAvailable ? attachmentPath : null,
          attachment_original_name: attachmentAvailable ? tDoc.attachment_original_name || null : null,
          attachment_missing_at: attachmentPath && !attachmentAvailable ? attachmentCheckedAt : null,
          attachment_missing_checked_at: attachmentCheckedAt,
          status: 'pending',
          deleted_at: null,
          deleted_by: null,
          delete_reason: null,
        })
        .eq('id', deletedDoc.id)

      if (error) throw error
      deletedDocBySource.delete(tDoc.id)
      applied += 1
      continue
    }

    const { data: insertedDoc, error } = await supabaseAdmin
      .from('document_requirements')
      .insert({
        project_id: projectId,
        activity_id: activityId,
        name: tDoc.name,
        description: tDoc.description,
        is_outgoing: isOutgoing,
        is_mandatory: isOutgoing ? false : tDoc.is_mandatory,
        requirement_type: isOutgoing ? 'optional' : tDoc.requirement_type,
        order_index: tDoc.order_index,
        attachment_path: attachmentAvailable ? attachmentPath : null,
        attachment_original_name: attachmentAvailable ? tDoc.attachment_original_name || null : null,
        attachment_missing_at: attachmentPath && !attachmentAvailable ? attachmentCheckedAt : null,
        attachment_missing_checked_at: attachmentCheckedAt,
        status: 'pending',
        created_by: actorId,
        source_template_document_requirement_id: tDoc.id,
      })
      .select('id')
      .single()

    if (error) {
      if ((error as any).code === '23505') {
        throw new Error(`Cererea de document "${tDoc.name}" nu a putut fi propagată deoarece există deja o cerere cu același mapping sau nume în proiect. Reîncarcă preview-ul de propagare și rezolvă conflictul de mapping înainte de aplicare.`)
      }
      throw error
    } else {
      if (insertedDoc?.id) rollback.documentRequirementIds.push(insertedDoc.id)
      if (insertedDoc?.id) await syncProjectAttachments(insertedDoc.id, templateAttachments, actorId)
      applied += 1
    }
  }

  return { applied, skipped, warnings }
}

async function rollbackCreated(rollback: RollbackTracker) {
  for (const doc of rollback.restoredDocumentRequirements.reverse()) {
    await supabaseAdmin
      .from('document_requirements')
      .update({
        activity_id: doc.activity_id,
        name: doc.name,
        description: doc.description,
        is_outgoing: doc.is_outgoing,
        is_mandatory: doc.is_mandatory,
        requirement_type: doc.requirement_type,
        status: doc.status,
        order_index: doc.order_index,
        attachment_path: doc.attachment_path,
        attachment_original_name: doc.attachment_original_name,
        attachment_missing_at: doc.attachment_missing_at,
        attachment_missing_checked_at: doc.attachment_missing_checked_at,
        deleted_at: doc.deleted_at,
        deleted_by: doc.deleted_by,
        delete_reason: doc.delete_reason,
      })
      .eq('id', doc.id)
  }

  for (const doc of rollback.documentRequirementUpdates.reverse()) {
    await supabaseAdmin
      .from('document_requirements')
      .update({
        activity_id: doc.activity_id,
        is_outgoing: doc.is_outgoing,
        is_mandatory: doc.is_mandatory,
        requirement_type: doc.requirement_type,
        attachment_path: doc.attachment_path,
        attachment_original_name: doc.attachment_original_name,
        attachment_missing_at: doc.attachment_missing_at,
        attachment_missing_checked_at: doc.attachment_missing_checked_at,
      })
      .eq('id', doc.id)
  }

  for (const activity of rollback.activityUpdates.reverse()) {
    await supabaseAdmin
      .from('project_activities')
      .update({ name: activity.name })
      .eq('id', activity.id)
  }

  for (const phase of rollback.phaseUpdates.reverse()) {
    await supabaseAdmin
      .from('project_phases')
      .update({ name: phase.name, project_status_id: phase.project_status_id })
      .eq('id', phase.id)
  }

  if (rollback.documentRequirementIds.length > 0) {
    await supabaseAdmin
      .from('document_requirements')
      .delete()
      .in('id', rollback.documentRequirementIds)
  }

  if (rollback.activityIds.length > 0) {
    await supabaseAdmin
      .from('project_activities')
      .delete()
      .in('id', rollback.activityIds)
  }

  if (rollback.phaseIds.length > 0) {
    await supabaseAdmin
      .from('project_phases')
      .delete()
      .in('id', rollback.phaseIds)
  }
}

async function applyToProject(projectId: string, templatePhases: any[], actorId: string) {
  const lineage = await loadProjectLineage(projectId)
  if (!lineage.eligible) {
    return { project_id: projectId, status: 'skipped', reason: lineage.reason }
  }

  const phaseBySource = lineage.phaseBySource as Map<string, any>
  const activityBySource = lineage.activityBySource as Map<string, any>
  const docBySource = lineage.docBySource as Map<string, any>
  const deletedDocBySource = lineage.deletedDocBySource as Map<string, any>
  const totals = { phases: 0, activities: 0, document_requests: 0, skipped: 0 }
  const warnings: any[] = []
  const rollback: RollbackTracker = {
    phaseIds: [],
    activityIds: [],
    documentRequirementIds: [],
    phaseUpdates: [],
    activityUpdates: [],
    documentRequirementUpdates: [],
    restoredDocumentRequirements: [],
  }

  try {
    for (const tPhase of templatePhases) {
      let phaseRow = phaseBySource.get(tPhase.id)
      let phaseId = phaseRow?.id

      if (!phaseRow) {
        const { data: phase, error } = await supabaseAdmin
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
          .select('id, name, project_status_id')
          .single()

        if (error) {
          if ((error as any).code === '23505') {
            throw new Error(`Faza "${tPhase.name}" nu a putut fi propagată deoarece proiectul are deja o fază cu același nume/slug sau același mapping. Reîncarcă preview-ul de propagare și rezolvă conflictul înainte de aplicare.`)
          }
          throw error
        }

        phaseId = phase?.id
        if (!phaseId) throw new Error('Faza creată nu a returnat un ID')
        rollback.phaseIds.push(phaseId)
        phaseRow = phase
        phaseBySource.set(tPhase.id, phaseRow)
        totals.phases += 1
      } else if (phaseRow.name !== tPhase.name || phaseRow.project_status_id !== tPhase.project_status_id) {
        rollback.phaseUpdates.push({
          id: phaseId,
          name: phaseRow.name,
          project_status_id: phaseRow.project_status_id,
        })

        const { error } = await supabaseAdmin
          .from('project_phases')
          .update({
            name: tPhase.name,
            project_status_id: tPhase.project_status_id,
          })
          .eq('id', phaseId)
          .eq('project_id', projectId)

        if (error) throw error
        phaseRow = { ...phaseRow, name: tPhase.name, project_status_id: tPhase.project_status_id }
        phaseBySource.set(tPhase.id, phaseRow)
        totals.phases += 1
      }

      for (const tActivity of tPhase.activities ?? []) {
        let activityRow = activityBySource.get(tActivity.id)
        let activityId = activityRow?.id

        if (!activityRow) {
          const { data: activity, error } = await supabaseAdmin
            .from('project_activities')
            .insert({
              phase_id: phaseId,
              name: tActivity.name,
              description: tActivity.description,
              order_index: tActivity.order_index,
              status: 'pending',
              source_template_activity_id: tActivity.id,
            })
            .select('id, name')
            .single()

          if (error) {
            if ((error as any).code === '23505') {
              throw new Error(`Activitatea "${tActivity.name}" nu a putut fi propagată deoarece faza din proiect are deja o activitate cu același nume sau același mapping. Reîncarcă preview-ul de propagare și rezolvă conflictul înainte de aplicare.`)
            }
            throw error
          }

          activityId = activity?.id
          if (!activityId) throw new Error('Activitatea creată nu a returnat un ID')
          rollback.activityIds.push(activityId)
          activityRow = activity
          activityBySource.set(tActivity.id, activityRow)
          totals.activities += 1
        } else if (activityRow.name !== tActivity.name) {
          rollback.activityUpdates.push({ id: activityId, name: activityRow.name })

          const { error } = await supabaseAdmin
            .from('project_activities')
            .update({ name: tActivity.name })
            .eq('id', activityId)

          if (error) throw error
          activityRow = { ...activityRow, name: tActivity.name }
          activityBySource.set(tActivity.id, activityRow)
          totals.activities += 1
        }

        if (!activityId) {
          throw new Error('Activitatea proiectului nu a putut fi identificată pentru propagarea cererilor de document.')
        }

        for (const tDoc of tActivity.document_requirements ?? []) {
          const docRow = docBySource.get(tDoc.id)
          const templateAttachments = tDoc.attachments?.length
            ? [...tDoc.attachments].sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
            : tDoc.attachment_path
            ? [{ id: null, storage_path: tDoc.attachment_path, original_name: tDoc.attachment_original_name, missing_at: tDoc.attachment_missing_at }]
            : []
          const attachmentPath = templateAttachments[0]?.storage_path || null
          const originalName = templateAttachments[0]?.original_name || null
          const isOutgoing = tDoc.is_outgoing === true
          const shouldMoveToActivity = Boolean(docRow && docRow.activity_id !== activityId)
          const shouldUpdateOutgoing = Boolean(docRow && Boolean(docRow.is_outgoing) !== isOutgoing)
          const shouldUpdateAttachment = Boolean(
            docRow && (
              docRow.attachment_path !== attachmentPath ||
              docRow.attachment_original_name !== originalName ||
              JSON.stringify((docRow.attachments ?? []).map((a: any) => [a.storage_path, a.original_name])) !==
                JSON.stringify(templateAttachments.map((a: any) => [a.storage_path, a.original_name]))
            )
          )

          if (!docRow || (!shouldMoveToActivity && !shouldUpdateAttachment && !shouldUpdateOutgoing)) {
            continue
          }

          if (isOutgoing && (!attachmentPath || tDoc.attachment_missing_at)) {
            warnings.push({
              type: 'missing_template_attachment',
              template_document_requirement_id: tDoc.id,
              name: tDoc.name,
            })
            totals.skipped += 1
            continue
          }

          const checkedAt = attachmentPath ? new Date().toISOString() : null
          const attachmentAvailable = templateAttachments.length === 0
            ? true
            : shouldUpdateAttachment && !tDoc.attachment_missing_at
            ? await storagePathExists(attachmentPath)
            : false

          if (shouldUpdateAttachment && !attachmentAvailable) {
            warnings.push({
              type: 'missing_template_attachment',
              template_document_requirement_id: tDoc.id,
              name: tDoc.name,
            })
            await supabaseAdmin
              .from('template_document_requirements')
              .update({
                attachment_missing_at: tDoc.attachment_missing_at || checkedAt,
                attachment_missing_checked_at: checkedAt,
              })
              .eq('id', tDoc.id)

            if (isOutgoing || (!shouldMoveToActivity && !shouldUpdateOutgoing)) {
              totals.skipped += 1
              continue
            }
          }

          rollback.documentRequirementUpdates.push({
            id: docRow.id,
            activity_id: docRow.activity_id ?? null,
            is_outgoing: docRow.is_outgoing ?? null,
            is_mandatory: docRow.is_mandatory ?? null,
            requirement_type: docRow.requirement_type ?? null,
            attachment_path: docRow.attachment_path ?? null,
            attachment_original_name: docRow.attachment_original_name ?? null,
            attachment_missing_at: docRow.attachment_missing_at ?? null,
            attachment_missing_checked_at: docRow.attachment_missing_checked_at ?? null,
          })

          const updatePayload: Record<string, any> = {}
          if (shouldMoveToActivity) {
            updatePayload.activity_id = activityId
          }
          if (shouldUpdateOutgoing) {
            updatePayload.is_outgoing = isOutgoing
            updatePayload.is_mandatory = isOutgoing ? false : tDoc.is_mandatory
            updatePayload.requirement_type = isOutgoing ? 'optional' : tDoc.requirement_type
          }

          if (shouldUpdateAttachment && attachmentAvailable) {
            updatePayload.attachment_path = attachmentPath
            updatePayload.attachment_original_name = originalName
            updatePayload.attachment_missing_at = null
            updatePayload.attachment_missing_checked_at = checkedAt
          }

          const { error } = await supabaseAdmin
            .from('document_requirements')
            .update(updatePayload)
            .eq('id', docRow.id)
            .is('deleted_at', null)

          if (error) throw error
          if (shouldUpdateAttachment && attachmentAvailable) {
            await syncProjectAttachments(docRow.id, templateAttachments, actorId)
          }

          const updatedDocRow = {
            ...docRow,
            ...(shouldMoveToActivity ? { activity_id: activityId } : {}),
            ...(shouldUpdateOutgoing ? {
              is_outgoing: isOutgoing,
              is_mandatory: isOutgoing ? false : tDoc.is_mandatory,
              requirement_type: isOutgoing ? 'optional' : tDoc.requirement_type,
            } : {}),
            ...(shouldUpdateAttachment && attachmentAvailable ? {
              attachment_path: attachmentPath,
              attachment_original_name: originalName,
              attachment_missing_at: null,
              attachment_missing_checked_at: checkedAt,
            } : {}),
          }

          docBySource.set(tDoc.id, {
            ...updatedDocRow,
          })
          totals.document_requests += 1
        }

        const docsToInsert = (tActivity.document_requirements ?? []).filter((doc: any) => !docBySource.has(doc.id))
        const docResult = await insertDocs(projectId, activityId, docsToInsert, actorId, rollback, deletedDocBySource)
        totals.document_requests += docResult.applied
        totals.skipped += docResult.skipped
        warnings.push(...docResult.warnings)
        docsToInsert.forEach((doc: any) => docBySource.set(doc.id, { source_template_document_requirement_id: doc.id }))
      }
    }

    return {
      project_id: projectId,
      status: totals.phases || totals.activities || totals.document_requests ? 'applied' : 'skipped',
      totals,
      warnings,
    }
  } catch (error) {
    await rollbackCreated(rollback)
    throw error
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { templateId } = await params
    const body = await req.json().catch(() => ({}))
    const projectIds: string[] = Array.isArray(body?.project_ids)
      ? Array.from(new Set<string>(body.project_ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)))
      : []

    if (projectIds.length === 0) {
      return NextResponse.json({ error: 'project_ids este obligatoriu' }, { status: 400 })
    }

    const { data: template, error: templateError } = await supabaseAdmin
      .from('project_templates')
      .select('id, name, status')
      .eq('id', templateId)
      .maybeSingle()

    if (templateError) throw templateError
    if (!template) {
      return NextResponse.json({ error: 'Template negăsit' }, { status: 404 })
    }
    if (template.status !== 'published') {
      return NextResponse.json({ error: 'Propagarea este permisă doar pentru template-uri publicate' }, { status: 400 })
    }

    const { data: projects, error: projectsError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('template_id', templateId)
      .in('id', projectIds)

    if (projectsError) throw projectsError

    const allowedProjectIds = new Set((projects ?? []).map((project: any) => project.id))
    const rejectedIds = projectIds.filter(id => !allowedProjectIds.has(id))
    if (rejectedIds.length > 0) {
      return NextResponse.json({ error: 'Unele proiecte nu folosesc acest template', rejected_project_ids: rejectedIds }, { status: 400 })
    }

    const templatePhases = await loadTemplate(templateId)
    const results = []

    for (const projectId of projectIds) {
      try {
        results.push(await applyToProject(projectId, templatePhases, auth.profile.id))
      } catch (error: any) {
        console.error('propagation apply project error:', { projectId, error })
        results.push({ project_id: projectId, status: 'failed', error: error.message ?? 'Server error' })
      }
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: auth.profile.id,
      action_type: 'propagate',
      entity_type: 'template',
      entity_id: templateId,
      entity_name: template.name,
      new_values: {
        project_ids: projectIds,
        results,
      },
      description: `Propagare sablon "${template.name}" catre ${projectIds.length} proiect(e)`,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
    })

    return NextResponse.json({ ok: true, results })
  } catch (error: any) {
    console.error('POST propagation apply error:', error)
    return NextResponse.json({ error: error.message ?? 'Server error' }, { status: 500 })
  }
}
