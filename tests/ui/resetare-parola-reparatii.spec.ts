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

async function openResetFromList(page: Page, authenticate = true) {
  if (authenticate) await autentifica(page, 'admin')
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
  test('confirmarea rămâne dezactivată două secunde la fiecare deschidere', async ({ page }) => {
    const seen = await mockReset(page, [FAILED_WITH_PASSWORD])
    const dialog = await openResetFromList(page)
    const confirm = dialog.getByRole('button', { name: 'Confirmă resetarea' })
    await expect(confirm).toBeDisabled()
    await page.waitForTimeout(1200)
    await expect(confirm).toBeDisabled()
    expect(seen).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Anulează' }).click()

    await page.locator('div.group').filter({ hasText: TARGET_EMAIL }).first()
      .getByRole('button', { name: 'Resetează parola' }).click()
    await expect(confirm).toBeDisabled()
    await page.waitForTimeout(1000)
    await expect(confirm).toBeDisabled()
    await expect(confirm).toBeEnabled()
    expect(seen).toHaveLength(0)
  })

  test('o confirmare veche din altă filă nu pornește o a doua resetare după terminarea primei', async ({ page, context }) => {
    const firstSeen = await mockReset(page, [FAILED_WITH_PASSWORD])
    const firstDialog = await openResetFromList(page)
    const secondPage = await context.newPage()
    const secondSeen = await mockReset(secondPage, [FAILED_WITH_PASSWORD])
    const secondDialog = await openResetFromList(secondPage, false)
    await expect(firstDialog.getByRole('button', { name: 'Confirmă resetarea' })).toBeEnabled()
    await expect(secondDialog.getByRole('button', { name: 'Confirmă resetarea' })).toBeEnabled()

    await firstDialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(firstDialog.getByLabel('Parolă temporară')).toHaveValue(PASSWORD)
    expect(firstSeen).toHaveLength(1)
    await expect.poll(() => page.evaluate(async () =>
      (await navigator.locks.query()).held?.some(lock => lock.name?.startsWith('bonie:reset-password:')) ?? false,
    )).toBe(false)
    await secondDialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(secondDialog.getByText('Nu am pornit o a doua resetare', { exact: false })).toBeVisible()
    expect(secondSeen).toHaveLength(0)

    await secondDialog.getByRole('button', { name: 'Încearcă din nou' }).click()
    const confirm = secondDialog.getByRole('button', { name: 'Confirmă resetarea' })
    await expect(confirm).toBeDisabled()
    await confirm.click()
    await expect(secondDialog.getByLabel('Parolă temporară')).toHaveValue(PASSWORD)
    expect(secondSeen).toHaveLength(1)
    expect(secondSeen[0].attemptId).not.toBe(firstSeen[0].attemptId)
  })

  test('fără Web Locks nu pornește resetarea', async ({ page }) => {
    const seen = await mockReset(page, [FAILED_WITH_PASSWORD])
    const dialog = await openResetFromList(page)
    await page.evaluate(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }))
    await dialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(dialog.getByText('Browserul nu poate coordona resetările între file.', { exact: false })).toBeVisible()
    expect(seen).toHaveLength(0)
  })

  test('un refuz al Web Locks este explicat fără să pornească resetarea', async ({ page }) => {
    const seen = await mockReset(page, [FAILED_WITH_PASSWORD])
    const dialog = await openResetFromList(page)
    await page.evaluate(() => Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: () => Promise.reject(new Error('Locks unavailable')) },
    }))
    await dialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(dialog.getByText('Nu am putut coordona resetarea între file.', { exact: false })).toBeVisible()
    expect(seen).toHaveLength(0)
  })

  test('verificarea unei încercări necunoscute nu o pornește după o resetare mai nouă', async ({ page, context }) => {
    let firstRequests = 0
    await page.route('**/api/users/*/reset-password', async route => {
      firstRequests++
      await route.abort('connectionreset')
    })
    const firstDialog = await openResetFromList(page)
    await firstDialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(firstDialog.getByRole('button', { name: 'Verifică rezultatul' })).toBeVisible()
    expect(firstRequests).toBe(1)

    const secondPage = await context.newPage()
    const secondSeen = await mockReset(secondPage, [FAILED_WITH_PASSWORD])
    const secondDialog = await openResetFromList(secondPage, false)
    await secondDialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await expect(secondDialog.getByLabel('Parolă temporară')).toHaveValue(PASSWORD)
    expect(secondSeen).toHaveLength(1)

    await firstDialog.getByRole('button', { name: 'Verifică rezultatul' }).click()
    await expect(firstDialog.getByText('O altă încercare de resetare a fost pornită între timp.', { exact: false })).toBeVisible()
    expect(firstRequests).toBe(1)
  })

  test('rezultatul necunoscut se verifică pe aceeași încercare dacă nu există alta mai nouă', async ({ page }) => {
    const seen = await mockReset(page, [{ status: 500, body: {} }, FAILED_WITH_PASSWORD])
    const dialog = await openResetFromList(page)
    await dialog.getByRole('button', { name: 'Confirmă resetarea' }).click()
    await dialog.getByRole('button', { name: 'Verifică rezultatul' }).click()
    await expect(dialog.getByLabel('Parolă temporară')).toHaveValue(PASSWORD)
    expect(seen).toHaveLength(2)
    expect(seen[1].attemptId).toBe(seen[0].attemptId)
  })

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
