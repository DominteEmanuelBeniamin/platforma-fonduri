import { changeProjectLifecycle } from '@/app/api/_utils/project-closure'

// POST /api/projects/[id]/reopen
// Redeschide proiectul (#109). Adminul și seniorul membru.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params
  return changeProjectLifecycle(request, projectId, 'reopen')
}
