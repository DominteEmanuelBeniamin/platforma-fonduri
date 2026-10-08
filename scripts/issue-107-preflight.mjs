import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const checks = Object.fromEntries([
  'arguments', 'envFile', 'appOrigin', 'supabaseUrlsMatch', 'anonKeyPresent', 'serviceKeyPresent',
  'sdkVersion', 'authHealth', 'authVersion', 'authSettings', 'settingsSignupDisabled', 'settingsEmailProviderEnabled',
  'settingsProvidersDisabled', 'authConfigAvailable', 'authDbRole', 'minimumPasswordLength',
  'passwordRequirements', 'dbEncryptionDisabled', 'otpExpiry', 'authSignupDisabled',
  'sendEmailHook', 'alternativeProvidersDisabled', 'recoverySecret', 'cronSecret',
  'resendApiKey', 'resendSender', 'resendLinkTrackingDisabled', 'reminderOverride',
  'dispatchCron', 'recoveryPreflight', 'recoveryEnabled',
].map((name) => [name, false]))

function parseArgs(args) {
  const result = { envFile: null, authConfig: null, help: false }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      result.help = true
      continue
    }
    const [name, inline] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, null]
    if (name !== '--env-file' && name !== '--auth-config') return null
    const value = inline ?? args[++i]
    if (!value || value.startsWith('--')) return null
    const key = name === '--env-file' ? 'envFile' : 'authConfig'
    if (result[key]) return null
    result[key] = value
  }
  return result
}

function parseEnv(source) {
  const values = Object.create(null)
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const assignment = line.startsWith('export ') ? line.slice(7).trim() : line
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(assignment)
    if (!match) {
      if (assignment.includes('=')) throw new Error('invalid env')
      continue
    }
    let value = match[2].trim()
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]
      if (value.at(-1) !== quote) throw new Error('invalid env')
      value = value.slice(1, -1)
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    values[match[1]] = value
  }
  return values
}

function parseJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  } catch {
    return null
  }
}

function strictOrigin(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    if (value !== url.origin && value !== `${url.origin}/`) return null
    return url
  } catch {
    return null
  }
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function environmentKind(env, appUrl) {
  const vercel = (env.VERCEL_ENV ?? '').trim().toLowerCase()
  const node = (env.NODE_ENV ?? '').trim().toLowerCase()
  if (vercel && !['production', 'preview', 'development'].includes(vercel)) return null
  if (appUrl?.protocol === 'https:') {
    if (vercel === 'preview' || vercel === 'production') return vercel
    if (!vercel && node === 'production') return 'production'
    return null
  }
  if (appUrl?.protocol === 'http:' && isLoopback(appUrl.hostname)) {
    if (vercel === 'preview' || vercel === 'production' || node === 'production') return null
    if (!vercel || vercel === 'development') return 'development'
  }
  return null
}

