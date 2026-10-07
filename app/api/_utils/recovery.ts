import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { requireProfile } from './auth'
import { redactAuditText } from './audit'
import { createSupabaseServerClient, createSupabaseServiceClient } from './supabase'
import { escapeHtml, resolveReminderDelivery, resendFromAddress, sanitizeHeaderText, isValidReminderEmail } from './email'

export const RECOVERY_REQUEST_MESSAGE = 'Dacă există un cont cu această adresă, vei primi un email cu instrucțiuni.'
export const RECOVERY_INVALID_MESSAGE = 'Linkul de resetare nu mai este valid. Solicită un link nou sau contactează administratorul.'
export const RECOVERY_FALLBACK_MESSAGE = 'Parola a fost schimbată. Autentifică-te cu noua parolă.'
export const RECOVERY_TEMPORARY_MESSAGE = 'Serviciul este temporar indisponibil. Încearcă din nou.'

const JSON_LIMIT = 4096
const RPC_TIMEOUT_MS = 5_000
const PROVIDER_TIMEOUT_MS = 10_000
const MAX_DRAIN_MS = 45_000
const MAX_JOB_BUDGET_MS = RPC_TIMEOUT_MS * 5 + PROVIDER_TIMEOUT_MS
const DELIVERY_LIMIT = 8
const RECEIPT_COOKIE_SECONDS = 24 * 60 * 60
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/
const TRUSTED_IP_HEADERS = new Set(['x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'])

type AppOrigin = { origin: string; secure: boolean }
type Config = AppOrigin & { secret: Buffer }
type JsonObject = Record<string, unknown>
type RpcResponse = { data: unknown; error: unknown }
type ServiceClient = ReturnType<typeof createSupabaseServiceClient>
type DeliveryOutcome = 'sent' | 'failed' | 'retry' | 'skipped'
type ParsedToken = { flowId: string; token: string }
type ProviderEmail = { recipient: string; to: string; from: string; subject: string; html: string; text: string }

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

function localLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function productionLike() {
  return process.env.NODE_ENV === 'production'
    || process.env.VERCEL_ENV === 'production'
    || process.env.VERCEL_ENV === 'preview'
}

function getAppOrigin(): AppOrigin | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    const secure = url.protocol === 'https:'
    if (!secure && !(url.protocol === 'http:' && localLoopback(url.hostname) && !productionLike())) return null
    return { origin: url.origin, secure }
  } catch {
    return null
  }
}

function getRecoverySecret(): Buffer | null {
  const raw = process.env.RECOVERY_SECRET
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) return null
  const secret = Buffer.from(raw, 'base64')
  return secret.length === 32 && secret.toString('base64') === raw ? secret : null
}

function getConfig(): Config | null {
  const app = getAppOrigin()
  const secret = getRecoverySecret()
  return app && secret ? { ...app, secret } : null
}

function getResendBaseUrl(): string | null {
  const configured = process.env.RESEND_BASE_URL
  if (configured === undefined) return 'https://api.resend.com'
  if (!configured || configured.trim() !== configured || productionLike()) return null
  try {
    const url = new URL(configured)
    if (url.protocol !== 'http:' || !localLoopback(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

function secureErrorCode(error: unknown): string | undefined {
  if (!isObject(error) || typeof error.code !== 'string') return undefined
  return /^[A-Z0-9_]+$/.test(error.code) ? error.code : undefined
}

function logFailure(event: string, error?: unknown) {
  const code = secureErrorCode(error)
  console.error('[recovery]', code ? { event, code } : { event })
}

function apiResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('Referrer-Policy', 'no-referrer')
  responseHeaders.set('X-Content-Type-Options', 'nosniff')
  return Response.json(body, { status, headers: responseHeaders })
}

function invalidResponse() {
  return apiResponse({ status: 'invalid', message: RECOVERY_INVALID_MESSAGE }, 400)
}

function unavailableResponse() {
  return apiResponse({ status: 'unavailable', message: RECOVERY_TEMPORARY_MESSAGE }, 503)
}

function originMatches(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin) return false
  const site = request.headers.get('sec-fetch-site')
  return site === null || site === 'same-origin'
}

function fetchMetadataAllowsRead(request: Request) {
  const site = request.headers.get('sec-fetch-site')
  return site === null || site === 'same-origin'
}

async function readJson(request: Request): Promise<{ ok: true; value: JsonObject } | { ok: false }> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return { ok: false }
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > JSON_LIMIT) return { ok: false }
  const reader = request.body?.getReader()
  if (!reader) return { ok: false }
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
        return { ok: false }
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
    return isObject(parsed) ? { ok: true, value: parsed } : { ok: false }
  } catch {
    return { ok: false }
  } finally {
    reader.releaseLock()
  }
}

