import { changeItemCompletion } from '@/app/api/_utils/item-completion'

// POST /api/projects/[id]/phases/[phaseId]/activities/[activityId]/reopen
// Readuce activitatea în lucru (#109). Doar adminul și seniorul membru (D1).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; phaseId: string; activityId: string }> },
) {
  const { id: projectId, phaseId, activityId } = await params
  return changeItemCompletion(request, { kind: 'activity', projectId, phaseId, activityId }, 'reopen')
}
