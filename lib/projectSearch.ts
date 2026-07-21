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
}

/**
 * Construiește indexul de căutare din datele deja încărcate în pagina proiectului
 * (fazele cu activitățile lor + toate cererile de documente) — fără fetch nou.
 */
export function buildSearchIndex(phases: any[], allDocRequests: any[]): SearchResult[] {
  const results: SearchResult[] = []
  const phaseNameById = new Map(phases.map((p: any) => [p.id, p.name]))

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
      })
    }
  }

  for (const req of allDocRequests) {
    if (req.is_outgoing || req.deleted_at) continue
    const activityId = req.activity?.id ?? req.activity_id ?? null
    const activityName = req.activity?.name ?? null
    const phaseId = req.activity?.phase_id ?? null
    results.push({
      id: req.id,
      type: 'document_request',
      title: req.name,
      description: req.description ?? null,
      phaseId,
      phaseName: phaseId ? phaseNameById.get(phaseId) ?? null : null,
      activityId,
      activityName,
      status: req.status ?? null,
    })
  }

  return results
}

/** Potrivire substring, case-insensitive, pe titlu + descriere — fără dependință de căutare fuzzy. */
export function filterSearchIndex(index: SearchResult[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return index.filter(
    r => r.title.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
  )
}