function hasOnlyKeys(value: JsonObject, allowed: string[]) {
  return Object.keys(value).every(key => allowed.includes(key))
}

function encryptPayload(value: unknown, secret: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secret, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return 'v1.' + iv.toString('base64url') + '.' + cipher.getAuthTag().toString('base64url') + '.' + ciphertext.toString('base64url')
}

function decryptPayload(envelope: unknown, secret: Buffer): unknown | null {
  if (typeof envelope !== 'string') return null
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  const [ivPart, tagPart, ciphertextPart] = parts.slice(1)
  if (!/^[A-Za-z0-9_-]{16}$/.test(ivPart) || !/^[A-Za-z0-9_-]{22}$/.test(tagPart) || !/^[A-Za-z0-9_-]*$/.test(ciphertextPart)) return null
  try {
    const iv = Buffer.from(ivPart, 'base64url')
    const tag = Buffer.from(tagPart, 'base64url')
    const ciphertext = Buffer.from(ciphertextPart, 'base64url')
    if (iv.length !== 12 || tag.length !== 16
      || iv.toString('base64url') !== ivPart
      || tag.toString('base64url') !== tagPart
      || ciphertext.toString('base64url') !== ciphertextPart) return null
    const decipher = createDecipheriv('aes-256-gcm', secret, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return JSON.parse(plaintext) as unknown
  } catch {
    return null
  }
}

function makeToken(flowId: string) {
  return flowId + '.' + randomBytes(32).toString('base64url')
}

function parseToken(value: unknown): ParsedToken | null {
  if (typeof value !== 'string') return null
  const match = TOKEN_PATTERN.exec(value)
  if (!match) return null
  const bytes = Buffer.from(match[2], 'base64url')
  if (bytes.length !== 32 || bytes.toString('base64url') !== match[2]) return null
  return { flowId: match[1].toLowerCase(), token: value }
}

function tokenHash(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function recoveryCookieName(flowId: string) {
  return 'bonie-recovery-' + flowId
}

function proofCookie(request: Request, flowId: string): string | null {
  const name = recoveryCookieName(flowId)
  const values = (request.headers.get('cookie') ?? '').split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(name + '='))
  if (values.length !== 1) return null
  const token = values[0].slice(name.length + 1)
  const parsed = parseToken(token)
  return parsed?.flowId === flowId ? token : null
}

function cookieHeader(flowId: string, token: string, secure: boolean) {
  return recoveryCookieName(flowId) + '=' + token
    + '; Path=/api/auth/recovery; Max-Age=' + RECEIPT_COOKIE_SECONDS
    + '; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '')
}

// Configure this header only when the deployment edge overwrites it.
function readTrustedIp(request: Request): string | null {
  const configured = process.env.RECOVERY_TRUSTED_IP_HEADER?.trim().toLowerCase()
  const header = configured || (process.env.VERCEL === '1' ? 'x-vercel-forwarded-for' : '')
  if (!TRUSTED_IP_HEADERS.has(header)) return null
  const raw = request.headers.get(header)
  if (!raw) return null
  const candidate = (header.endsWith('forwarded-for') ? raw.split(',')[0] : raw).trim()
  return isIP(candidate) ? candidate : null
}

function safeUserAgent(request: Request): string | null {
  const value = request.headers.get('user-agent')
  return value ? redactAuditText(value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256)) || null : null
}

