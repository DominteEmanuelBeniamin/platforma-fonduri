/* eslint-disable @typescript-eslint/no-explicit-any */
import { isUuid } from '@/lib/notification-utils'

export const MAX_EXPLICIT_IDS = 500

export type NotificationIdsBody =
  | { ok: true; body: Record<string, any>; ids: string[]; hasIds: boolean }
  | { ok: false; status: number; error: string }

/**
 * Cele trei rute de stare (citit, necitit, renunțare) primesc același corp.
 * Validarea stă într-un singur loc, ca o limită schimbată să nu rămână validă
 * doar în două dintre ele.
 */
export async function parseNotificationIdsBody(request: Request): Promise<NotificationIdsBody> {
  let body: any = {}
  const rawBody = await request.text()
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      return { ok: false, status: 400, error: 'Invalid JSON body' }
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Body must be an object' }
  }

  const hasIds = Object.prototype.hasOwnProperty.call(body, 'ids')
  if (hasIds && (!Array.isArray(body.ids) || body.ids.some((id: unknown) => !isUuid(id)))) {
    return { ok: false, status: 400, error: 'ids must be an array of UUIDs' }
  }

  const ids = hasIds ? [...new Set(body.ids as string[])] : []
  if (ids.length > MAX_EXPLICIT_IDS) {
    return { ok: false, status: 400, error: `ids may contain at most ${MAX_EXPLICIT_IDS} values` }
  }

  return { ok: true, body, ids, hasIds }
}
