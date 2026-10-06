/* eslint-disable @typescript-eslint/no-explicit-any */
// Duplicarea fazelor și activităților în interiorul unui proiect (#15).
//
// Copia preia structura — activitățile, cererile de documente și fișierele-model
// atașate lor — dar nimic din istoricul de lucru: fișierele încărcate de client
// rămân doar la original. Copia intră „în pregătire” (#8), deci nu produce
// niciun efect vizibil pentru client până când cineva o publică deliberat.
//
// Termenele și responsabilii se copiază: fără ele, regula #70 ar bloca
// publicarea copiei până la completarea manuală a fiecărui element — exact
// munca pe care duplicarea trebuie s-o elimine. Copierea nu trimite emailuri de
// atribuire, fiindcă nimeni nu vede încă o ciornă.
//
// Nu există tranzacție peste toate inserturile, deci un eșec la jumătate e
// întors explicit: `CopyLedger` ține minte ce s-a apucat să se creeze, iar
// `rollbackCopy` șterge exact atât. Fără el, ruta întorcea 500 dar în proiect
// rămânea o copie pe jumătate, pe care userul o găsea la următorul refresh.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ATTACHMENT_BUCKET, copyStorageObject, projectAttachmentPath } from './attachment-storage.ts'
import { slugify } from '../../../lib/slug.ts'

export type DuplicationCounts = { activities: number; documentRequests: number }
type DuplicationWarning = { entity_type: 'activity' | 'document_request'; entity_id: string; consultant_id: string }

export type DuplicationAuditPair = {
  copyId: string
  copyName: string
  sourceId: string
  sourceName: string
}

export type DuplicationAuditNode = {
  copyId: string
  copyName: string
  sourceId: string
  sourceName: string
  phaseId: string
  phaseName: string | null
  activityId?: string
  activityName?: string
  assignedTo?: string | null
  assignedBy?: string | null
  assignedAt?: string | null
  sourceActivityId?: string
  sourceActivityName?: string
}

export type DuplicationAudit = {
  phase?: DuplicationAuditPair
  activities: DuplicationAuditNode[]
  documentRequests: DuplicationAuditNode[]
}

/** Ce a creat duplicarea până acum — materialul de lucru al compensării. */
type CopyAssignment = { id: string; consultant_id: string }
type CopyLedger = {
  phaseId: string | null
  activityIds: string[]
  documentIds: string[]
  storagePaths: string[]
  activityAssignments: CopyAssignment[]
  documentAssignments: CopyAssignment[]
  activityCopies: any[]
  documentCopies: any[]
  auditNodes: DuplicationAuditNode[]
}

const newLedger = (): CopyLedger => ({
  phaseId: null,
  activityIds: [],
  documentIds: [],
  storagePaths: [],
  activityAssignments: [],
  documentAssignments: [],
  activityCopies: [],
  documentCopies: [],
  auditNodes: [],
})

/**
 * Ca `Promise.all`, dar așteaptă toate firele înainte să arunce: compensarea
 * are nevoie de lista completă a ce s-a creat, inclusiv de rândurile scrise de
 * firele care încă erau în zbor când a picat primul.
 */
async function allSettledOrThrow<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks)
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) throw failed.reason
  return (results as PromiseFulfilledResult<T>[]).map(result => result.value)
}

/**
 * Face loc copiei imediat după original printr-un singur UPDATE în PostgreSQL.
 * Funcția RPC validează apartenența sursei și a copiei și exclude copia.
 */
async function shiftOrderAfter(
  admin: SupabaseClient,
  table: 'project_phases' | 'project_activities',
  scopeValue: string,
  sourceId: string,
  exceptId: string,
) {
  const { error } = table === 'project_phases'
    ? await admin.rpc('shift_project_phases_after_duplicate', {
        p_project_id: scopeValue,
        p_source_phase_id: sourceId,
        p_copy_phase_id: exceptId,
      })
    : await admin.rpc('shift_project_activities_after_duplicate', {
        p_phase_id: scopeValue,
        p_source_activity_id: sourceId,
        p_copy_activity_id: exceptId,
      })
  if (error) throw error
}

/**
 * Șterge ce a apucat duplicarea să creeze, în ordinea inversă a dependențelor.
 * Își înghite propriile erori: peste eșecul original n-are ce adăuga un al
 * doilea, iar ce nu s-a putut curăța rămâne în log.
 */
