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
import { ATTACHMENT_BUCKET, copyStorageObject, projectAttachmentPath } from './attachment-storage'
import { slugify } from '@/lib/slug'

export type DuplicationCounts = { activities: number; documentRequests: number }

/** Ce a creat duplicarea până acum — materialul de lucru al compensării. */
type CopyLedger = { phaseId: string | null; activityIds: string[]; storagePaths: string[] }

const newLedger = (): CopyLedger => ({ phaseId: null, activityIds: [], storagePaths: [] })

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
 * Face loc copiei imediat după original: tot ce vine după `orderIndex` urcă cu
 * o poziție. Copia însăși stă deja pe `orderIndex + 1`, deci se exclude din
 * mutare. Update-urile pleacă odată: `order_index` n-are constraint unic, deci
 * ordinea lor nu contează, iar secvențial însemna un round-trip per frate.
 */
async function shiftOrderAfter(
  admin: SupabaseClient,
  table: 'project_phases' | 'project_activities',
  scopeColumn: 'project_id' | 'phase_id',
  scopeValue: string,
  orderIndex: number,
  exceptId: string,
) {
  const { data, error } = await admin
    .from(table)
    .select('id, order_index')
    .eq(scopeColumn, scopeValue)
    .gt('order_index', orderIndex)
    .neq('id', exceptId)

  if (error) throw error

  const results = await Promise.all((data ?? []).map(row =>
    admin.from(table).update({ order_index: (row.order_index ?? 0) + 1 }).eq('id', row.id)))

  const failed = results.find(result => result.error)
  if (failed?.error) throw failed.error
}

/**
 * Șterge ce a apucat duplicarea să creeze, în ordinea inversă a dependențelor.
 * Își înghite propriile erori: peste eșecul original n-are ce adăuga un al
 * doilea, iar ce nu s-a putut curăța rămâne în log.
 */
async function rollbackCopy(admin: SupabaseClient, ledger: CopyLedger) {
  try {
    // Faza copiată e nouă, deci tot ce atârnă de ea e tot copie.
    const activityIds = ledger.phaseId
      ? ((await admin.from('project_activities').select('id').eq('phase_id', ledger.phaseId)).data ?? [])
          .map((activity: any) => activity.id)
      : ledger.activityIds

    if (activityIds.length > 0) {
      const { data: requests } = await admin
        .from('document_requirements').select('id').in('activity_id', activityIds)
      const requestIds = (requests ?? []).map((request: any) => request.id)
      if (requestIds.length > 0) {
        await admin.from('document_requirement_attachments').delete().in('document_requirement_id', requestIds)
        await admin.from('document_requirements').delete().in('id', requestIds)
      }
      await admin.from('project_activities').delete().in('id', activityIds)
    }

    if (ledger.phaseId) await admin.from('project_phases').delete().eq('id', ledger.phaseId)

    // Doar obiectele chiar create de copiere: căile moștenite de la un
    // fișier-model lipsă nu ajung niciodată în registru.
    if (ledger.storagePaths.length > 0) {
      await admin.storage.from(ATTACHMENT_BUCKET).remove(ledger.storagePaths)
    }
  } catch (error) {
    console.error('rollbackCopy error:', error)
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
    ledger: CopyLedger
  },
): Promise<number> {
  const { data: requests, error } = await admin
    .from('document_requirements')
    .select('*, attachments:document_requirement_attachments(*)')
    .eq('activity_id', options.sourceActivityId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true })

  if (error) throw error
  if (!requests || requests.length === 0) return 0

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
    }
  })

  // Un singur insert pentru toate cererile activității: PostgREST întoarce
  // rândurile în ordinea trimisă, deci se împerechează cu `rows` după index.
  const { data: copies, error: insertError } = await admin
    .from('document_requirements')
    .insert(rows)
    .select('id')

  if (insertError) throw insertError
  if (!copies || copies.length !== rows.length) {
    throw new Error('Inserarea cererilor de documente a întors alt număr de rânduri decât cel trimis.')
  }

  const attachmentRows = prepared.flatMap(({ attachments }, index) =>
    attachments.map((attachment: any, order: number) => ({
      document_requirement_id: copies[index].id,
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

  return rows.length
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
    ledger: CopyLedger
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
  options.ledger.activityIds.push(activity.id)

  const documentRequests = await duplicateDocumentRequests(admin, {
    projectId: options.projectId,
    sourceActivityId: source.id,
    targetActivityId: activity.id,
    actorId: options.actorId,
    ledger: options.ledger,
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
  const ledger = newLedger()

  try {
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
        ledger,
      })))

    // Frații se mută abia acum, după ce copia e completă: până aici un eșec nu
    // atinge ordinea existentă, deci compensarea n-are ce reface acolo.
    await shiftOrderAfter(admin, 'project_phases', 'project_id', options.projectId, sourceOrderIndex, phase.id)

    return {
      phase,
      counts: {
        activities: created.length,
        documentRequests: created.reduce((sum, item) => sum + item.documentRequests, 0),
      },
    }
  } catch (error) {
    await rollbackCopy(admin, ledger)
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
  },
): Promise<{ activity: any; documentRequests: number }> {
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
      ledger,
    })

    await shiftOrderAfter(
      admin, 'project_activities', 'phase_id', options.phaseId, sourceOrderIndex, created.activity.id,
    )

    return created
  } catch (error) {
    await rollbackCopy(admin, ledger)
    throw error
  }
}