function ipHash(ip: string | null, secret: Buffer) {
  const key = createHmac('sha256', secret).update('platforma-fonduri/recovery/ip-hash/v1').digest()
  return createHmac('sha256', key).update(ip ?? 'unknown').digest('hex')
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= 254 && isValidReminderEmail(value)
}

async function callRpc(client: ServiceClient, functionName: string, args: Record<string, unknown>): Promise<RpcResponse> {
  const result = await client.rpc(functionName, args).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
  return { data: result.data as unknown, error: result.error }
}

function validInspection(value: unknown, flowId: string): value is JsonObject & { status: 'valid'; flow_id: string; expires_at: string } {
  return isObject(value)
    && value.status === 'valid'
    && normalizedUuid(value.flow_id) === flowId
    && typeof value.expires_at === 'string'
    && Number.isFinite(Date.parse(value.expires_at))
}

export async function enqueueRecoveryRequest(request: Request): Promise<{ response: Response; shouldDrain: boolean }> {
  const app = getAppOrigin()
  if (!app) {
    logFailure('origin_config')
    return { response: unavailableResponse(), shouldDrain: false }
  }
  if (!originMatches(request, app.origin)) return { response: apiResponse({ error: 'Forbidden' }, 403), shouldDrain: false }
  const parsed = await readJson(request)
  if (!parsed.ok || !hasOnlyKeys(parsed.value, ['email']) || !validEmail(parsed.value.email)) {
    return { response: apiResponse({ error: 'Adresa de email nu este validă.' }, 400), shouldDrain: false }
  }
  const secret = getRecoverySecret()
  if (!secret) {
    logFailure('secret_config')
    return { response: apiResponse({ message: RECOVERY_REQUEST_MESSAGE }), shouldDrain: false }
  }
  const email = (parsed.value.email as string).trim()
  const jobId = randomUUID()
  const token = makeToken(jobId)
  try {
    const admin = createSupabaseServiceClient()
    const remoteIp = readTrustedIp(request)
    const result = await callRpc(admin, 'recovery_enqueue', {
      p_job_id: jobId,
      p_payload_cipher: encryptPayload({ email, token }, secret),
      p_ip_hash: ipHash(remoteIp, secret),
      p_ip: remoteIp,
      p_user_agent: safeUserAgent(request),
    })
    if (result.error) {
      logFailure('enqueue_failed', result.error)
      return { response: apiResponse({ message: RECOVERY_REQUEST_MESSAGE }), shouldDrain: false }
    }
    return { response: apiResponse({ message: RECOVERY_REQUEST_MESSAGE }), shouldDrain: result.data === true }
  } catch (error) {
    logFailure('enqueue_exception', error)
    return { response: apiResponse({ message: RECOVERY_REQUEST_MESSAGE }), shouldDrain: false }
  }
}

export async function exchangeRecoveryToken(request: Request): Promise<Response> {
  const config = getConfig()
  if (!config) {
    logFailure('exchange_config')
    return unavailableResponse()
  }
  if (!originMatches(request, config.origin)) return apiResponse({ error: 'Forbidden' }, 403)
  const parsed = await readJson(request)
  if (!parsed.ok || !hasOnlyKeys(parsed.value, ['token'])) return invalidResponse()
  const proof = parseToken(parsed.value.token)
  if (!proof) return invalidResponse()
  try {
    const result = await callRpc(createSupabaseServiceClient(), 'recovery_inspect', {
      p_flow_id: proof.flowId,
      p_token_hash: tokenHash(proof.token),
    })
    if (result.error) {
      logFailure('exchange_rpc', result.error)
      return unavailableResponse()
    }
    if (!validInspection(result.data, proof.flowId)) return invalidResponse()
    return apiResponse(
      { status: 'valid', flowId: proof.flowId, expiresAt: result.data.expires_at },
      200,
      { 'Set-Cookie': cookieHeader(proof.flowId, proof.token, config.secure) },
    )
  } catch (error) {
    logFailure('exchange_exception', error)
    return unavailableResponse()
  }
}

