import { requireAdmin } from '@/app/api/_utils/auth'
import {
  adminPasswordResetResponse,
  executeAdminPasswordReset,
  isResetEmail,
  isResetUuid,
  resetAuthError,
  resetBodyError,
  resetSessionError,
  resetTargetError,
} from '@/app/api/_utils/admin-password-reset'

// Lanțul complet (reset, prepare, furnizor, finish, claim) poate depăși 30s; ca rutele de recovery.
export const maxDuration = 60

const JSON_LIMIT = 4096

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readResetBody(request: Request): Promise<{ attemptId: string; expectedEmail: string } | null> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return null
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > JSON_LIMIT)) return null

  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > JSON_LIMIT) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!isObject(parsed) || Object.keys(parsed).length !== 2
      || !Object.prototype.hasOwnProperty.call(parsed, 'attemptId')
      || !Object.prototype.hasOwnProperty.call(parsed, 'expectedEmail')
      || !isResetUuid(parsed.attemptId)
      || !isResetEmail(parsed.expectedEmail)) return null
    return {
      attemptId: parsed.attemptId.toLowerCase(),
      expectedEmail: parsed.expectedEmail.trim(),
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function validatedSessionId(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!isObject(claims) || !isResetUuid(claims.session_id)) return null
    return claims.session_id.toLowerCase()
  } catch {
    return null
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>
  try {
    admin = await requireAdmin(request)
  } catch {
    return adminPasswordResetResponse({
      code: 'temporarily_unavailable',
      error: 'Autentificarea nu este disponibilă momentan.',
      message: 'Autentificarea nu este disponibilă momentan.',
    }, 503)
  }
  if (!admin.ok) return resetAuthError(admin.status)

  try {
    const { userId } = await params
    if (!isResetUuid(userId)) return resetTargetError()

    const actorSessionId = validatedSessionId(request)
    if (!actorSessionId) return resetSessionError()

    const body = await readResetBody(request)
    if (!body) return resetBodyError()

    return await executeAdminPasswordReset(request, {
      actorId: admin.user.id,
      actorSessionId,
      targetId: userId.toLowerCase(),
      attemptId: body.attemptId,
      expectedEmail: body.expectedEmail,
    })
  } catch {
    return adminPasswordResetResponse({
      code: 'temporarily_unavailable',
      error: 'Nu am putut procesa cererea. Reîncearcă aceeași încercare pentru a verifica rezultatul.',
      message: 'Nu am putut procesa cererea. Reîncearcă aceeași încercare pentru a verifica rezultatul.',
    }, 503)
  }
}
