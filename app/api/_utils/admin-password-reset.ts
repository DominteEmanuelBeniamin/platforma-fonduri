import { generateTemporaryPassword } from '@/lib/temporary-password'
import { isIP } from 'node:net'
import { renderTemporaryPasswordEmail } from '@/lib/temporary-password-email'
import { createSupabaseServiceClient } from './supabase'
import { getClientIP, getUserAgent } from './audit'
import { isValidReminderEmail, resendFromAddress, resolveReminderDelivery, sanitizeHeaderText } from './email'

const RPC_TIMEOUT_MS = 5_000
const PROVIDER_TIMEOUT_MS = 10_000
const RESEND_API_ORIGIN = 'https://api.resend.com'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>
type DeliveryStatus = 'sent' | 'failed' | 'unknown' | 'skipped'
type RpcRecord = Record<string, unknown>
type ResetInput = {
  actorId: string
  actorSessionId: string
  targetId: string
  attemptId: string
  expectedEmail: string
}

type PreparedEmail =
  | { kind: 'ready'; baseUrl: string; apiKey: string; from: string; to: string; email: ReturnType<typeof renderTemporaryPasswordEmail> }
  | { kind: 'failed'; reason: 'configuration' }
  | { kind: 'skipped' }

function isObject(value: unknown): value is RpcRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rpcRecord(value: unknown): RpcRecord | null {
  if (Array.isArray(value)) return isObject(value[0]) ? value[0] : null
  return isObject(value) ? value : null
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function normalizedDeliveryStatus(value: unknown): DeliveryStatus | null {
  if (value === 'sent' || value === 'failed' || value === 'unknown' || value === 'skipped') return value
  if (value === 'pending') return 'unknown'
  return null
}

function publicDeliveryStatus(value: unknown): DeliveryStatus {
  return normalizedDeliveryStatus(value) ?? 'unknown'
}

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function adminPasswordResetResponse(body: unknown, status = 200) {
  return response(body, status)
}

function failure(code: string, error: string, status: number) {
  return response({ code, error, message: error }, status)
}

function retrySameAttempt() {
  return failure(
    'temporarily_unavailable',
    'Nu am putut confirma rezultatul. Reîncearcă aceeași încercare pentru a verifica dacă resetarea s-a finalizat.',
    503,
  )
}

function productionLike() {
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase()
  return process.env.NODE_ENV === 'production'
    || vercelEnvironment === 'production'
    || vercelEnvironment === 'preview'
}

function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function getLoginUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    if (url.protocol !== 'https:'
      && !(url.protocol === 'http:' && isLoopback(url.hostname)
        && process.env.NODE_ENV === 'development' && !productionLike())) return null
    return new URL('/login', url.origin).toString()
  } catch {
    return null
  }
}

