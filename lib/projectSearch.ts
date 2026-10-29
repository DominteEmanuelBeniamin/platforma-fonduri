import { displayedRequestStatus, requestStatusLabel } from './request-status.ts'
import { activityStatus } from './activity-status.ts'
import { requestOwnerId } from './calendar.ts'
import { formatDate } from './signage.ts'
import { isEmptyQuery, searchItems, type SearchField, type SearchHit } from './search.ts'
import type { ProjectPhase } from '@/components/ProjectPhasesSidebar'

export type SearchResultType = 'phase' | 'activity' | 'document_request'

export interface SearchResult {
  id: string
  type: SearchResultType
  title: string
  description: string | null
  phaseId: string | null
  phaseName: string | null
  activityId: string | null
  activityName: string | null
  status: string | null
  /** Ce se caută la rezultat (#112): titlul și descrierea se văd, restul apar în „Găsit în". */
  fields: SearchField[]
}

interface SearchPerson {
  id: string
  full_name?: string | null
  email?: string | null
}

interface SearchDocumentRequest {
  id: string
  name: string
  description?: string | null
  is_outgoing?: boolean
  deleted_at?: string | null
  activity_id?: string | null
  status?: string | null
  status_before_close?: string | null
  deadline_at?: string | null
  assigned_to?: string | null
  assigned_consultant?: SearchPerson | null
  attachment_original_name?: string | null
  attachments?: { original_name?: string | null }[] | null
  activity?: {
    id?: string | null
    name?: string | null
    phase_id?: string | null
    assigned_to?: string | null
  } | null
}

const personName = (person: SearchPerson | null | undefined) =>
  person?.full_name?.trim() || person?.email?.trim() || null

const deadlineOf = (value: string | null | undefined) => (value ? formatDate(value) : null)

function baseFields(title: string, description: string | null): SearchField[] {
  return [
    { key: 'title', label: 'Nume', value: title },
    { key: 'description', label: 'Descriere', value: description },
  ]
}

/**
 * Construiește indexul de căutare din datele deja încărcate în pagina proiectului
 * (fazele cu activitățile lor + toate cererile de documente) — fără fetch nou.
 * Datele vin deja filtrate pe ce vede rolul: clientul nu primește nimic „în
 * pregătire", deci nici nu găsește.
 */
export function buildSearchIndex(
  phases: ProjectPhase[],
  allDocRequests: SearchDocumentRequest[],
  options: { isClient?: boolean; todayTs?: number; generalConsultant?: SearchPerson | null } = {},
): SearchResult[] {
  const isClient = options.isClient ?? false
  const todayTs = options.todayTs ?? Date.now()
  const results: SearchResult[] = []
  const phaseNameById = new Map(phases.map(phase => [phase.id, phase.name]))
  const activityById = new Map(phases.flatMap(phase => phase.activities ?? []).map(activity => [activity.id, activity]))
  const requestsByActivity = new Map<string, SearchDocumentRequest[]>()
  for (const req of allDocRequests) {
    const activityId = req.activity?.id ?? req.activity_id
    if (activityId) requestsByActivity.set(activityId, [...(requestsByActivity.get(activityId) ?? []), req])
  }

  for (const phase of phases) {
    results.push({
      id: phase.id,
      type: 'phase',
      title: phase.name,
      description: null,
      phaseId: phase.id,
      phaseName: phase.name,
      activityId: null,
      activityName: null,
      status: phase.status ?? null,
      fields: [
        ...baseFields(phase.name, null),
        { key: 'status', label: 'Status', value: phase.status === 'completed' ? 'Finalizată' : 'În curs', shown: false },
      ],
    })

    for (const activity of phase.activities ?? []) {
      results.push({
        id: activity.id,
        type: 'activity',
        title: activity.name,
        description: null,
        phaseId: phase.id,
        phaseName: phase.name,
        activityId: activity.id,
        activityName: activity.name,
        status: activity.status ?? null,
        fields: [
          ...baseFields(activity.name, null),
          { key: 'responsabil', label: 'Responsabil', value: personName(activity.assigned_user), shown: false },
          {
            key: 'status',
            label: 'Status',
            value: activityStatus(activity, requestsByActivity.get(activity.id) ?? [], todayTs, isClient).label,
            shown: false,
          },
          { key: 'termen', label: 'Termen', value: deadlineOf(activity.deadline_at), shown: false },
        ],
      })
    }
  }

  for (const req of allDocRequests) {
    if (req.is_outgoing || req.deleted_at) continue
    const activityId = req.activity?.id ?? req.activity_id ?? null
    const activityName = req.activity?.name ?? null
    const phaseId = req.activity?.phase_id ?? null
    const activity = activityId ? activityById.get(activityId) : undefined
    const ownerId = requestOwnerId({
      assigned_to: req.assigned_to ?? req.assigned_consultant?.id,
      activity_id: activityId,
      activity: { assigned_to: req.activity?.assigned_to ?? activity?.assigned_to },
      generalOwnerId: options.generalConsultant?.id,
    })
    const owner = [req.assigned_consultant, activity?.assigned_user, options.generalConsultant]
      .find(person => person?.id === ownerId)
    // Închisă din „Aprobat”, se arată „Aprobat” (ca peste tot).
    const status = displayedRequestStatus(req)
    const models = [req.attachment_original_name, ...(req.attachments ?? []).map(a => a.original_name)]
    results.push({
      id: req.id,
      type: 'document_request',
      title: req.name,
      description: req.description ?? null,
      phaseId,
      phaseName: phaseId ? phaseNameById.get(phaseId) ?? null : null,
      activityId,
      activityName,
      status,
      fields: [
        ...baseFields(req.name, req.description ?? null),
        { key: 'responsabil', label: 'Responsabil', value: personName(owner), shown: false },
        { key: 'status', label: 'Status', value: requestStatusLabel(status, isClient), shown: false },
        { key: 'termen', label: 'Termen', value: deadlineOf(req.deadline_at), shown: false },
        { key: 'model', label: 'Model', value: [...new Set(models.filter(Boolean))].join(', '), shown: false },
      ],
    })
  }

  return results
}

/** Toate rezultatele care se potrivesc, cele exacte primele. Fără interogare, nimic. */
export function searchIndex(index: SearchResult[], query: string): SearchHit<SearchResult>[] {
  if (isEmptyQuery(query)) return []
  return searchItems(index, query, result => result.fields)
}