function queryValue(request: Request, name: string): string | null {
  const values = new URL(request.url).searchParams.getAll(name)
  return values.length === 1 ? values[0] : null
}

export async function recoveryStatus(request: Request): Promise<Response> {
  const config = getConfig()
  if (!config) {
    logFailure('status_config')
    return unavailableResponse()
  }
  if (!fetchMetadataAllowsRead(request)) return invalidResponse()
  const flowId = normalizedUuid(queryValue(request, 'flowId'))
  const attemptId = normalizedUuid(queryValue(request, 'attemptId'))
  if (!flowId || !attemptId) return invalidResponse()
  const token = proofCookie(request, flowId)
  if (!token) return invalidResponse()
  try {
    const result = await callRpc(createSupabaseServiceClient(), 'recovery_inspect', {
      p_flow_id: flowId,
      p_token_hash: tokenHash(token),
      p_attempt_id: attemptId,
    })
    if (result.error) {
      logFailure('status_rpc', result.error)
      return unavailableResponse()
    }
    if (isObject(result.data) && result.data.status === 'completed') {
      return apiResponse({ status: 'completed', message: RECOVERY_FALLBACK_MESSAGE })
    }
    if (validInspection(result.data, flowId)) {
      return apiResponse({ status: 'valid', flowId, expiresAt: result.data.expires_at })
    }
    return invalidResponse()
  } catch (error) {
    logFailure('status_exception', error)
    return unavailableResponse()
  }
}

function validPasswordText(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

function passwordValidation(password: unknown, confirmation: unknown): string | null {
  if (typeof password !== 'string' || typeof confirmation !== 'string' || password !== confirmation) {
    return 'Parolele nu coincid.'
  }
  if (!validPasswordText(password) || [...password].length < 6 || Buffer.byteLength(password, 'utf8') > 72 || password.includes('\0')) {
    return 'Parola trebuie să aibă cel puțin 6 caractere și cel mult 72 de octeți UTF-8.'
  }
  return null
}

async function createVerifiedSession(
  origin: string,
  expectedUserId: string,
  email: string,
  password: string,
): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const anonymous = createSupabaseServerClient(new Request(origin + '/api/auth/recovery/complete'))
    const { data, error } = await anonymous.auth.signInWithPassword({ email, password })
    const session = data?.session
    if (error || !session?.access_token || !session.refresh_token || data.user?.id !== expectedUserId) return null
    const authRequest = new Request(origin + '/api/auth/recovery/complete', {
      headers: { Authorization: 'Bearer ' + session.access_token },
    })
    const profile = await requireProfile(authRequest)
    return profile.ok && profile.user.id === expectedUserId && profile.profile.id === expectedUserId
      ? { access_token: session.access_token, refresh_token: session.refresh_token }
      : null
  } catch {
    return null
  }
}