async function rollbackCopy(admin: SupabaseClient, ledger: CopyLedger) {
  const errors: Array<{ step: string; error: unknown }> = []
  const run = async (step: string, operation: () => PromiseLike<any>) => {
    try {
      const result = await operation()
      if (result?.error) errors.push({ step, error: result.error })
      return result
    } catch (error) {
      errors.push({ step, error })
      return null
    }
  }

  let activityIds = [...ledger.activityIds]
  if (ledger.phaseId) {
    const result = await run('load copied activities', () =>
      admin.from('project_activities').select('id').eq('phase_id', ledger.phaseId!))
    if (result && !result.error) {
      activityIds = [...new Set([...activityIds, ...(result.data ?? []).map((row: any) => row.id)])]
    }
  }

  let documentIds = [...ledger.documentIds]
  if (activityIds.length > 0) {
    const result = await run('load copied document requests', () =>
      admin.from('document_requirements').select('id').in('activity_id', activityIds))
    if (result && !result.error) {
      documentIds = [...new Set([...documentIds, ...(result.data ?? []).map((row: any) => row.id)])]
    }
  }

  if (documentIds.length > 0) {
    await run('delete copied document attachments', () =>
      admin.from('document_requirement_attachments').delete().in('document_requirement_id', documentIds))
    await run('delete copied document requests', () =>
      admin.from('document_requirements').delete().in('id', documentIds))
  }
  if (activityIds.length > 0) {
    await run('delete copied activities', () =>
      admin.from('project_activities').delete().in('id', activityIds))
  }
  if (ledger.phaseId) {
    await run('delete copied phase', () =>
      admin.from('project_phases').delete().eq('id', ledger.phaseId!))
  }
  if (ledger.storagePaths.length > 0) {
    await run('remove copied storage objects', () =>
      admin.storage.from(ATTACHMENT_BUCKET).remove(ledger.storagePaths))
  }
  return errors
}

async function applyDuplicateAssignments(
  admin: SupabaseClient,
  projectId: string,
  actorId: string,
  ledger: CopyLedger,
): Promise<DuplicationWarning[]> {
  const { data, error } = await admin.rpc('apply_duplicate_assignments', {
    p_project_id: projectId,
    p_actor_id: actorId,
    p_activity_assignments: ledger.activityAssignments,
    p_document_assignments: ledger.documentAssignments,
  })
  if (error) throw error
  if (!data || !Array.isArray(data.activities) || !Array.isArray(data.documents) || !Array.isArray(data.omitted)) {
    throw new Error('Contract invalid pentru atribuirea elementelor duplicate.')
  }

  const requested = {
    activity: new Map(ledger.activityAssignments.map(item => [item.id, item.consultant_id])),
    document_request: new Map(ledger.documentAssignments.map(item => [item.id, item.consultant_id])),
  }
  const assigned = {
    activity: new Map<string, any>(),
    document_request: new Map<string, any>(),
  }
  for (const row of data.activities) {
    if (!row || typeof row.id !== 'string' || requested.activity.get(row.id) !== row.assigned_to
      || typeof row.assigned_by !== 'string' || typeof row.updated_at !== 'string'
      || assigned.activity.has(row.id)) {
      throw new Error('Contract invalid pentru atribuirea activităților duplicate.')
    }
    assigned.activity.set(row.id, row)
  }
  for (const row of data.documents) {
    if (!row || typeof row.id !== 'string' || requested.document_request.get(row.id) !== row.assigned_to
      || typeof row.assigned_by !== 'string' || typeof row.assigned_at !== 'string'
      || assigned.document_request.has(row.id)) {
      throw new Error('Contract invalid pentru atribuirea cererilor duplicate.')
    }
    assigned.document_request.set(row.id, row)
  }

  const omitted = new Map<string, DuplicationWarning>()
  for (const row of data.omitted) {
    if (!row || (row.entity_type !== 'activity' && row.entity_type !== 'document_request')
      || typeof row.entity_id !== 'string'
      || requested[row.entity_type as DuplicationWarning['entity_type']].get(row.entity_id) !== row.consultant_id) {
      throw new Error('Contract invalid pentru atribuirea omisă a elementelor duplicate.')
    }
    const key = row.entity_type + ':' + row.entity_id
    if (omitted.has(key)) throw new Error('Contract duplicat pentru atribuirea omisă.')
    omitted.set(key, {
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      consultant_id: row.consultant_id,
    })
  }

  for (const [type, requestedRows] of Object.entries(requested) as Array<[keyof typeof requested, Map<string, string>]>) {
    const assignedRows = assigned[type]
    for (const [id] of requestedRows) {
      if (assignedRows.has(id) === omitted.has(type + ':' + id)) {
        throw new Error('Contract incomplet pentru atribuirea elementelor duplicate.')
      }
    }
    if (assignedRows.size + [...omitted.keys()].filter(key => key.startsWith(type + ':')).length !== requestedRows.size) {
      throw new Error('Contract incomplet pentru atribuirea elementelor duplicate.')
    }
  }

  for (const copy of ledger.activityCopies) {
    const row = assigned.activity.get(copy.id)
    if (row) Object.assign(copy, { assigned_to: row.assigned_to, assigned_by: row.assigned_by, updated_at: row.updated_at })
  }
  for (const copy of ledger.documentCopies) {
    const row = assigned.document_request.get(copy.id)
    if (row) Object.assign(copy, { assigned_to: row.assigned_to, assigned_by: row.assigned_by, assigned_at: row.assigned_at })
  }
  for (const item of ledger.auditNodes) {
    const row = assigned.activity.get(item.copyId) ?? assigned.document_request.get(item.copyId)
    if (row) {
      item.assignedTo = row.assigned_to
      item.assignedBy = row.assigned_by
      if (typeof row.assigned_at === 'string') item.assignedAt = row.assigned_at
    }
  }
  return [...omitted.values()]
}

