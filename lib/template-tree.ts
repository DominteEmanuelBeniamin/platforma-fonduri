/* eslint-disable @typescript-eslint/no-explicit-any */

// Asamblarea arborelui de șablon din rânduri plate, încărcate câte o cerere
// per nivel. Păstrează forma pe care o întorcea înainte GET-ul N+1:
// template → phases → activities → document_requirements, ordonate după
// order_index, doar elementele active și doar cele cu părinte activ.

function byOrderIndex(a: any, b: any) {
  return (a.order_index ?? 0) - (b.order_index ?? 0)
}

function groupBy(rows: any[], key: string) {
  const groups = new Map<string, any[]>()
  for (const row of rows) {
    const parentId = row[key]
    if (!parentId) continue
    const group = groups.get(parentId)
    if (group) group.push(row)
    else groups.set(parentId, [row])
  }
  for (const group of groups.values()) group.sort(byOrderIndex)
  return groups
}

export function assembleTemplateTrees(
  templates: any[],
  phases: any[],
  activities: any[],
  documents: any[],
) {
  const docsByActivity = groupBy(documents, 'template_activity_id')
  const activitiesByPhase = groupBy(activities, 'template_phase_id')
  const phasesByTemplate = groupBy(phases, 'template_id')

  return templates.map(template => ({
    ...template,
    phases: (phasesByTemplate.get(template.id) ?? []).map(phase => ({
      ...phase,
      activities: (activitiesByPhase.get(phase.id) ?? []).map(activity => ({
        ...activity,
        document_requirements: docsByActivity.get(activity.id) ?? [],
      })),
    })),
  }))
}

// Rulează `worker` pe fiecare element cu cel mult `limit` în paralel și
// întoarce rezultatele în ordinea de intrare.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, run))
  return results
}