export async function completeRecovery(request: Request): Promise<Response> {
  const config = getConfig()
  if (!config) {
    logFailure('complete_config')
    return unavailableResponse()
  }
  if (!originMatches(request, config.origin)) return apiResponse({ error: 'Forbidden' }, 403)
  const parsed = await readJson(request)
  if (!parsed.ok || !hasOnlyKeys(parsed.value, ['flowId', 'attemptId', 'password', 'confirmation'])) return invalidResponse()
  const flowId = normalizedUuid(parsed.value.flowId)
  const attemptId = normalizedUuid(parsed.value.attemptId)
  if (!flowId || !attemptId) return invalidResponse()
  const token = proofCookie(request, flowId)
  if (!token) return invalidResponse()
  const passwordError = passwordValidation(parsed.value.password, parsed.value.confirmation)
  if (passwordError) return apiResponse({ status: 'password_invalid', message: passwordError }, 400)
  const password = parsed.value.password as string
  try {
    const remoteIp = readTrustedIp(request)
    const result = await callRpc(createSupabaseServiceClient(), 'recovery_complete', {
      p_flow_id: flowId,
      p_token_hash: tokenHash(token),
      p_attempt_id: attemptId,
      p_password: password,
      p_ip: remoteIp,
      p_user_agent: safeUserAgent(request),
    })
    if (result.error) {
      logFailure('complete_rpc', result.error)
      return unavailableResponse()
    }
    if (!isObject(result.data)) return unavailableResponse()
    if (result.data.status === 'receipt') return apiResponse({ status: 'completed', message: RECOVERY_FALLBACK_MESSAGE })
    if (result.data.status === 'invalid') return invalidResponse()
    if (result.data.status === 'password_invalid') {
      return apiResponse({
        status: 'password_invalid',
        message: 'Parola trebuie să aibă cel puțin 6 caractere și cel mult 72 de octeți UTF-8.',
      }, 400)
    }
    if (result.data.status === 'same_password') {
      return apiResponse({ status: 'same_password', message: 'Alege o parolă diferită de cea actuală.' }, 400)
    }
    if (result.data.status !== 'completed') return unavailableResponse()
    const userId = normalizedUuid(result.data.user_id)
    const email = validEmail(result.data.email) ? result.data.email.trim() : null
    if (!userId || !email) {
      logFailure('complete_result')
      return apiResponse({ status: 'completed', message: RECOVERY_FALLBACK_MESSAGE })
    }
    const session = await createVerifiedSession(config.origin, userId, email, password)
    return session
      ? apiResponse({ status: 'completed', session, userId })
      : apiResponse({ status: 'completed', message: RECOVERY_FALLBACK_MESSAGE })
  } catch (error) {
    logFailure('complete_exception', error)
    return unavailableResponse()
  }
}

function requestEmail(token: string, origin: string, recipient: string): ProviderEmail | null {
  const delivery = resolveReminderDelivery(recipient)
  if (!delivery.ok || (productionLike() && !process.env.RESEND_FROM_EMAIL?.trim())) return null
  const link = new URL('/reset-password', origin)
  link.hash = 'token=' + encodeURIComponent(token)
  const href = link.toString()
  const text = [
    'Am primit o solicitare de resetare a parolei pentru contul tău.',
    '',
    'Deschide linkul pentru a alege o parolă nouă: ' + href,
    '',
    'Linkul este valabil o oră și poate fi folosit o singură dată.',
    'Dacă nu ai solicitat resetarea, poți ignora acest mesaj.',
  ].join('\n')
  const html = '<!doctype html><html lang="ro"><meta charset="utf-8"><body>'
    + '<h1>Resetarea parolei</h1>'
    + '<p>Am primit o solicitare de resetare a parolei pentru contul tău.</p>'
    + '<p><a href="' + escapeHtml(href) + '">Alege o parolă nouă</a></p>'
    + '<p>Linkul este valabil o oră și poate fi folosit o singură dată.</p>'
    + '<p>Dacă nu ai solicitat resetarea, poți ignora acest mesaj.</p>'
    + '</body></html>'
  return {
    recipient: delivery.data.intendedEmail,
    to: delivery.data.deliveryEmail,
    from: sanitizeHeaderText(resendFromAddress()),
    subject: sanitizeHeaderText('Resetarea parolei — Platforma Fonduri EU'),
    html,
    text,
  }
}

function confirmationEmail(recipient: string): ProviderEmail | null {
  const delivery = resolveReminderDelivery(recipient)
  if (!delivery.ok || (productionLike() && !process.env.RESEND_FROM_EMAIL?.trim())) return null
  const text = 'Parola ta a fost schimbată. Dacă nu ai fost tu, contactează-ne.'
  const html = '<!doctype html><html lang="ro"><meta charset="utf-8"><body>'
    + '<p>Parola ta a fost schimbată. Dacă nu ai fost tu, contactează-ne.</p>'
    + '</body></html>'
  return {
    recipient: delivery.data.intendedEmail,
    to: delivery.data.deliveryEmail,
    from: sanitizeHeaderText(resendFromAddress()),
    subject: sanitizeHeaderText('Parola ta a fost schimbată — Platforma Fonduri EU'),
    html,
    text,
  }
}