/**
 * Fișierele-model ale unei cereri, în ordine, indiferent dacă sunt ținute în
 * tabela de atașamente sau în perechea veche `attachment_path` de pe cerere.
 */
function modelAttachments(request: any): any[] {
  const rows = [...(request.attachments ?? [])]
    .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
  if (rows.length > 0) return rows
  if (!request.attachment_path) return []
  return [{
    storage_path: request.attachment_path,
    original_name: request.attachment_original_name,
    missing_at: request.attachment_missing_at,
    missing_checked_at: request.attachment_missing_checked_at,
  }]
}

/**
 * Copiază cererile de documente ale unei activități, împreună cu fișierele-model.
 * Cererile șterse (soft delete) și fișierele urcate de client nu se copiază.
 */
async function duplicateDocumentRequests(
  admin: SupabaseClient,
  options: {
    projectId: string
    sourceActivityId: string
    targetActivityId: string
    targetPhaseId: string
    phaseName?: string | null
    activityName: string
    sourceActivityName: string
    actorId: string
    ledger: CopyLedger
  },
): Promise<DuplicationAuditNode[]> {
  const { data: requests, error } = await admin
    .from('document_requirements')
    .select('*, attachments:document_requirement_attachments(*)')
    .eq('activity_id', options.sourceActivityId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true })

  if (error) throw error
  if (!requests || requests.length === 0) return []

  const now = new Date().toISOString()

  const prepared = await allSettledOrThrow(requests.map(async (request: any) => {
    // Fiecare fișier-model primește obiect propriu în storage.
    const attachments = await allSettledOrThrow(modelAttachments(request).map(async (attachment: any) => {
      const copy = await copyStorageObject(
        admin,
        attachment.storage_path,
        projectAttachmentPath(options.projectId, attachment.original_name),
      )
      if (copy.path) {
        options.ledger.storagePaths.push(copy.path)
        return { ...attachment, storage_path: copy.path }
      }
      if (copy.reason === 'failed') {
        // Copia n-are voie să rămână pe obiectul originalului: ștergerea
        // modelului de pe unul l-ar rupe pe celălalt.
        throw new Error(`Nu am putut copia fișierul-model „${attachment.original_name ?? attachment.storage_path}”.`)
      }
      // Sursa chiar nu mai există: copia păstrează calea veche, dar marcată ca
      // lipsă, ca golul să se vadă în loc să pară un fișier valid.
      return { ...attachment, missing_at: attachment.missing_at ?? now, missing_checked_at: now }
    }))
    return { request, attachments }
  }))

  const rows = prepared.map(({ request, attachments }) => {
    const first = attachments[0] ?? null
    return {
      id: crypto.randomUUID(),
      project_id: options.projectId,
      activity_id: options.targetActivityId,
      name: request.name,
      description: request.description,
      is_mandatory: request.is_mandatory,
      requirement_type: request.requirement_type,
      is_outgoing: request.is_outgoing,
      order_index: request.order_index,
      attachment_path: first?.storage_path ?? null,
      attachment_original_name: first?.original_name ?? null,
      attachment_missing_at: first?.missing_at ?? null,
      attachment_missing_checked_at: first?.missing_checked_at ?? null,
      assigned_to: null,
      assigned_by: null,
      assigned_at: null,
      deadline_at: request.deadline_at ?? null,
      status: 'pending',
      visibility: 'draft',
      is_locked: false,
      created_by: options.actorId,
      // Copia e un element propriu al proiectului, nu o oglindă a șablonului:
      // fără legătură la sursă, propagarea din șablon o ignoră.
      source_template_document_requirement_id: null,
    }
  })

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const request = prepared[index].request
    options.ledger.documentIds.push(row.id)
    options.ledger.documentCopies.push(row)
    if (typeof request.assigned_to === 'string' && request.assigned_to) {
      options.ledger.documentAssignments.push({ id: row.id, consultant_id: request.assigned_to })
    }
  }

  // UUID-urile sunt pregătite în payload, deci maparea nu depinde de ordinea
  // unui eventual RETURNING bulk.
  const { error: insertError } = await admin
    .from('document_requirements')
    .insert(rows)

  if (insertError) throw insertError

  const attachmentRows = prepared.flatMap(({ attachments }, index) =>
    attachments.map((attachment: any, order: number) => ({
      document_requirement_id: rows[index].id,
      // Legătura la șablon stă pe cerere, iar acolo e deja `null`; păstrată pe
      // atașament ar contrazice intenția, chiar dacă propagarea n-o citește.
      source_template_attachment_id: null,
      storage_path: attachment.storage_path,
      original_name: attachment.original_name,
      mime_type: attachment.mime_type,
      file_size: attachment.file_size,
      order_index: order,
      missing_at: attachment.missing_at,
      missing_checked_at: attachment.missing_checked_at,
      created_by: options.actorId,
    })))

  if (attachmentRows.length > 0) {
    const { error: attachmentError } = await admin
      .from('document_requirement_attachments')
      .insert(attachmentRows)
    if (attachmentError) throw attachmentError
  }

  const auditNodes = rows.map((copy, index) => ({
    copyId: copy.id,
    copyName: copy.name,
    assignedTo: null,
    assignedBy: null,
    assignedAt: null,
    sourceId: prepared[index].request.id,
    sourceName: prepared[index].request.name,
    phaseId: options.targetPhaseId,
    phaseName: options.phaseName ?? null,
    activityId: options.targetActivityId,
    activityName: options.activityName,
    sourceActivityId: options.sourceActivityId,
    sourceActivityName: options.sourceActivityName,
  }))
  options.ledger.auditNodes.push(...auditNodes)
  return auditNodes
}

