import type { AppRole } from './auth'
import type { createSupabaseServiceClient } from './supabase'
import {
  extractProjectChatLinks,
  splitProjectChatBody,
  UNRESOLVED_LINK_TEXT,
  type ProjectChatLinkReference,
} from '../../../lib/project-chat-links.ts'

type ProjectChatAdmin = ReturnType<typeof createSupabaseServiceClient>

export type ProjectChatBodyRow = {
  body?: string | null
  deleted_at?: string | null
  is_deleted?: boolean
  body_masked?: boolean
}

export type ProjectChatPhaseVisibilityRow = {
  id: string
  project_id: string
  visibility: string | null | undefined
}

export type ProjectChatActivityVisibilityRow = {
  id: string
  phase_id: string
  visibility: string | null | undefined
}

export type ProjectChatRequestVisibilityRow = {
  id: string
  project_id: string
  activity_id: string | null | undefined
  visibility: string | null | undefined
  deleted_at: string | null | undefined
}

type VisibilityRows<T> = ReadonlyMap<string, T> | readonly T[]

export type ProjectChatVisibilityMaps = {
  phases: VisibilityRows<ProjectChatPhaseVisibilityRow>
  activities: VisibilityRows<ProjectChatActivityVisibilityRow>
  requests: VisibilityRows<ProjectChatRequestVisibilityRow>
}

function asMap<T extends { id: string }>(rows: VisibilityRows<T>): ReadonlyMap<string, T> {
  if (!Array.isArray(rows)) return rows as ReadonlyMap<string, T>
  return new Map((rows as readonly T[]).map(row => [row.id, row] as const))
}

function visiblePhase(
  phaseId: string,
  projectId: string,
  phases: ReadonlyMap<string, ProjectChatPhaseVisibilityRow>,
): boolean {
  const phase = phases.get(phaseId)
  return phase?.id === phaseId && phase.project_id === projectId && phase.visibility === 'published'
}

function visibleActivity(
  phaseId: string,
  activityId: string,
  projectId: string,
  phases: ReadonlyMap<string, ProjectChatPhaseVisibilityRow>,
  activities: ReadonlyMap<string, ProjectChatActivityVisibilityRow>,
): boolean {
  const activity = activities.get(activityId)
  return Boolean(
    activity?.id === activityId &&
      activity.phase_id === phaseId &&
      activity.visibility === 'published' &&
      visiblePhase(phaseId, projectId, phases),
  )
}

function visibleReference(
  reference: ProjectChatLinkReference,
  projectId: string,
  maps: {
    phases: ReadonlyMap<string, ProjectChatPhaseVisibilityRow>
    activities: ReadonlyMap<string, ProjectChatActivityVisibilityRow>
    requests: ReadonlyMap<string, ProjectChatRequestVisibilityRow>
  },
): boolean {
  if (reference.projectId !== projectId) return false

  if (reference.type === 'phase') {
    return visiblePhase(reference.phaseId, projectId, maps.phases)
  }

  if (reference.type === 'activity') {
    return visibleActivity(reference.phaseId, reference.activityId, projectId, maps.phases, maps.activities)
  }

  const request = maps.requests.get(reference.requestId)
  if (!request || request.id !== reference.requestId || request.project_id !== projectId) return false
  if (request.deleted_at || request.visibility !== 'published') return false

  if (reference.phaseId === '__general__') {
    return reference.activityId === null && request.activity_id == null
  }

  return Boolean(
    reference.activityId &&
      request.activity_id === reference.activityId &&
      visibleActivity(reference.phaseId, reference.activityId, projectId, maps.phases, maps.activities),
  )
}

/**
 * Mască doar referințele interne care nu mai sunt vizibile pentru client.
 * Funcție pură: imaginile, mesajele șterse și orice URL nevalid rămân intacte.
 */
export function maskProjectChatBodiesFromVisibilityMaps<T extends ProjectChatBodyRow>(
  rows: readonly T[],
  projectId: string,
  visibilityMaps: ProjectChatVisibilityMaps,
): T[] {
  const maps = {
    phases: asMap(visibilityMaps.phases),
    activities: asMap(visibilityMaps.activities),
    requests: asMap(visibilityMaps.requests),
  }

  return rows.map(row => {
    if (row.deleted_at || row.is_deleted || typeof row.body !== 'string') return row

    const links = extractProjectChatLinks(row.body, projectId)
    if (links.length === 0) return row

    let changed = false
    const body = splitProjectChatBody(row.body, projectId)
      .map(segment => {
        if (segment.kind !== 'link' || visibleReference(segment.reference, projectId, maps)) {
          return segment.text
        }
        changed = true
        return UNRESOLVED_LINK_TEXT
      })
      .join('')

    return changed ? { ...row, body, body_masked: true } : row
  })
}