function parseProviderEmail(value: unknown): ProviderEmail | null {
  if (!isObject(value) || !validEmail(value.recipient) || !validEmail(value.to)
    || typeof value.from !== 'string' || !value.from.trim()
    || typeof value.subject !== 'string' || typeof value.html !== 'string' || typeof value.text !== 'string') return null
  return {
    recipient: value.recipient.trim(),
    to: value.to.trim(),
    from: value.from,
    subject: value.subject,
    html: value.html,
    text: value.text,
  }
}


function providerOutcome(status: number): DeliveryOutcome {
  return status >= 400 && status < 500 && status !== 409 && status !== 429 ? 'failed' : 'retry'
}

async function finishDelivery(
  client: ServiceClient,
  jobId: string,
  leaseId: string,
  outcome: DeliveryOutcome,
  providerId: string | null = null,
) {
  try {
    const result = await callRpc(client, 'recovery_finish_delivery', {
      p_job_id: jobId,
      p_lease_id: leaseId,
      p_outcome: outcome,
      p_provider_id: providerId,
    })
    if (result.error) logFailure('finish_rpc', result.error)
  } catch (error) {
    logFailure('finish_exception', error)
  }
}

async function freezeProviderEmail(
  client: ServiceClient,
  jobId: string,
  leaseId: string,
  body: ProviderEmail,
  secret: Buffer,
): Promise<ProviderEmail | null> {
  const result = await callRpc(client, 'recovery_freeze_delivery', {
    p_job_id: jobId,
    p_lease_id: leaseId,
    p_payload_cipher: encryptPayload(body, secret),
  })
  if (result.error) {
    logFailure('freeze_rpc', result.error)
    return null
  }
  return isObject(result.data) && typeof result.data.payload_cipher === 'string'
    ? parseProviderEmail(decryptPayload(result.data.payload_cipher, secret))
    : null
}

