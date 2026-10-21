import { test, expect, type Page, type Route } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readEnvFile, E2E_ENV_FILE } from '../e2e/helpers/project-state'
import { autentifica } from './helpers'

// Regresiile găsite la review-ul PR #124. Ruta de resetare e simulată, deci nicio parolă reală
// nu se schimbă; restul paginii (autentificare, lista de utilizatori) rulează pe stack-ul local.

const TARGET_EMAIL = 'ana.popescu@test.local'
const PASSWORD = 'PAROLA-TEMPORARA-DE-TEST'

function env(): Record<string, string> {
  const fromEnvironment = Object.entries(process.env).filter(([key, value]) => key.startsWith('E2E_') && value)
  return { ...readEnvFile(E2E_ENV_FILE), ...Object.fromEntries(fromEnvironment) as Record<string, string> }
}

async function json(route: Route, status: number, value: unknown) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
}

type ResetReply = { status: number; body: Record<string, unknown> }

/** Răspunde la POST-urile de resetare, în ordine, cu răspunsurile date. */
async function mockReset(page: Page, replies: ResetReply[]) {
  const seen: { attemptId: string }[] = []
  await page.route('**/api/users/*/reset-password', async (route) => {
    const body = route.request().postDataJSON() as { attemptId: string }
    seen.push(body)
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)]
    const payload = { ...reply.body }
    if (payload.attemptId === '$attempt') payload.attemptId = body.attemptId
    return json(route, reply.status, payload)
  })
  return seen
}

const FAILED_WITH_PASSWORD: ResetReply = {
  status: 200,
  body: {
    status: 'completed',
    attemptId: '$attempt',
    replayed: false,
    deliveryStatus: 'failed',
    deliveryAuditPending: true,
    message: 'Resetarea este completă, dar emailul nu a putut fi trimis. Copiază parola temporară și comunic-o utilizatorului în siguranță.',
    temporaryPassword: PASSWORD,
  },
}

async function openResetFromList(page: Page) {
  await autentifica(page, 'admin')
  await page.goto('/admin/users', { waitUntil: 'networkidle' })
  const row = page.locator('div.group').filter({ hasText: TARGET_EMAIL }).first()
  await row.getByRole('button', { name: 'Resetează parola' }).click()
  const dialog = page.getByRole('dialog', { name: 'Resetarea parolei' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Ce primește aplicația la un refresh de token: un TOKEN_REFRESHED cu o sesiune nouă, validă. */
async function simulateTokenRefresh(page: Page) {
  const values = env()
  const client = createClient(values.E2E_SUPABASE_URL, values.E2E_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: values.E2E_ADMIN_EMAIL,
    password: values.E2E_ADMIN_PASSWORD,
  })
  if (error || !data.session) throw new Error('Nu am putut obține o sesiune nouă pentru admin')
  await page.evaluate((session) => {
    const key = Object.keys(localStorage).find(name => /^sb-.*-auth-token$/.test(name))
    if (!key) throw new Error('Cheia sesiunii Supabase lipsește')
    new BroadcastChannel(key).postMessage({ event: 'TOKEN_REFRESHED', session })
  }, data.session)
}

test.describe('Dialogul de resetare a parolei', () => {
  test('„Verifică înregistrarea” nu șterge parola temporară încă necopiată', async ({ page }) => {
    const seen = await mockReset(page, [FAILED_WITH_PASSWORD, {
      status: 200,
      body: {
        status: 'completed',
        attemptId: '$attempt',
        replayed: true,
        deliveryStatus: 'failed',
        message: 'Această resetare a fost finalizată anterior, dar emailul nu a putut fi trimis.',
      },
    }])
    const dialog = await openResetFromList(page)
    await dialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    const password = dialog.getByLabel('Parolă temporară')
    await expect(password).toHaveValue(PASSWORD)

    await dialog.getByRole('button', { name: 'Verifică înregistrarea' }).click()
    await expect.poll(() => seen.length).toBe(2)
    expect(seen[1].attemptId).toBe(seen[0].attemptId)
    await expect(dialog.getByRole('button', { name: 'Verifică înregistrarea' })).toHaveCount(0)
    await expect(password).toHaveValue(PASSWORD)
  })

  for (const status of [500, 502, 504]) {
    test(`un ${status} după confirmare e rezultat necunoscut, nu „parola nu a fost schimbată”`, async ({ page }) => {
      await mockReset(page, [{ status, body: {} }])
      const dialog = await openResetFromList(page)
      await dialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
      await expect(dialog.getByText('Rezultatul resetării nu este confirmat', { exact: false })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Verifică rezultatul' })).toBeVisible()
      await expect(dialog.getByText('nu a fost schimbată', { exact: false })).toHaveCount(0)
    })
  }

  test('un 409 rămâne refuz sigur: parola nu a fost schimbată', async ({ page }) => {
    await mockReset(page, [{ status: 409, body: { code: 'conflict', error: 'x', message: 'Adresa contului s-a schimbat. Reîncarcă pagina și încearcă din nou.' } }])
    const dialog = await openResetFromList(page)
    await dialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(dialog.getByText('Serverul a refuzat resetarea; parola contului nu a fost schimbată.')).toBeVisible()
  })

  test('refresh-ul tokenului nu închide dialogul cu parola afișată (lista de utilizatori)', async ({ page }) => {
    await mockReset(page, [FAILED_WITH_PASSWORD])
    const dialog = await openResetFromList(page)
    await dialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(dialog.getByLabel('Parolă temporară')).toHaveValue(PASSWORD)

    const reloaded = page.waitForRequest(request => request.method() === 'GET' && /\/api\/users\?state=/.test(request.url()))
    await simulateTokenRefresh(page)
    await reloaded

    await page.waitForLoadState('networkidle')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Parolă temporară')).toHaveValue(PASSWORD)
  })

  test('refresh-ul tokenului nu închide dialogul cu parola afișată (pagina utilizatorului)', async ({ page }) => {
    await mockReset(page, [FAILED_WITH_PASSWORD])
    await autentifica(page, 'admin')
    await page.goto('/admin/users', { waitUntil: 'networkidle' })
    await page.locator('div.group').filter({ hasText: TARGET_EMAIL }).first()
      .getByRole('button', { name: new RegExp('^' + TARGET_EMAIL.replace(/[.]/g, '\\.')) }).click()
    await page.waitForURL(/\/admin\/users\/[0-9a-f-]{36}$/)
    await page.getByRole('button', { name: 'Resetează parola' }).click()
    const dialog = page.getByRole('dialog', { name: 'Resetarea parolei' })
    await dialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(dialog.getByLabel('Parolă temporară')).toHaveValue(PASSWORD)

    const reloaded = page.waitForRequest(request => request.method() === 'GET' && /\/api\/users$/.test(request.url()))
    await simulateTokenRefresh(page)
    await reloaded

    await page.waitForLoadState('networkidle')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Parolă temporară')).toHaveValue(PASSWORD)
  })
})
