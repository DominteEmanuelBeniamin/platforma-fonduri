// Ce se întâmplă cu cererile de documente când ștergi o fază sau o activitate.
//
// Ștergerea nu duce cererile cu ea: RPC-ul le mută la „Cereri generale”, iar
// cele publicate sub un părinte nepublicat revin la „În pregătire”. Textul
// dialogului trebuie să spună asta la fel din orice loc pornește ștergerea.

export type DeletionImpact = { moved: number; demoted: number }

type RequestLike = {
  activity_id?: string | null
  deleted_at?: string | null
  visibility?: 'draft' | 'published'
}

type ActivityLike = { id: string; name: string; visibility?: 'draft' | 'published' }

type PhaseLike = {
  name: string
  visibility?: 'draft' | 'published'
  activities?: ActivityLike[]
}

export function activityDeletionImpact(
  requests: readonly RequestLike[],
  phase: PhaseLike,
  activity: ActivityLike,
): DeletionImpact {
  const own = requests.filter(request => request.activity_id === activity.id && !request.deleted_at)
  return {
    moved: own.length,
    demoted: own.filter(request =>
      request.visibility === 'published'
      && (phase.visibility !== 'published' || activity.visibility !== 'published')
    ).length,
  }
}

export function phaseDeletionImpact(
  requests: readonly RequestLike[],
  phase: PhaseLike,
): DeletionImpact {
  const activityVisibility = new Map((phase.activities ?? []).map(activity => [activity.id, activity.visibility]))
  const own = requests.filter(request =>
    request.activity_id && activityVisibility.has(request.activity_id) && !request.deleted_at
  )
  return {
    moved: own.length,
    demoted: own.filter(request =>
      request.visibility === 'published'
      && (phase.visibility !== 'published' || activityVisibility.get(request.activity_id!) !== 'published')
    ).length,
  }
}

export function requestWarning({ moved, demoted }: DeletionImpact): string {
  const parts: string[] = []
  if (moved > 0) {
    parts.push(moved === 1
      ? 'Cererea de documente asociată va fi mutată la „Cereri generale”, împreună cu fișierele sale.'
      : `Cele ${moved} cereri de documente asociate vor fi mutate la „Cereri generale”, împreună cu fișierele lor.`)
  }
  if (demoted > 0) {
    parts.push(demoted === 1
      ? 'Dintre acestea, o cerere marcată ca publicată va reveni la starea „În pregătire” și va rămâne invizibilă clientului.'
      : `Dintre acestea, ${demoted} cereri marcate ca publicate vor reveni la starea „În pregătire” și vor rămâne invizibile clientului.`)
  }
  return parts.join(' ')
}

/** Textul dialogului de confirmare pentru o fază. */
export function phaseDeletionConfirm(phase: PhaseLike, impact: DeletionImpact) {
  const activityCount = phase.activities?.length ?? 0
  const activityLabel = activityCount === 1
    ? 'activitatea asociată'
    : `cele ${activityCount} activități asociate`
  const description = activityCount === 0
    ? `Faza „${phase.name}” va fi ștearsă definitiv.`
    : `Faza „${phase.name}” și ${activityLabel} vor fi șterse definitiv.`

  return {
    title: `Ștergi faza „${phase.name}”?`,
    description: [description, requestWarning(impact)].filter(Boolean).join(' '),
    confirmText: 'Șterge faza',
  }
}

/** Textul dialogului de confirmare pentru o activitate. */
export function activityDeletionConfirm(activity: ActivityLike, impact: DeletionImpact) {
  return {
    title: `Ștergi activitatea „${activity.name}”?`,
    description: [
      `Activitatea „${activity.name}” va fi ștearsă definitiv.`,
      requestWarning(impact),
    ].filter(Boolean).join(' '),
    confirmText: 'Șterge activitatea',
  }
}
