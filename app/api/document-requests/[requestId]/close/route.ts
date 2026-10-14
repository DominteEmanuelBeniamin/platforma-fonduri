import { changeRequestClosure } from '@/app/api/_utils/request-closure'

// POST /api/document-requests/[requestId]/close
// Închide cererea (#109): doar din „De încărcat" sau „Respins" (D3), niciodată
// un document trimis clientului (D12). Doar adminul și seniorul membru (D1).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params
  return changeRequestClosure(request, requestId, 'close')
}