async function processDelivery(client: ServiceClient, job: JsonObject, config: Config) {
  const jobId = normalizedUuid(job.id)
  const leaseId = normalizedUuid(job.lease_id)
  if (!jobId || !leaseId) return
  let outcome: DeliveryOutcome = 'retry'
  let providerId: string | null = null
  try {
    const kind = String(job.kind)
    const flowId = normalizedUuid(job.flow_id) ?? (kind === 'request' ? jobId : null)
    if (!['request', 'confirmation'].includes(kind) || !flowId || (kind === 'request' && flowId !== jobId)) {
      outcome = 'skipped'
      return
    }
    const resendApiKey = process.env.RESEND_API_KEY?.trim()
    const resendBaseUrl = getResendBaseUrl()
    if (!resendApiKey || !resendBaseUrl) {
      logFailure('provider_config')
      outcome = 'failed'
      return
    }
    let body = parseProviderEmail(decryptPayload(job.frozen_payload_cipher, config.secret))
    if (!body) {
      if (job.frozen_payload_cipher !== null && job.frozen_payload_cipher !== undefined) {
        logFailure('frozen_payload_invalid')
        outcome = 'failed'
        return
      }
      if (job.kind === 'request') {
        const initial = decryptPayload(job.payload_cipher, config.secret)
        if (!isObject(initial) || !validEmail(initial.email)) {
          logFailure('request_payload_invalid')
          outcome = 'failed'
          return
        }
        const token = parseToken(initial.token)
        if (!token || token.flowId !== jobId) {
          logFailure('request_token_invalid')
          outcome = 'failed'
          return
        }
        const prepared = await callRpc(client, 'recovery_prepare_delivery', {
          p_job_id: jobId,
          p_lease_id: leaseId,
          p_email: initial.email.trim(),
          p_token_hash: tokenHash(token.token),
        })
        if (prepared.error) {
          logFailure('prepare_rpc', prepared.error)
          outcome = 'retry'
          return
        }
        if (!isObject(prepared.data) || prepared.data.status !== 'send') {
          outcome = 'skipped'
          return
        }
        if (normalizedUuid(prepared.data.flow_id) !== jobId || !validEmail(prepared.data.recipient)) {
          logFailure('prepare_result_invalid')
          outcome = 'failed'
          return
        }
        body = requestEmail(token.token, config.origin, prepared.data.recipient.trim()) ?? null
      } else {
        if (!validEmail(job.recipient)) {
          outcome = 'skipped'
          return
        }
        body = confirmationEmail(job.recipient.trim()) ?? null
      }
      if (!body) {
        logFailure('email_configuration')
        outcome = 'failed'
        return
      }
      body = await freezeProviderEmail(client, jobId, leaseId, body, config.secret)
      if (!body) {
        outcome = 'retry'
        return
      }
    }

    const ready = await callRpc(client, 'recovery_delivery_ready', {
      p_job_id: jobId,
      p_lease_id: leaseId,
    })
    if (ready.error) {
      logFailure('ready_rpc', ready.error)
      outcome = 'retry'
      return
    }
    if (!isObject(ready.data) || ready.data.status !== 'send'
      || normalizedUuid(ready.data.flow_id) !== flowId
      || ready.data.recipient !== body.recipient) {
      outcome = 'skipped'
      return
    }

    const providerResponse = await fetch(resendBaseUrl + '/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + resendApiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'recovery/' + jobId,
      },
      body: JSON.stringify({
        from: body.from,
        to: body.to,
        subject: body.subject,
        html: body.html,
        text: body.text,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    if (!providerResponse.ok) {
      outcome = providerOutcome(providerResponse.status)
      logFailure('provider_response', { code: 'HTTP_' + providerResponse.status })
      return
    }
    let providerResult: unknown = null
    try {
      providerResult = await providerResponse.json() as unknown
    } catch {
      providerResult = null
    }
    if (isObject(providerResult) && typeof providerResult.id === 'string'
      && providerResult.id.trim().length > 0 && providerResult.id.length <= 200) {
      outcome = 'sent'
      providerId = providerResult.id.trim()
    } else {
      outcome = 'retry'
      logFailure('provider_response_missing_id')
    }
  } catch (error) {
    logFailure('delivery_exception', error)
    outcome = 'retry'
  } finally {
    await finishDelivery(client, jobId, leaseId, outcome, providerId)
  }
}

export async function drainRecoveryDeliveries(limit = DELIVERY_LIMIT): Promise<number> {
  const config = getConfig()
  if (!config) {
    logFailure('drain_config')
    return 0
  }
  let client: ServiceClient
  try {
    client = createSupabaseServiceClient()
  } catch (error) {
    logFailure('drain_client', error)
    return 0
  }
  let processed = 0
  const startedAt = Date.now()
  for (let count = 0; count < Math.min(limit, DELIVERY_LIMIT); count += 1) {
    if (Date.now() - startedAt + MAX_JOB_BUDGET_MS > MAX_DRAIN_MS) break
    const leaseId = randomUUID()
    let claimed: RpcResponse
    try {
      claimed = await callRpc(client, 'recovery_take_delivery', { p_lease_id: leaseId })
    } catch (error) {
      logFailure('take_exception', error)
      break
    }
    if (claimed.error) {
      logFailure('take_rpc', claimed.error)
      break
    }
    if (claimed.data === null) break
    if (!isObject(claimed.data)) {
      logFailure('take_result_invalid')
      break
    }
    processed += 1
    await processDelivery(client, { ...claimed.data, lease_id: claimed.data.lease_id ?? leaseId }, config)
  }
  return processed
}

export async function dispatchRecovery(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')
  const providedBytes = Buffer.from(match?.[1] ?? '')
  const expectedBytes = Buffer.from(cronSecret ?? '')
  const authorized = expectedBytes.length > 0
    && expectedBytes.length === providedBytes.length
    && timingSafeEqual(expectedBytes, providedBytes)
  if (!authorized) return apiResponse({ error: 'Unauthorized' }, 401)
  if (!getConfig()) {
    logFailure('dispatch_config')
    return unavailableResponse()
  }
  return apiResponse({ processed: await drainRecoveryDeliveries() })
}