/**
 * Copiază o activitate (cu cererile ei) într-o fază dată, pe poziția cerută.
 * Nu mută frații — apelantul decide unde aterizează copia.
 */
async function duplicateActivity(
  admin: SupabaseClient,
  options: {
    projectId: string
    targetPhaseId: string
    sourceActivity: any
    name: string
    orderIndex: number
    actorId: string
    phaseName?: string | null
    ledger: CopyLedger
  },
): Promise<{ activity: any; documentRequests: DuplicationAuditNode[]; audit: DuplicationAudit }> {
  const source = options.sourceActivity

  const { data: activity, error } = await admin
    .from('project_activities')
    .insert({
      phase_id: options.targetPhaseId,
      name: options.name,
      description: source.description,
      order_index: options.orderIndex,
      status: 'pending',
      visibility: 'draft',
      assigned_to: null,
      assigned_by: null,
      deadline_at: source.deadline_at ?? null,
      notes: null,
      source_template_activity_id: null,
    })
    .select()
    .single()

  if (error) throw error
  options.ledger.activityIds.push(activity.id)
  options.ledger.activityCopies.push(activity)
  if (typeof source.assigned_to === 'string' && source.assigned_to) {
    options.ledger.activityAssignments.push({ id: activity.id, consultant_id: source.assigned_to })
  }

  const documentRequests = await duplicateDocumentRequests(admin, {
    projectId: options.projectId,
    sourceActivityId: source.id,
    targetActivityId: activity.id,
    targetPhaseId: options.targetPhaseId,
    phaseName: options.phaseName,
    activityName: activity.name,
    sourceActivityName: source.name,
    actorId: options.actorId,
    ledger: options.ledger,
  })

  const activityAudit: DuplicationAuditNode = {
    copyId: activity.id,
    copyName: activity.name,
    sourceId: source.id,
    sourceName: source.name,
    phaseId: options.targetPhaseId,
    phaseName: options.phaseName ?? null,
    assignedTo: null,
    assignedBy: null,
  }
  options.ledger.auditNodes.push(activityAudit)

  return {
    activity,
    documentRequests,
    audit: { activities: [activityAudit], documentRequests },
  }
}

