import { isIP } from 'node:net'
import { after, NextResponse } from 'next/server'
import { bearerSessionId, guardToResponse, requireProfile } from '../../_utils/auth'
import { getClientIP, getUserAgent } from '../../_utils/audit'
import { sendPasswordChangedEmail } from '../../_utils/password-changed-email'
import { createSupabaseServiceClient } from '../../_utils/supabase'
import { PASSWORD_MAX_BYTES, PASSWORD_RULE_MESSAGE, newPasswordProblem, passwordByteLength } from '@/lib/password-rules'

// „Contul meu” → Schimbă parola. Oricine are cont își schimbă singur parola,
// cu parola actuală; scrierea trece prin `public.self_change_password`, care
// închide celelalte sesiuni și scrie auditul în aceeași tranzacție.

const JSON_LIMIT = 4096
const RPC_TIMEOUT_MS = 10_000

type Body = { currentPassword: string; newPassword: string; confirmation: string }

function reply(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  // `message` ajunge la om; `error` îl rescrie oricum `apiFetch`.
  return NextResponse.json({ code, error: message, message, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function readBody(request: Request): Promise<Body | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return null
  const text = await request.text().catch(() => null)
  if (text === null || text.length > JSON_LIMIT) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const { currentPassword, newPassword, confirmation } = parsed as Record<string, unknown>
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || typeof confirmation !== 'string') return null
    return { currentPassword, newPassword, confirmation }
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return guardToResponse(ctx)
  const sessionId = bearerSessionId(request)
  if (!sessionId) return reply(401, 'session_invalid', 'Sesiunea a expirat. Intră din nou în cont și reîncearcă.')

  const body = await readBody(request)
  if (!body) return reply(400, 'invalid_request', 'Completează parola actuală și parola nouă de două ori.')
  if (!body.currentPassword || passwordByteLength(body.currentPassword) > PASSWORD_MAX_BYTES) {
    return reply(400, 'wrong_password', 'Parola actuală nu este corectă.')
  }
  if (body.newPassword !== body.confirmation) return reply(400, 'mismatch', 'Parolele noi nu coincid.')
  const ruleProblem = newPasswordProblem(body.newPassword)
  if (ruleProblem) return reply(400, 'password_invalid', ruleProblem)

  const ip = getClientIP(request)
  const userAgent = getUserAgent(request)
  const { data, error } = await createSupabaseServiceClient()
    .rpc('self_change_password', {
      p_user_id: ctx.user.id,
      p_session_id: sessionId,
      p_current_password: body.currentPassword,
      p_new_password: body.newPassword,
      p_ip_address: isIP(ip) ? ip : null,
      p_user_agent: userAgent === 'unknown' ? null : userAgent.slice(0, 512),
    })
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))

  if (error) {
    console.error('self_change_password failed:', { userId: ctx.user.id, code: error.code })
    return reply(503, 'temporarily_unavailable', 'Nu am putut schimba parola acum. Încearcă din nou peste câteva minute.')
  }
  const result = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>

  switch (result.status) {
    case 'completed': {
      const email = typeof result.email === 'string' ? result.email : ctx.profile.email ?? null
      const fullName = typeof result.full_name === 'string' ? result.full_name : null
      const changedAt = new Date()
      if (email) after(() => sendPasswordChangedEmail({ email, fullName, changedAt }))
      const revoked = typeof result.other_sessions_revoked === 'number' ? result.other_sessions_revoked : 0
      return NextResponse.json({ status: 'completed', otherSessionsRevoked: revoked }, { headers: { 'Cache-Control': 'no-store' } })
    }
    case 'wrong_password': {
      const left = typeof result.attempts_left === 'number' ? result.attempts_left : null
      return reply(400, 'wrong_password', left !== null && left <= 2
        ? `Parola actuală nu este corectă. Mai ai ${left === 1 ? 'o încercare' : `${left} încercări`} înainte de o pauză de 15 minute.`
        : 'Parola actuală nu este corectă.', { attemptsLeft: left })
    }
    case 'rate_limited':
      return reply(429, 'rate_limited', 'Prea multe încercări cu parola actuală greșită. Încearcă din nou peste 15 minute sau folosește „Ai uitat parola?” de pe pagina de autentificare.')
    case 'same_password':
      return reply(400, 'same_password', 'Parola nouă e la fel cu cea actuală. Alege alta.')
    case 'password_invalid':
      return reply(400, 'password_invalid', PASSWORD_RULE_MESSAGE)
    case 'session_invalid':
      return reply(401, 'session_invalid', 'Sesiunea a expirat. Intră din nou în cont și reîncearcă.')
    case 'ineligible':
      return reply(409, 'ineligible', 'Parola acestui cont nu se poate schimba de aici. Scrie-i administratorului.')
    default:
      return reply(503, 'temporarily_unavailable', 'Nu am putut schimba parola acum. Încearcă din nou peste câteva minute.')
  }
}
