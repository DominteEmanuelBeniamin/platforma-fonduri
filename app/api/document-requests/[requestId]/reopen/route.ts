import { changeRequestClosure } from '@/app/api/_utils/request-closure'

// POST /api/document-requests/[requestId]/reopen
// Redeschide cererea în starea dinainte de închidere (#109). Clientul nu e
// anunțat; reminderele o readuc în atenția lui la următorul prag.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params
  return changeRequestClosure(request, requestId, 'reopen')
}
