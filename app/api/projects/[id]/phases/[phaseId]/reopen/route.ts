import { changeItemCompletion } from '@/app/api/_utils/item-completion'

// POST /api/projects/[id]/phases/[phaseId]/reopen
// Readuce faza în lucru (#109). Doar adminul și seniorul membru (D1).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; phaseId: string }> },
) {
  const { id: projectId, phaseId } = await params
  return changeItemCompletion(request, { kind: 'phase', projectId, phaseId }, 'reopen')
}
