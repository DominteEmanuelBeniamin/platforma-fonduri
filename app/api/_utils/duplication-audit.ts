// Intrarile de audit pentru elementele create de o duplicare.
//
// Cele doua rute de duplicare — fază și activitate — scriu exact aceleasi
// randuri pentru activitatile si cererile copiate, deci textul si campurile
// stau intr-un singur loc. Randul radacinii (faza sau activitatea ceruta
// explicit) ramane in ruta, fiindca acolo difera.

import type { LogActionParams } from './audit'
import type { DuplicationAudit, DuplicationAuditNode } from './duplicate-project-items'

type Context = {
  projectId: string
  projectTitle: string
  actorId: string
  request: Request
  /** Numele folosit cand nodul nu-l poarta el insusi. */
  fallbackPhaseName?: string | null
  fallbackActivityName?: string | null
}

function activityEntry(item: DuplicationAuditNode, ctx: Context): LogActionParams {
  return {
    actorId: ctx.actorId,
    actionType: 'create',
    entityType: 'project_activity',
    entityId: item.copyId,
    entityName: item.copyName,
    newValues: {
      project_id: ctx.projectId,
      project_title: ctx.projectTitle,
      phase_id: item.phaseId,
      phase_name: item.phaseName,
      source_activity_id: item.sourceId,
      source_activity_name: item.sourceName,
      created_by: ctx.actorId,
      duplication: {
        source_kind: 'persistent',
        source_entity_type: 'project_activity',
        source_id: item.sourceId,
        source_name: item.sourceName,
      },
    },
    description: `Duplicare activitate "${item.sourceName}" -> "${item.copyName}" în faza "${item.phaseName ?? ctx.fallbackPhaseName ?? ''}" (proiect "${ctx.projectTitle}")`,
    request: ctx.request,
  }
}

function documentRequestEntry(item: DuplicationAuditNode, ctx: Context): LogActionParams {
  return {
    actorId: ctx.actorId,
    actionType: 'create',
    entityType: 'document_request',
    entityId: item.copyId,
    entityName: item.copyName,
    newValues: {
      project_id: ctx.projectId,
      project_title: ctx.projectTitle,
      phase_id: item.phaseId,
      phase_name: item.phaseName,
      activity_id: item.activityId,
      activity_name: item.activityName,
      source_activity_id: item.sourceActivityId,
      source_activity_name: item.sourceActivityName,
      created_by: ctx.actorId,
      duplication: {
        source_kind: 'persistent',
        source_entity_type: 'document_request',
        source_id: item.sourceId,
        source_name: item.sourceName,
      },
    },
    description: `Duplicare cerere de document "${item.sourceName}" -> "${item.copyName}" în activitatea "${item.activityName ?? ctx.fallbackActivityName ?? ''}" (proiect "${ctx.projectTitle}")`,
    request: ctx.request,
  }
}

/** Intrarile pentru descendentii copiati, in ordinea in care au fost creati. */
export function duplicationAuditEntries(audit: DuplicationAudit, ctx: Context): LogActionParams[] {
  return [
    ...audit.activities.map(item => activityEntry(item, ctx)),
    ...audit.documentRequests.map(item => documentRequestEntry(item, ctx)),
  ]
}
