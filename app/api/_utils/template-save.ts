/* eslint-disable @typescript-eslint/no-explicit-any */
// Salvarea întregului arbore de șablon dintr-o singură cerere. Planul vine din
// `lib/template-save-plan.ts`; aici se execută: câte un insert per nivel,
// actualizările în paralel, scoaterile într-un update per nivel și auditul
// într-un singur insert. Numărul de cereri către DB nu mai crește cu numărul
// de elemente, doar cu numărul de elemente modificate (și acelea în paralel).

import type { SupabaseClient } from '@supabase/supabase-js'
import { mapWithConcurrency } from '@/lib/template-tree'
import { planTemplateSave, type SaveAttachmentInput, type SavePlan, type SaveTreeInput } from '@/lib/template-save-plan'
import { computeDiff, logActions, type LogActionParams } from './audit'
import { ATTACHMENT_BUCKET, copyTemplateAttachments, findReferencedPaths } from './attachment-storage'
import { loadTemplateTree } from './template-tree'

const UPDATE_CONCURRENCY = 8

export class TemplateSaveError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function orThrow<T extends { error: any }>(result: T) {
  if (result.error) throw result.error
  return result
}

// Rândul, fără copiii și relațiile încărcate odată cu arborele.
function plainRow(row: any) {
  const rest = { ...row }
  delete rest.phases
  delete rest.activities
  delete rest.document_requirements
  delete rest.attachments
  delete rest.project_status
  delete rest.default_consultant
  delete rest.measure
  return rest
}

function attachmentRows(documentId: string, attachments: SaveAttachmentInput[], actorId: string) {
  return attachments.map((attachment, index) => ({
    template_document_requirement_id: documentId,
    storage_path: attachment.storage_path,
    original_name: attachment.original_name ?? null,
    mime_type: attachment.mime_type ?? null,
    file_size: attachment.file_size ?? null,
    order_index: index,
    missing_at: attachment.missing_at || null,
    missing_checked_at: attachment.missing_checked_at || null,
    created_by: actorId,
  }))
}

