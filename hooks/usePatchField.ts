'use client'

import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'

interface PatchFieldOptions {
  /** Mesajul de eroare când serverul nu spune nimic util. */
  fallback: string
  /** Mesajul de succes. Lipsă = salvare tăcută. */
  success?: string
  /** Ce se reîmprospătează după salvare. */
  refresh?: () => void | Promise<void>
}

/**
 * Un PATCH pe un câmp, cu mesaj și reîmprospătare — aceeași formă pentru
 * activități și pentru cereri, care se deosebeau doar prin URL.
 *
 * Motivul real al eșecului stă în `message`: `apiFetch` rescrie `error` cu un
 * text generic pe orice răspuns non-2xx (vezi app/providers/AuthProvider.tsx),
 * deci `error` e mereu prezent și n-are ce spune despre acțiunea curentă.
 *
 * Aruncă mai departe, ca editorul deschis pe loc să rămână deschis cu ce a
 * apucat omul să completeze.
 */
export function usePatchField() {
  const { apiFetch } = useAuth()
  const { showToast } = useToast()

  return async function patchField(
    url: string,
    body: Record<string, unknown>,
    { fallback, success, refresh }: PatchFieldOptions,
  ) {
    let res: Response
    try {
      res = await apiFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      showToast(fallback, 'error')
      throw new Error(fallback)
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      showToast(data?.message || fallback, 'error')
      throw new Error(fallback)
    }

    await refresh?.()
    if (success) showToast(success, 'success')
  }
}