type BatchResult = { rows: unknown[] }

async function loadBatch(
  admin: ProjectChatAdmin,
  table: string,
  columns: string,
  ids: string[],
): Promise<BatchResult> {
  if (ids.length === 0) return { rows: [] }
  try {
    const result = await admin.from(table).select(columns).in('id', ids)
    if (result?.error || !Array.isArray(result?.data)) return { rows: [] }
    return { rows: result.data }
  } catch {
    // Fail closed: a temporary visibility lookup failure cannot leak a body.
    return { rows: [] }
  }
}

function field(row: unknown, name: string): unknown {
  return row && typeof row === 'object' ? (row as Record<string, unknown>)[name] : undefined
}

function stringField(row: unknown, name: string): string | null {
  const value = field(row, name)
  return typeof value === 'string' ? value : null
}

function toPhase(row: unknown): ProjectChatPhaseVisibilityRow | null {
  const id = stringField(row, 'id')
  const projectId = stringField(row, 'project_id')
  return id && projectId ? { id, project_id: projectId, visibility: stringField(row, 'visibility') } : null
}

function toActivity(row: unknown): ProjectChatActivityVisibilityRow | null {
  const id = stringField(row, 'id')
  const phaseId = stringField(row, 'phase_id')
  return id && phaseId ? { id, phase_id: phaseId, visibility: stringField(row, 'visibility') } : null
}

function toRequest(row: unknown): ProjectChatRequestVisibilityRow | null {
  const id = stringField(row, 'id')
  const projectId = stringField(row, 'project_id')
  if (!id || !projectId) return null
  const activityId = field(row, 'activity_id')
  const deletedAt = field(row, 'deleted_at')
  return {
    id,
    project_id: projectId,
    activity_id: typeof activityId === 'string' ? activityId : null,
    visibility: stringField(row, 'visibility'),
    deleted_at: typeof deletedAt === 'string' ? deletedAt : null,
  }
}

function mapRows<T extends { id: string }>(rows: unknown[], convert: (row: unknown) => T | null): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) {
    const value = convert(row)
    if (value) map.set(value.id, value)
  }
  return map
}

/**
 * Returnează corpul original pentru staff și maschează referințele draft/șterse
 * pentru client, folosind lookup-uri batch și verificarea întregului lanț.
 */
export async function maskProjectChatBodiesForViewer<T extends ProjectChatBodyRow>(
  admin: ProjectChatAdmin,
  role: AppRole,
  projectId: string,
  rows: readonly T[],
): Promise<T[]> {
  if (role === 'admin' || role === 'consultant') return [...rows]

  const references = rows
    .filter(row => !row.deleted_at && !row.is_deleted && typeof row.body === 'string')
    .flatMap(row => extractProjectChatLinks(row.body!, projectId).map(link => link.reference))

  const phaseIds = [...new Set(references.flatMap(reference =>
    reference.type === 'phase' || reference.type === 'activity'
      ? [reference.phaseId]
      : reference.phaseId === '__general__' ? [] : [reference.phaseId],
  ))]
  const activityIds = [...new Set(references.flatMap(reference =>
    reference.type === 'activity' || (reference.type === 'document_request' && reference.activityId)
      ? [reference.type === 'activity' ? reference.activityId : reference.activityId!]
      : [],
  ))]
  const requestIds = [...new Set(references
    .filter((reference): reference is Extract<ProjectChatLinkReference, { type: 'document_request' }> => reference.type === 'document_request')
    .map(reference => reference.requestId))]

  const [phaseResult, activityResult, requestResult] = await Promise.all([
    loadBatch(admin, 'project_phases', 'id, project_id, visibility', phaseIds),
    loadBatch(admin, 'project_activities', 'id, phase_id, visibility', activityIds),
    loadBatch(admin, 'document_requirements', 'id, project_id, activity_id, visibility, deleted_at', requestIds),
  ])

  return maskProjectChatBodiesFromVisibilityMaps(rows, projectId, {
    phases: mapRows(phaseResult.rows, toPhase),
    activities: mapRows(activityResult.rows, toActivity),
    requests: mapRows(requestResult.rows, toRequest),
  })
}
