import { changeProjectLifecycle } from '@/app/api/_utils/project-closure'

// POST /api/projects/[id]/close
// Încheie proiectul (#109): reminderele automate se opresc, iar elementele lui
// deschise ies din listele „de făcut". Adminul și seniorul membru.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params
  return changeProjectLifecycle(request, projectId, 'close')
}