export async function saveTemplateTree(
  supabase: SupabaseClient,
  templateId: string,
  input: SaveTreeInput,
  options: { actorId: string; request: Request; templateSelect?: string },
) {
  const { actorId, request } = options
  const [current, slugRows] = await Promise.all([
    loadTemplateTree(supabase, templateId),
    supabase.from('template_phases').select('slug').eq('template_id', templateId).then(orThrow),
  ])
  if (!current) throw new TemplateSaveError('Template negăsit', 404)

  const planned = planTemplateSave(
    current,
    input,
    (slugRows.data ?? []).map((row: any) => row.slug),
    () => crypto.randomUUID(),
  )
  if (!planned.ok) throw new TemplateSaveError(planned.error)
  const plan = planned.plan
  const templateName = plan.templateUpdate?.name ?? current.name

  const defaultConsultantIds = [...new Set([
    ...plan.activityInserts.map(item => item.row.default_consultant_id),
    ...plan.activityUpdates.map(item => item.update.default_consultant_id),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (defaultConsultantIds.length > 0) {
    const { data: consultants, error } = await supabase
      .from('profiles')
      .select('id, role, is_active')
      .in('id', defaultConsultantIds)
    if (error) throw error
    const consultantById = new Map((consultants ?? []).map((profile: any) => [profile.id, profile]))
    for (const id of defaultConsultantIds) {
      const consultant = consultantById.get(id) as any
      if (!consultant || consultant.role !== 'consultant') {
        throw new TemplateSaveError('Implicitele de atribuire trebuie să fie consultanți existenți.')
      }
      if (consultant.is_active === false) {
        throw new TemplateSaveError('Implicitele de atribuire trebuie să fie consultanți activi.', 409)
      }
    }
  }

  // Documentele noi duplicate dintr-unul existent primesc propriile obiecte în
  // storage, ca ștergerea modelului de pe unul să nu-l rupă pe celălalt.
  const createdPaths: string[] = []
  const reusedPaths = [...new Set(plan.docInserts.flatMap(doc =>
    doc.attachments.filter(item => item.id).map(item => item.storage_path)))]
  const referenced = await findReferencedPaths(supabase, reusedPaths)
  const insertedIds = { phases: [] as string[], activities: [] as string[], docs: [] as string[] }

  try {
    await mapWithConcurrency(plan.docInserts, 4, async doc => {
      if (!doc.attachments.some(item => item.id && referenced.has(item.storage_path))) return
      const copied = await copyTemplateAttachments(supabase, doc.attachments, null, null, referenced, createdPaths)
      doc.attachments = copied.attachments
    })
    for (const doc of plan.docInserts) {
      const first = doc.attachments[0]
      Object.assign(doc.row, {
        attachment_path: first?.storage_path ?? null,
        attachment_original_name: first ? first.original_name ?? null : null,
        attachment_missing_at: first?.missing_at || null,
        attachment_missing_checked_at: first?.missing_checked_at || null,
      })
    }

    // Un insert per nivel; id-urile sunt fixate în plan, deci copiii își știu
    // părintele fără să aștepte răspunsul.
    if (plan.phaseInserts.length > 0) {
      orThrow(await supabase.from('template_phases').insert(plan.phaseInserts.map(item => item.row)))
      insertedIds.phases = plan.phaseInserts.map(item => item.row.id)
    }
    if (plan.activityInserts.length > 0) {
      orThrow(await supabase.from('template_activities').insert(plan.activityInserts.map(item => item.row)))
      insertedIds.activities = plan.activityInserts.map(item => item.row.id)
    }
    if (plan.docInserts.length > 0) {
      orThrow(await supabase.from('template_document_requirements').insert(plan.docInserts.map(item => item.row)))
      insertedIds.docs = plan.docInserts.map(item => item.row.id)
      const rows = plan.docInserts.flatMap(doc => attachmentRows(doc.row.id, doc.attachments, actorId))
      if (rows.length > 0) orThrow(await supabase.from('document_requirement_attachments').insert(rows))
    }
  } catch (error) {
    // Rândurile noi se șterg de tot (cascada ia și copiii și atașamentele);
    // nimic existent n-a fost atins încă.
    await Promise.allSettled([
      insertedIds.docs.length && supabase.from('template_document_requirements').delete().in('id', insertedIds.docs),
      insertedIds.activities.length && supabase.from('template_activities').delete().in('id', insertedIds.activities),
      insertedIds.phases.length && supabase.from('template_phases').delete().in('id', insertedIds.phases),
      createdPaths.length && supabase.storage.from(ATTACHMENT_BUCKET).remove(createdPaths),
    ])
    throw error
  }

  const updates = [
    ...(plan.templateUpdate ? [{ table: 'project_templates', id: templateId, update: plan.templateUpdate }] : []),
    ...plan.phaseUpdates.map(item => ({ table: 'template_phases', id: item.id, update: item.update })),
    ...plan.activityUpdates.map(item => ({ table: 'template_activities', id: item.id, update: item.update })),
    ...plan.docUpdates.map(item => ({ table: 'template_document_requirements', id: item.id, update: item.update })),
  ]
  await mapWithConcurrency(updates, UPDATE_CONCURRENCY, async ({ table, id, update }) => {
    orThrow(await supabase.from(table).update(update).eq('id', id))
  })

  const replacedAttachments = plan.docUpdates.filter(item => item.attachments !== undefined)
  if (replacedAttachments.length > 0) {
    orThrow(await supabase
      .from('document_requirement_attachments')
      .delete()
      .in('template_document_requirement_id', replacedAttachments.map(item => item.id)))
    const rows = replacedAttachments.flatMap(item => attachmentRows(item.id, item.attachments!, actorId))
    if (rows.length > 0) orThrow(await supabase.from('document_requirement_attachments').insert(rows))
  }

  const removals: Array<[string, string[]]> = [
    ['template_phases', plan.phaseRemovals.map(item => item.before.id)],
    ['template_activities', plan.activityRemovals.map(item => item.before.id)],
    ['template_document_requirements', plan.docRemovals.map(item => item.before.id)],
  ]
  await Promise.all(removals
    .filter(([, ids]) => ids.length > 0)
    .map(async ([table, ids]) => orThrow(await supabase.from(table).update({ is_active: false }).in('id', ids))))

  await logActions(auditEntries(plan, current, templateName, actorId, request))

  return loadTemplateTree(supabase, templateId, options.templateSelect)
}

function auditEntries(
  plan: SavePlan,
  current: any,
  templateName: string,
  actorId: string,
  request: Request,
): LogActionParams[] {
  const entries: LogActionParams[] = []
  const add = (entry: Omit<LogActionParams, 'actorId' | 'request'>) => entries.push({ ...entry, actorId, request })
  const withDuplication = (duplication: unknown) => (duplication ? { duplication } : {})

  if (plan.templateUpdate) {
    const diff = computeDiff(current, plan.templateUpdate)
    if (!diff.isEmpty) {
      add({
        actionType: 'update',
        entityType: 'template',
        entityId: current.id,
        entityName: templateName,
        oldValues: diff.oldValues,
        newValues: diff.newValues,
        description: `Modificare sablon "${templateName}" (${diff.changedKeys.join(', ')})`,
      })
    }
  }

  for (const { row, duplication } of plan.phaseInserts) {
    add({
      actionType: duplication ? 'create' : 'add',
      entityType: 'template_phase',
      entityId: row.id,
      entityName: row.name,
      newValues: { ...row, template_name: templateName, ...withDuplication(duplication) },
      description: `${duplication ? 'Duplicare' : 'Adaugare'} faza "${row.name}" in sablonul "${templateName}"`,
    })
  }
  for (const { row, duplication, phaseName } of plan.activityInserts) {
    add({
      actionType: duplication ? 'create' : 'add',
      entityType: 'template_activity',
      entityId: row.id,
      entityName: row.name,
      newValues: { ...row, template_name: templateName, phase_name: phaseName, ...withDuplication(duplication) },
      description: `${duplication ? 'Duplicare' : 'Adaugare'} activitate "${row.name}" in faza "${phaseName}" (sablonul "${templateName}")`,
    })
  }
  for (const { row, duplication, phaseName, activityName } of plan.docInserts) {
    add({
      actionType: duplication ? 'create' : 'add',
      entityType: 'template_document',
      entityId: row.id,
      entityName: row.name,
      newValues: {
        ...row,
        template_name: templateName,
        phase_name: phaseName,
        activity_name: activityName,
        ...withDuplication(duplication),
      },
      description: `${duplication ? 'Duplicare' : 'Adaugare'} cerinta document "${row.name}" in activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}")`,
    })
  }

  for (const { id, before, update } of plan.phaseUpdates) {
    const diff = computeDiff(before, update)
    const name = update.name ?? before.name
    add({
      actionType: 'update',
      entityType: 'template_phase',
      entityId: id,
      entityName: name,
      oldValues: { ...diff.oldValues, template_name: templateName },
      newValues: { ...diff.newValues, template_name: templateName },
      description: `Modificare faza "${name}" in sablonul "${templateName}" (${diff.changedKeys.join(', ')})`,
    })
  }
  for (const { id, before, update, phaseName } of plan.activityUpdates) {
    const diff = computeDiff(before, update)
    const name = update.name ?? before.name
    const names = { template_name: templateName, phase_name: phaseName }
    add({
      actionType: 'update',
      entityType: 'template_activity',
      entityId: id,
      entityName: name,
      oldValues: { ...diff.oldValues, ...names },
      newValues: { ...diff.newValues, ...names },
      description: `Modificare activitate "${name}" in faza "${phaseName}" (sablonul "${templateName}") (${diff.changedKeys.join(', ')})`,
    })
  }
  for (const { id, before, update, phaseName, activityName } of plan.docUpdates) {
    const diff = computeDiff(plainRow(before), update)
    const name = update.name ?? before.name
    const names = { template_name: templateName, phase_name: phaseName, activity_name: activityName }
    add({
      actionType: 'update',
      entityType: 'template_document',
      entityId: id,
      entityName: name,
      oldValues: { ...diff.oldValues, ...names },
      newValues: { ...diff.newValues, ...names },
      description: `Modificare cerinta document "${name}" in activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}") (${diff.changedKeys.join(', ')})`,
    })
  }

  for (const { before } of plan.phaseRemovals) {
    add({
      actionType: 'delete',
      entityType: 'template_phase',
      entityId: before.id,
      entityName: before.name,
      oldValues: { ...plainRow(before), template_name: templateName },
      description: `Eliminare faza "${before.name}" din sablonul "${templateName}"`,
    })
  }
  for (const { before, parentName } of plan.activityRemovals) {
    add({
      actionType: 'delete',
      entityType: 'template_activity',
      entityId: before.id,
      entityName: before.name,
      oldValues: { ...plainRow(before), template_name: templateName, phase_name: parentName },
      description: `Eliminare activitate "${before.name}" din faza "${parentName}" (sablonul "${templateName}")`,
    })
  }
  for (const { before, parentName, grandparentName } of plan.docRemovals) {
    add({
      actionType: 'delete',
      entityType: 'template_document',
      entityId: before.id,
      entityName: before.name,
      oldValues: {
        ...plainRow(before),
        template_name: templateName,
        phase_name: grandparentName,
        activity_name: parentName,
      },
      description: `Eliminare cerinta document "${before.name}" din activitatea "${parentName}" (faza "${grandparentName}", sablonul "${templateName}")`,
    })
  }

  return entries
}