async function fetchJson(url, key) {
  try {
    const response = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function providersDisabled(settings) {
  const providers = settings?.external
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return false
  const alternative = Object.entries(providers).filter(([name]) => name.toLowerCase() !== 'email')
  return alternative.length > 0 && alternative.every(([, enabled]) => enabled === false)
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false
  return null
}

function parseAuthDatabaseRole(value) {
  try {
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) return null
    return decodeURIComponent(url.username)
  } catch {
    return null
  }
}

function readLocalAuthConfig() {
  try {
    // Only consume Auth settings from the container; diagnostics and raw env are never emitted.
    const raw = execFileSync('docker', [
      'inspect', '--format', '{{json .Config.Env}}', 'supabase_auth_platforma-fonduri',
    ], { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    const entries = JSON.parse(raw)
    if (!Array.isArray(entries)) return null
    const safeNames = new Set([
      'GOTRUE_PASSWORD_MIN_LENGTH', 'GOTRUE_PASSWORD_REQUIRED_CHARACTERS',
      'GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT', 'GOTRUE_MAILER_OTP_EXP',
      'GOTRUE_DISABLE_SIGNUP', 'GOTRUE_HOOK_SEND_EMAIL_ENABLED',
      'GOTRUE_HOOK_SEND_EMAIL_URI',
    ])
    const safe = Object.create(null)
    const providerFlags = []
    let databaseRole = null
    for (const entry of entries) {
      if (typeof entry !== 'string') continue
      const split = entry.indexOf('=')
      if (split < 0) continue
      const name = entry.slice(0, split)
      const value = entry.slice(split + 1)
      if (safeNames.has(name)) safe[name] = value
      else if (name === 'GOTRUE_DB_DATABASE_URL') databaseRole = parseAuthDatabaseRole(value)
      else if (/^GOTRUE_(?:EXTERNAL|THIRD_PARTY)_.*_ENABLED$/.test(name) && name !== 'GOTRUE_EXTERNAL_EMAIL_ENABLED') {
        providerFlags.push(value.toLowerCase())
      }
    }
    const encryption = safe.GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT === undefined
      ? false
      : parseBoolean(safe.GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT)
    return {
      minimumPasswordLength: Number(safe.GOTRUE_PASSWORD_MIN_LENGTH),
      passwordRequirements: safe.GOTRUE_PASSWORD_REQUIRED_CHARACTERS ?? '',
      dbEncryptionEnabled: encryption,
      otpExpiry: Number(safe.GOTRUE_MAILER_OTP_EXP),
      disableSignup: parseBoolean(safe.GOTRUE_DISABLE_SIGNUP),
      sendEmailHookEnabled: parseBoolean(safe.GOTRUE_HOOK_SEND_EMAIL_ENABLED),
      sendEmailHookUri: safe.GOTRUE_HOOK_SEND_EMAIL_URI,
      databaseRole,
      alternativeProvidersDisabled: providerFlags.every((value) => value === 'false'),
    }
  } catch {
    return null
  }
}

function authConfigOk(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false
  checks.authConfigAvailable = true
  checks.minimumPasswordLength = config.minimumPasswordLength === 6
  checks.passwordRequirements = config.passwordRequirements === ''
  checks.dbEncryptionDisabled = config.dbEncryptionEnabled === false
  checks.otpExpiry = config.otpExpiry === 3600
  checks.authSignupDisabled = config.disableSignup === true
  checks.sendEmailHook = config.sendEmailHookEnabled === true
    && config.sendEmailHookUri === 'pg-functions://postgres/account_recovery/send_email_hook'
  checks.alternativeProvidersDisabled = config.alternativeProvidersDisabled === true
  checks.authDbRole = config.databaseRole === 'supabase_auth_admin'
  return true
}

function recoverySecretValid(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) return false
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 && decoded.toString('base64') === value
}

function setStatus(name, value) {
  checks[name] = value === true
}

function print(status) {
  console.log(JSON.stringify({ status, checks }, null, 2))
  if (status === 'blocked') process.exitCode = 1
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args?.help) {
    console.log('Usage: node scripts/issue-107-preflight.mjs --env-file <path> [--auth-config <trusted-nonsecret-json>]')
    return
  }
  if (!args?.envFile) {
    print('blocked')
    return
  }
  setStatus('arguments', true)

  let env
  try {
    env = parseEnv(fs.readFileSync(path.resolve(args.envFile), 'utf8'))
    checks.envFile = true
  } catch {
    print('blocked')
    return
  }

  const appOrigin = strictOrigin(env.NEXT_PUBLIC_APP_URL)
  const kind = environmentKind(env, appOrigin)
  checks.appOrigin = !!appOrigin && !!kind
    && ((kind === 'development' && appOrigin.protocol === 'http:' && isLoopback(appOrigin.hostname))
      || ((kind === 'preview' || kind === 'production') && appOrigin.protocol === 'https:'))

  const publicSupabaseUrl = strictOrigin(env.NEXT_PUBLIC_SUPABASE_URL)
  const serverSupabaseUrl = strictOrigin(env.SUPABASE_URL)
  checks.supabaseUrlsMatch = !!publicSupabaseUrl && !!serverSupabaseUrl
    && env.NEXT_PUBLIC_SUPABASE_URL === env.SUPABASE_URL
    && (kind === 'development'
      ? publicSupabaseUrl.protocol === 'http:' && isLoopback(publicSupabaseUrl.hostname)
      : (kind === 'preview' || kind === 'production') && publicSupabaseUrl.protocol === 'https:')
  checks.anonKeyPresent = typeof env.NEXT_PUBLIC_SUPABASE_ANON_KEY === 'string' && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim()
  checks.serviceKeyPresent = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' && !!env.SUPABASE_SERVICE_ROLE_KEY.trim()

  try {
    const sdk = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@supabase/supabase-js/package.json'), 'utf8'))
    checks.sdkVersion = sdk.version === '2.90.0'
  } catch {
    checks.sdkVersion = false
  }

  checks.recoverySecret = recoverySecretValid(env.RECOVERY_SECRET)
  checks.cronSecret = typeof env.CRON_SECRET === 'string' && !!env.CRON_SECRET.trim()
  checks.resendApiKey = typeof env.RESEND_API_KEY === 'string' && !!env.RESEND_API_KEY.trim()
  checks.resendSender = typeof env.RESEND_FROM_EMAIL === 'string'
    && !!env.RESEND_FROM_EMAIL.trim()
    && !/[\r\n]/.test(env.RESEND_FROM_EMAIL)
  const override = (env.REMINDER_EMAIL_OVERRIDE_TO ?? '').trim()
  const validOverride = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(override)
  checks.reminderOverride = kind === 'production'
    ? override === ''
    : (kind === 'development' || kind === 'preview') && validOverride

  const trackingAttested = env.RESEND_LINK_TRACKING_DISABLED === 'true'
  let trustedAuthConfig = null
  if (args.authConfig) {
    trustedAuthConfig = parseJsonFile(args.authConfig)
  } else if (kind === 'development') {
    trustedAuthConfig = readLocalAuthConfig()
  }
  authConfigOk(trustedAuthConfig)
  checks.resendLinkTrackingDisabled = trustedAuthConfig?.resendLinkTrackingDisabled === true || trackingAttested
  if ((kind === 'preview' || kind === 'production') && !args.authConfig) {
    checks.authConfigAvailable = false
    checks.resendLinkTrackingDisabled = false
  }

  checks.dispatchCron = env.RECOVERY_DISPATCH_EVERY_MINUTE_CONFIGURED === 'true'

  const safeToContact = checks.supabaseUrlsMatch && checks.anonKeyPresent && appOrigin
  if (safeToContact) {
    const base = publicSupabaseUrl.origin
    const [health, settings] = await Promise.all([
      fetchJson(new URL('/auth/v1/health', base), env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      fetchJson(new URL('/auth/v1/settings', base), env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    ])
    checks.authHealth = !!health && typeof health === 'object'
    checks.authVersion = health?.version === 'v2.197.0'
    checks.authSettings = !!settings && typeof settings === 'object' && !Array.isArray(settings)
    checks.settingsSignupDisabled = settings?.disable_signup === true
    checks.settingsProvidersDisabled = providersDisabled(settings)
    checks.settingsEmailProviderEnabled = settings?.external?.email === true
  }

  if (safeToContact && checks.serviceKeyPresent) {
    try {
      const response = await fetch(new URL('/rest/v1/rpc/recovery_preflight', publicSupabaseUrl.origin), {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        const body = await response.json()
        checks.recoveryPreflight = !!body && typeof body === 'object' && !Array.isArray(body)
          && body.compatible === true && typeof body.enabled === 'boolean'
        checks.recoveryEnabled = checks.recoveryPreflight && body.enabled === true
      }
    } catch {
      checks.recoveryPreflight = false
    }
  }

  const required = Object.entries(checks).filter(([name]) => name !== 'recoveryEnabled')
  if (required.some(([, value]) => value !== true)) {
    print('blocked')
  } else {
    print(checks.recoveryEnabled ? 'already_enabled' : 'ready')
  }
}

await main().catch(() => {
  console.log(JSON.stringify({ status: 'blocked', checks: { execution: false } }))
  process.exitCode = 1
})