function getResendBaseUrl() {
  const configured = process.env.RESEND_BASE_URL
  if (configured === undefined || configured === ''
    || configured.replace(/\/$/, '') === RESEND_API_ORIGIN) return RESEND_API_ORIGIN
  if (configured.trim() !== configured || process.env.NODE_ENV !== 'development' || productionLike()) return null
  try {
    const url = new URL(configured)
    if (url.protocol !== 'http:' || !isLoopback(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

function prepareEmail(result: RpcRecord, password: string): PreparedEmail {
  const accountEmail = result.email
  if (typeof accountEmail !== 'string' || accountEmail.length > 254 || !isValidReminderEmail(accountEmail)) {
    return { kind: 'skipped' }
  }

  const delivery = resolveReminderDelivery(accountEmail)
  if (!delivery.ok) {
    return delivery.error.code === 'invalid_email'
      ? { kind: 'skipped' }
      : { kind: 'failed', reason: 'configuration' }
  }

  const baseUrl = getResendBaseUrl()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const loginUrl = getLoginUrl()
  const role = result.role
  const audience = role === 'client' ? 'client' : 'internal'
  const from = sanitizeHeaderText(resendFromAddress(audience))
  const senderConfigured = audience === 'client'
    ? Boolean(process.env.RESEND_CLIENT_NOTIFICATION_FROM_EMAIL?.trim() || process.env.RESEND_FROM_EMAIL?.trim())
    : Boolean(process.env.RESEND_FROM_EMAIL?.trim())
  if (!baseUrl || !apiKey || !loginUrl || !from || (productionLike() && !senderConfigured)) {
    return { kind: 'failed', reason: 'configuration' }
  }

  const email = renderTemporaryPasswordEmail({
    context: 'admin_reset',
    fullName: typeof result.full_name === 'string' ? result.full_name : '',
    email: accountEmail.trim(),
    password,
    loginUrl,
    companyName: role === 'client' && typeof result.nume_firma === 'string' ? result.nume_firma : null,
  })
  return {
    kind: 'ready',
    baseUrl,
    apiKey,
    from,
    to: delivery.data.deliveryEmail,
    email,
  }
}

async function callRpc(client: ServiceClient, functionName: string, args: Record<string, unknown>) {
  return client.rpc(functionName, args).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
}

function auditMetadata(request: Request) {
  const ipAddress = getClientIP(request)
  const userAgent = getUserAgent(request)
  return {
    ipAddress: isIP(ipAddress) ? ipAddress : null,
    userAgent: userAgent && userAgent !== 'unknown' ? userAgent.slice(0, 512) : null,
  }
}
function initialRpcFailure(error: unknown) {
  if (!isObject(error) || error.code !== 'P0001' || typeof error.message !== 'string') return null
  switch (error.message) {
    case 'USER_NOT_FOUND':
      return failure('target_not_found', 'Contul solicitat nu a fost găsit.', 404)
    case 'ACTIVE_ADMIN_REQUIRED':
      return failure('forbidden', 'Acțiunea este disponibilă numai administratorilor activi.', 403)
    case 'ADMIN_SESSION_INVALID':
      return failure('unauthorized', 'Sesiunea de administrator nu mai este activă. Autentifică-te din nou.', 401)
    case 'SELF_ACCOUNT_ACTION':
      return failure('conflict', 'Nu poți reseta propria parolă prin această acțiune.', 409)
    case 'TARGET_ACCOUNT_INELIGIBLE':
      return failure('conflict', 'Contul nu mai poate primi o resetare administrativă.', 409)
    case 'EXPECTED_EMAIL_MISMATCH':
      return failure('conflict', 'Adresa contului s-a schimbat. Reîncarcă pagina și încearcă din nou.', 409)
    case 'ATTEMPT_CONFLICT':
    case 'RESET_ATTEMPT_NOT_FOUND':
      return failure('conflict', 'Această încercare nu mai poate fi folosită. Reîncarcă pagina pentru a începe una nouă.', 409)
    default:
      return null
  }
}

async function finishDelivery(
  client: ServiceClient,
  targetId: string,
  attemptId: string,
  outcome: DeliveryStatus | null,
  reason: 'configuration' | 'provider_rejected' | 'provider_unconfirmed' | null,
  providerId: string | null,
) {
  try {
    const { data, error } = await callRpc(client, 'admin_reset_password_finish_delivery', {
      p_target_id: targetId,
      p_attempt_id: attemptId,
      p_outcome: outcome,
      p_reason: reason,
      p_provider_id: providerId,
    })
    if (error) return { status: outcome === null ? 'unknown' as const : outcome, audited: false, current: undefined }
    const result = rpcRecord(data)
    if (!result) return { status: outcome === null ? 'unknown' as const : outcome, audited: false, current: undefined }
    return {
      status: normalizedDeliveryStatus(result.delivery_status) ?? (outcome === null ? 'unknown' as const : outcome),
      audited: result.delivery_audited === true,
      current: typeof result.is_current === 'boolean' ? result.is_current : undefined,
    }
  } catch {
    return { status: outcome === null ? 'unknown' as const : outcome, audited: false, current: undefined }
  }
}

function completedMessage(status: DeliveryStatus, replayed: boolean, passwordAvailable: boolean, superseded: boolean) {
  let message: string
  if (replayed) {
    message = status === 'sent'
      ? 'Această resetare a fost finalizată anterior, iar furnizorul a acceptat emailul.'
      : status === 'failed'
        ? 'Această resetare a fost finalizată anterior, dar emailul nu a putut fi trimis. Parola nu poate fi afișată la verificarea unei încercări vechi.'
        : status === 'skipped'
          ? 'Această resetare a fost finalizată anterior, iar emailul a fost omis deoarece starea contului s-a schimbat.'
          : 'Resetarea a fost finalizată anterior. Starea trimiterii emailului nu a putut fi confirmată.'
  } else {
    message = status === 'sent'
      ? 'Resetarea este completă, iar furnizorul a acceptat emailul cu parola temporară.'
      : status === 'failed'
        ? passwordAvailable
          ? 'Resetarea este completă, dar emailul nu a putut fi trimis. Copiază parola temporară și comunic-o utilizatorului în siguranță.'
          : 'Resetarea este completă, dar emailul nu a putut fi trimis. Parola temporară nu poate fi afișată pentru această încercare.'
        : status === 'skipped'
          ? 'Resetarea este completă, dar emailul a fost omis deoarece contul sau adresa s-a schimbat.'
          : 'Resetarea este completă, dar trimiterea emailului nu a putut fi confirmată. Verificarea aceleiași încercări nu va trimite un email nou.'
  }
  if (superseded) message += ' Între timp, starea contului s-a schimbat.'
  return message
}

function completedResponse(
  attemptId: string,
  replayed: boolean,
  status: DeliveryStatus,
  options: {
    superseded?: boolean
    deliveryAuditPending?: boolean
    temporaryPassword?: string
  } = {},
) {
  const body: Record<string, unknown> = {
    status: 'completed',
    attemptId,
    replayed,
    deliveryStatus: status,
    ...(options.superseded ? { superseded: true } : {}),
    ...(options.deliveryAuditPending ? { deliveryAuditPending: true } : {}),
    message: completedMessage(status, replayed, Boolean(options.temporaryPassword), Boolean(options.superseded)),
    ...(options.temporaryPassword ? { temporaryPassword: options.temporaryPassword } : {}),
  }
  return response(body)
}

async function sendEmail(email: Extract<PreparedEmail, { kind: 'ready' }>, attemptId: string) {
  try {
    const providerResponse = await fetch(email.baseUrl + '/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + email.apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'admin-password-reset/' + attemptId,
      },
      body: JSON.stringify({
        from: email.from,
        to: email.to,
        subject: sanitizeHeaderText(email.email.subject),
        html: email.email.html,
        text: email.email.text,
      }),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    if (!providerResponse.ok) {
      const status = providerResponse.status
      return {
        outcome: status >= 400 && status < 500 && status !== 409 && status !== 429
          ? 'failed' as const
          : 'unknown' as const,
        reason: status >= 400 && status < 500 && status !== 409 && status !== 429
          ? 'provider_rejected' as const
          : 'provider_unconfirmed' as const,
        providerId: null,
      }
    }

    let providerResult: unknown = null
    try {
      providerResult = await providerResponse.json() as unknown
    } catch {
      providerResult = null
    }
    if (isObject(providerResult) && typeof providerResult.id === 'string' && isUuid(providerResult.id)) {
      return { outcome: 'sent' as const, reason: null, providerId: providerResult.id }
    }
    return { outcome: 'unknown' as const, reason: 'provider_unconfirmed' as const, providerId: null }
  } catch {
    return { outcome: 'unknown' as const, reason: 'provider_unconfirmed' as const, providerId: null }
  }
}

async function tryFallbackClaim(client: ServiceClient, input: ResetInput): Promise<boolean> {
  try {
    const { data, error } = await callRpc(client, 'admin_reset_password_claim_fallback', {
      p_actor_id: input.actorId,
      p_actor_session_id: input.actorSessionId,
      p_target_id: input.targetId,
      p_attempt_id: input.attemptId,
    })
    const result = rpcRecord(data)
    return !error && result?.allowed === true
  } catch {
    return false
  }
}

async function completeFreshReset(
  client: ServiceClient,
  input: ResetInput,
  reset: RpcRecord,
  password: string,
) {
  let superseded = reset.is_current === false
  const email = prepareEmail(reset, password)

  let prepared: RpcRecord | null = null
  let prepareFailed = false
  try {
    const result = await callRpc(client, 'admin_reset_password_prepare_delivery', {
      p_actor_id: input.actorId,
      p_actor_session_id: input.actorSessionId,
      p_target_id: input.targetId,
      p_attempt_id: input.attemptId,
    })
    if (result.error) prepareFailed = true
    else prepared = rpcRecord(result.data)
  } catch {
    prepareFailed = true
  }

  if (prepareFailed || !prepared) {
    const finished = await finishDelivery(client, input.targetId, input.attemptId, 'unknown', 'provider_unconfirmed', null)
    return completedResponse(input.attemptId, false, finished.status, {
      superseded: superseded || finished.current === false,
      deliveryAuditPending: !finished.audited,
    })
  }

  let outcome: DeliveryStatus
  let reason: 'configuration' | 'provider_rejected' | 'provider_unconfirmed' | null
  let providerId: string | null = null

  if (prepared.status === 'skipped') {
    outcome = 'skipped'
    reason = null
    superseded = superseded
      || prepared.reason === 'target_ineligible'
      || prepared.reason === 'recipient_changed'
      || prepared.reason === 'superseded'
  } else if (prepared.status !== 'send') {
    outcome = 'unknown'
    reason = 'provider_unconfirmed'
  } else if (email.kind === 'failed') {
    outcome = 'failed'
    reason = email.reason
  } else if (email.kind === 'skipped') {
    outcome = 'skipped'
    reason = null
  } else {
    const sent = await sendEmail(email, input.attemptId)
    outcome = sent.outcome
    reason = sent.reason
    providerId = sent.providerId
  }

  const finished = await finishDelivery(client, input.targetId, input.attemptId, outcome, reason, providerId)
  const status = finished.status
  superseded = superseded || finished.current === false
  let temporaryPassword: string | undefined
  if (outcome === 'failed' && status === 'failed' && !superseded) {
    if (await tryFallbackClaim(client, input)) temporaryPassword = password
  }

  return completedResponse(input.attemptId, false, status, {
    superseded,
    deliveryAuditPending: !finished.audited,
    temporaryPassword,
  })
}

export async function executeAdminPasswordReset(request: Request, input: ResetInput) {
  let password: string
  let client: ServiceClient
  let resetResult: Awaited<ReturnType<typeof callRpc>>
  const metadata = auditMetadata(request)
  try {
    password = generateTemporaryPassword()
    client = createSupabaseServiceClient()
    resetResult = await callRpc(client, 'admin_reset_password', {
      p_actor_id: input.actorId,
      p_actor_session_id: input.actorSessionId,
      p_target_id: input.targetId,
      p_attempt_id: input.attemptId,
      p_expected_email: input.expectedEmail,
      p_password: password,
      p_ip_address: metadata.ipAddress,
      p_user_agent: metadata.userAgent,
    })
  } catch {
    return retrySameAttempt()
  }

  if (resetResult.error) {
    return initialRpcFailure(resetResult.error)
      ?? failure('temporarily_unavailable', 'Resetarea nu a putut fi confirmată. Reîncearcă aceeași încercare pentru a verifica rezultatul.', 503)
  }

  const reset = rpcRecord(resetResult.data)
  if (!reset || reset.status !== 'completed' || typeof reset.replayed !== 'boolean'
    || !isUuid(reset.attempt_id) || reset.attempt_id.toLowerCase() !== input.attemptId.toLowerCase()) {
    return retrySameAttempt()
  }

  const replayed = reset.replayed
  let status = publicDeliveryStatus(reset.delivery_status)
  let superseded = reset.is_current === false
  let auditPending = reset.delivery_audited !== true

  if (replayed) {
    if (auditPending) {
      const repaired = await finishDelivery(client, input.targetId, input.attemptId, null, null, null)
      if (repaired.current === false) superseded = true
      status = repaired.status
      auditPending = !repaired.audited
    }
    return completedResponse(input.attemptId, true, status, {
      superseded,
      deliveryAuditPending: auditPending,
    })
  }

  try {
    return await completeFreshReset(client, input, reset, password)
  } catch {
    const finished = await finishDelivery(client, input.targetId, input.attemptId, 'unknown', 'provider_unconfirmed', null)
    return completedResponse(input.attemptId, false, finished.status, {
      superseded: reset.is_current === false || finished.current === false,
      deliveryAuditPending: !finished.audited,
    })
  }
}

export function resetBodyError() {
  return failure('invalid_request', 'Datele trimise nu sunt valide.', 400)
}

export function resetAuthError(status: number) {
  if (status === 401) {
    return failure('unauthorized', 'Autentificarea nu este validă sau a expirat.', 401)
  }
  if (status === 403) {
    return failure('forbidden', 'Acțiunea este disponibilă numai administratorilor.', 403)
  }
  return failure('temporarily_unavailable', 'Autentificarea nu este disponibilă momentan.', 503)
}

export function resetTargetError() {
  return failure('invalid_request', 'Identificatorul contului nu este valid.', 400)
}

export function resetSessionError() {
  return failure('unauthorized', 'Sesiunea nu este validă. Autentifică-te din nou.', 401)
}

export function isResetUuid(value: unknown): value is string {
  return isUuid(value)
}

export function isResetEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && isValidReminderEmail(value)
}
