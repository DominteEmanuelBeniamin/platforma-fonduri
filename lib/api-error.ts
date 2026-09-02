/**
 * Motivul real al unui răspuns de eroare.
 *
 * `apiFetch` rescrie câmpul `error` cu un text generic (vezi
 * `app/providers/AuthProvider.tsx`), deci convenția (#70) e ca serverul să pună
 * explicația și în `message`, singurul câmp care ajunge nealterat la client.
 */
export async function serverMessage(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  const message = (body as { message?: unknown } | null)?.message
  return (typeof message === 'string' && message) || fallback
}