/**
 * Copiază o fază întreagă imediat după original: activitățile își păstrează
 * numele și ordinea, doar faza primește numele de copie.
 */
export async function duplicatePhase(
  admin: SupabaseClient,
  options: {
    projectId: string
    sourcePhase: any
    name: string
    actorId: string
  },
): Promise<{ phase: any; counts: DuplicationCounts; audit: DuplicationAudit; warnings: DuplicationWarning[] }> {
  const source = options.sourcePhase
  const sourceOrderIndex = source.order_index ?? 0
  const ledger = newLedger()

  try {
    const phaseId = crypto.randomUUID()
    const { data: phase, error } = await admin
      .from('project_phases')
      .insert({
        id: phaseId,
        project_id: options.projectId,
        project_status_id: source.project_status_id,
        name: options.name,
        slug: `${slugify(options.name)}-${phaseId}`,
        description: source.description,
        order_index: sourceOrderIndex + 1,
        status: 'pending',
        visibility: 'draft',
        source_template_phase_id: null,
      })
      .select()
      .single()

    if (error) throw error
    ledger.phaseId = phase.id

    const { data: activities, error: activitiesError } = await admin
      .from('project_activities')
      .select('*')
      .eq('phase_id', source.id)
      .order('order_index', { ascending: true })

    if (activitiesError) throw activitiesError

    // Ordinea inserării nu contează: fiecare copie primește `order_index`
    // explicit, deci activitățile pot pleca odată.
    const created = await allSettledOrThrow((activities ?? []).map((sourceActivity: any, index: number) =>
      duplicateActivity(admin, {
        projectId: options.projectId,
        targetPhaseId: phase.id,
        sourceActivity,
        name: sourceActivity.name,
        orderIndex: sourceActivity.order_index ?? index + 1,
        actorId: options.actorId,
        phaseName: phase.name,
        ledger,
      })))

    const warnings = await applyDuplicateAssignments(admin, options.projectId, options.actorId, ledger)

    // Frații se mută abia acum, după ce copia e completă: până aici un eșec nu
    // atinge ordinea existentă, deci compensarea n-are ce reface acolo.
    await shiftOrderAfter(admin, 'project_phases', options.projectId, source.id, phase.id)

    return {
      phase,
      counts: {
        activities: created.length,
        documentRequests: created.reduce((sum, item) => sum + item.documentRequests.length, 0),
      },
      warnings,
      audit: {
        phase: {
          copyId: phase.id,
          copyName: phase.name,
          sourceId: source.id,
          sourceName: source.name,
        },
        activities: created.flatMap(item => item.audit.activities),
        documentRequests: created.flatMap(item => item.audit.documentRequests),
      },
    }
  } catch (error) {
    const cleanupErrors = await rollbackCopy(admin, ledger)
    if (cleanupErrors.length > 0) {
      console.error('duplicatePhase cleanup failed:', cleanupErrors)
      throw new Error('Duplicarea a eșuat și copia nu a putut fi curățată complet.')
    }
    throw error
  }
}

/** Copiază o activitate imediat după originalul ei, mutând frații după copie. */
export async function duplicateActivityAfterSource(
  admin: SupabaseClient,
  options: {
    projectId: string
    phaseId: string
    sourceActivity: any
    name: string
    actorId: string
    phaseName?: string | null
  },
): Promise<{ activity: any; documentRequests: DuplicationAuditNode[]; audit: DuplicationAudit; warnings: DuplicationWarning[] }> {
  const sourceOrderIndex = options.sourceActivity.order_index ?? 0
  const ledger = newLedger()

  try {
    const created = await duplicateActivity(admin, {
      projectId: options.projectId,
      targetPhaseId: options.phaseId,
      sourceActivity: options.sourceActivity,
      name: options.name,
      orderIndex: sourceOrderIndex + 1,
      actorId: options.actorId,
      phaseName: options.phaseName,
      ledger,
    })

    const warnings = await applyDuplicateAssignments(admin, options.projectId, options.actorId, ledger)
    await shiftOrderAfter(
      admin, 'project_activities', options.phaseId, options.sourceActivity.id, created.activity.id,
    )

    return { ...created, warnings }
  } catch (error) {
    const cleanupErrors = await rollbackCopy(admin, ledger)
    if (cleanupErrors.length > 0) {
      console.error('duplicateActivityAfterSource cleanup failed:', cleanupErrors)
      throw new Error('Duplicarea a eșuat și copia nu a putut fi curățată complet.')
    }
    throw error
  }
}
