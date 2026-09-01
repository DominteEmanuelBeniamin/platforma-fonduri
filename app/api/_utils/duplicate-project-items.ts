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

import type { SupabaseClient } from '@supabase/supabase-js'
import { copyStorageObject, projectAttachmentPath } from './attachment-storage'

export type DuplicationCounts = { activities: number; documentRequests: number }

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Face loc copiei imediat după original: tot ce vine după `orderIndex` urcă cu
 * o poziție. Actualizarea merge descrescător, ca ordinea să rămână citibilă și
 * în timpul operației.
 */
async function shiftOrderAfter(
  admin: SupabaseClient,
  table: 'project_phases' | 'project_activities',
  scopeColumn: 'project_id' | 'phase_id',
  scopeValue: string,
  orderIndex: number,
) {
  const { data, error } = await admin
    .from(table)
    .select('id, order_index')
    .eq(scopeColumn, scopeValue)
    .gt('order_index', orderIndex)
    .order('order_index', { ascending: false })

  if (error) throw error

  for (const row of data ?? []) {
    const { error: updateError } = await admin
      .from(table)
      .update({ order_index: (row.order_index ?? 0) + 1 })
      .eq('id', row.id)
    if (updateError) throw updateError
  }
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
    source_template_attachment_id: null,
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
    actorId: string
  },
): Promise<number> {
  const { data: requests, error } = await admin
    .from('document_requirements')
    .select('*, attachments:document_requirement_attachments(*)')
    .eq('activity_id', options.sourceActivityId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true })

  if (error) throw error

  const now = new Date().toISOString()
  let created = 0

  for (const request of requests ?? []) {
    // Fiecare fișier-model primește obiect propriu în storage. Dacă sursa nu
    // mai există, copia păstrează calea veche împreună cu marcajul de lipsă.
    const attachments = await Promise.all(modelAttachments(request).map(async (attachment: any) => {
      const copiedPath = await copyStorageObject(
        admin,
        attachment.storage_path,
        projectAttachmentPath(options.projectId, attachment.original_name),
      )
      return { ...attachment, storage_path: copiedPath ?? attachment.storage_path, copied: copiedPath !== null }
    }))
    const firstAttachment = attachments[0] ?? null

    const { data: copy, error: insertError } = await admin
      .from('document_requirements')
      .insert({
        project_id: options.projectId,
        activity_id: options.targetActivityId,
        name: request.name,
        description: request.description,
        is_mandatory: request.is_mandatory,
        requirement_type: request.requirement_type,
        is_outgoing: request.is_outgoing,
        order_index: request.order_index,
        attachment_path: firstAttachment?.storage_path ?? null,
        attachment_original_name: firstAttachment?.original_name ?? null,
        attachment_missing_at: request.attachment_missing_at,
        attachment_missing_checked_at: request.attachment_missing_checked_at,
        assigned_to: request.assigned_to ?? null,
        assigned_by: request.assigned_to ? options.actorId : null,
        assigned_at: request.assigned_to ? now : null,
        deadline_at: request.deadline_at ?? null,
        status: 'pending',
        visibility: 'draft',
        is_locked: false,
        created_by: options.actorId,
        // Copia e un element propriu al proiectului, nu o oglindă a șablonului:
        // fără legătură la sursă, propagarea din șablon o ignoră.
        source_template_document_requirement_id: null,
      })
      .select('id')
      .single()

    if (insertError) throw insertError
    created += 1

    if (copy && attachments.length > 0) {
      const { error: attachmentError } = await admin
        .from('document_requirement_attachments')
        .insert(attachments.map((attachment: any, index: number) => ({
          document_requirement_id: copy.id,
          source_template_attachment_id: attachment.source_template_attachment_id ?? null,
          storage_path: attachment.storage_path,
          original_name: attachment.original_name,
          mime_type: attachment.mime_type,
          file_size: attachment.file_size,
          order_index: index,
          missing_at: attachment.missing_at,
          missing_checked_at: attachment.missing_checked_at,
          created_by: options.actorId,
        })))
      if (attachmentError) throw attachmentError
    }
  }

  return created
}

/**
 * Copiază o activitate (cu cererile ei) într-o fază dată, pe poziția cerută.
 * Nu mută frații — apelantul decide unde aterizează copia.
 */
export async function duplicateActivity(
  admin: SupabaseClient,
  options: {
    projectId: string
    targetPhaseId: string
    sourceActivity: any
    name: string
    orderIndex: number
    actorId: string
  },
): Promise<{ activity: any; documentRequests: number }> {
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
      assigned_to: source.assigned_to ?? null,
      assigned_by: source.assigned_to ? options.actorId : null,
      deadline_at: source.deadline_at ?? null,
      notes: null,
      source_template_activity_id: null,
    })
    .select()
    .single()

  if (error) throw error

  const documentRequests = await duplicateDocumentRequests(admin, {
    projectId: options.projectId,
    sourceActivityId: source.id,
    targetActivityId: activity.id,
    actorId: options.actorId,
  })

  return { activity, documentRequests }
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
): Promise<{ phase: any; counts: DuplicationCounts }> {
  const source = options.sourcePhase
  const sourceOrderIndex = source.order_index ?? 0

  await shiftOrderAfter(admin, 'project_phases', 'project_id', options.projectId, sourceOrderIndex)

  const { data: phase, error } = await admin
    .from('project_phases')
    .insert({
      project_id: options.projectId,
      project_status_id: source.project_status_id,
      name: options.name,
      slug: slugify(options.name),
      description: source.description,
      order_index: sourceOrderIndex + 1,
      status: 'pending',
      visibility: 'draft',
      source_template_phase_id: null,
    })
    .select()
    .single()

  if (error) throw error

  const { data: activities, error: activitiesError } = await admin
    .from('project_activities')
    .select('*')
    .eq('phase_id', source.id)
    .order('order_index', { ascending: true })

  if (activitiesError) throw activitiesError

  const counts: DuplicationCounts = { activities: 0, documentRequests: 0 }

  for (const [index, sourceActivity] of (activities ?? []).entries()) {
    const { documentRequests } = await duplicateActivity(admin, {
      projectId: options.projectId,
      targetPhaseId: phase.id,
      sourceActivity,
      name: sourceActivity.name,
      orderIndex: sourceActivity.order_index ?? index + 1,
      actorId: options.actorId,
    })
    counts.activities += 1
    counts.documentRequests += documentRequests
  }

  return { phase, counts }
}

/** Face loc unei activități copiate imediat după originalul ei. */
export async function shiftActivitiesAfter(
  admin: SupabaseClient,
  phaseId: string,
  orderIndex: number,
) {
  await shiftOrderAfter(admin, 'project_activities', 'phase_id', phaseId, orderIndex)
}
