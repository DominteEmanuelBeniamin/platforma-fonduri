import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Smoke peste dev server-ul pornit separat (`npm run dev`), cu conturi reale
 * din `.env.e2e.local`. Testele care scriu (upload) rulează numai cu
 * `E2E_WRITES=1`, fiindcă lasă fișiere și versiuni adevărate în proiect.
 */

const ENV_FILE = '.env.e2e.local'
const creds: Record<string, string> = fs.existsSync(ENV_FILE)
  ? Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
  : {}

const localEnv: Record<string, string> = fs.existsSync('.env.local')
  ? Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
  : {}

const PROJECT = creds.E2E_PROJECT_ID || ''
const WRITES = process.env.E2E_WRITES === '1'
const STAFF_READY = !!(PROJECT && creds.E2E_STAFF_EMAIL && creds.E2E_STAFF_PASSWORD)
const CLIENT_READY = !!(PROJECT && creds.E2E_CLIENT_EMAIL && creds.E2E_CLIENT_PASSWORD)
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mockChatMessage(projectId: string, body: string | null) {
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    created_by: crypto.randomUUID(),
    body,
    images: [],
    created_at: new Date().toISOString(),
    edited_at: null,
    deleted_at: null,
    profiles: null,
    is_deleted: false,
  }
}

async function browserAccessToken(page: Page) {
  return page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const raw = localStorage.getItem(localStorage.key(index) ?? '')
      if (!raw) continue
      try {
        const value = JSON.parse(raw) as { access_token?: unknown; currentSession?: { access_token?: unknown } }
        const token = value.access_token ?? value.currentSession?.access_token
        if (typeof token === 'string' && token) return token
      } catch {
        // Supabase auth is JSON; unrelated local-storage entries are ignored.
      }
    }
    return null
  })
}

async function login(page: Page, who: 'CLIENT' | 'STAFF') {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=email]').fill(creds[`E2E_${who}_EMAIL`])
  await page.locator('input[type=password]').fill(creds[`E2E_${who}_PASSWORD`])
  await page.getByRole('button', { name: 'Intră în cont' }).click()
  await page.waitForURL('/', { timeout: 25_000 })
  await page.waitForTimeout(1500)
}

/** Un PDF minim, ca upload-ul să treacă validarea fără să care un fixture în repo. */
function samplePdf(name: string) {
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
  return file
}

/**
 * Un PNG 60x40 (3:2) valid, fără fixture binar în repo. Proporția nu e
 * decorativă: testele de mai jos măsoară randarea, iar un pătrat ar fi trecut
 * și peste o tăiere forțată.
 */
const SAMPLE_PNG_RATIO = 60 / 40
function samplePng(name: string) {
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADwAAAAoCAIAAAAt2Q6oAAAAfklEQVR42mP89e0Dw1ADTAxDEIw6etTRo44edfSoo0cdTXXA' +
    '8vHdi6HnaPpYY2jhQbkh50/sGMrJA5lTGBZBuYn9q1aMZsRRR486etTRo44edfSoo4dRgwne1hlNHqOOpjVgfP3kxtDLiKun' +
    'tI8mj1FHjzp61NGjjh519KijARXLErxt1IfLAAAAAElFTkSuQmCC',
    'base64',
  ))
  return file
}

/**
 * Imaginile randate în firul de discuție, fără miniaturile din composer:
 * `alt` e același nume de fișier în ambele locuri.
 */
const sentImages = (drawer: Locator, name: string) =>
  drawer.locator(`.overflow-y-auto img[alt="${name}"]`)

/** Geometria de după decodare: până atunci înălțimea automată e încă 0. */
async function renderedBox(image: Locator) {
  await expect(image).toHaveJSProperty('complete', true, { timeout: 20_000 })
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 20_000 })
    .toBeGreaterThan(0)
  const box = await image.boundingBox()
  if (!box) throw new Error('imaginea nu are geometrie')
  return box
}

function badFile(name: string) {
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, 'nu sunt un tip permis\n')
  return file
}

/**
 * Nu fixa numele cererii: testele de upload chiar mută cererea din „De încărcat”
 * în „În verificare”, deci un nume scris în cod se evaporă după prima rulare.
 */
async function openFirstPendingRequest(page: Page) {
  await page.goto(`/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const rows = page.locator('button').filter({ hasText: 'De încărcat' })
  test.skip(await rows.count() === 0, 'clientul nu mai are nicio cerere „De încărcat” în proiect')
  const name = (await rows.first().innerText()).split('\n')[0].trim()
  await rows.first().click()
  await page.waitForTimeout(3500)
  return name
}

async function openProjectChat(page: Page) {
  await page.goto(`/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  await page.getByRole('button', { name: /^Chat/ }).click()
  // Scopat pe titlu: `aside` prinde și bara laterală cu fazele proiectului.
  const drawer = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Chat proiect' }) })
  await expect(drawer.getByRole('heading', { name: 'Chat proiect' })).toBeVisible()
  return drawer
}

type ComposerPost = {
  body: string | null
  images: Array<{ path: string; name: string }>
}

type ComposerMocks = {
  initPaths: string[][]
  posts: ComposerPost[]
  cleanupCalls: string[][]
}

type ComposerMockOptions = {
  onPut?: (route: Route, path: string) => Promise<void>
  onPost?: (route: Route, body: ComposerPost, attempt: number) => Promise<void>
  onCleanup?: (route: Route, paths: string[]) => Promise<void>
}

async function mockComposerRequests(
  page: Page,
  options: ComposerMockOptions = {},
): Promise<ComposerMocks> {
  const state: ComposerMocks = { initPaths: [], posts: [], cleanupCalls: [] }

  await page.route(`**/api/projects/${PROJECT}/chat/images/init`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const request = route.request().postDataJSON() as {
      files?: Array<{ name?: string; type?: string }>
    }
    const initAttempt = state.initPaths.length + 1
    const paths = (request.files ?? []).map((file, index) =>
      `projects/${PROJECT}/chat/e2e-user/attempt-${initAttempt}-${index}-${file.name ?? 'image.png'}`)
    state.initPaths.push(paths)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        uploads: paths.map((uploadPath, index) => ({
          clientFileId: index,
          path: uploadPath,
          signedUploadUrl: `http://localhost:3000/__e2e__/chat-upload/${encodeURIComponent(uploadPath)}`,
          token: `e2e-token-${initAttempt}-${index}`,
          mimeType: request.files?.[index]?.type ?? 'image/png',
        })),
      }),
    })
  })

  await page.route('**/__e2e__/chat-upload/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    if (options.onPut) return options.onPut(route, path)
    await route.fulfill({ status: 200, body: '' })
  })

  await page.route(`**/api/projects/${PROJECT}/chat/images/cleanup`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const request = route.request().postDataJSON() as { paths?: string[] }
    const paths = request.paths ?? []
    state.cleanupCalls.push(paths)
    if (options.onCleanup) return options.onCleanup(route, paths)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, removedPaths: paths, skippedPaths: [] }),
    })
  })

  await page.route(`**/api/projects/${PROJECT}/chat/messages`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataJSON() as ComposerPost
    state.posts.push(body)
    if (options.onPost) return options.onPost(route, body, state.posts.length)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ item: mockChatMessage(PROJECT, body.body) }),
    })
  })

  return state
}

test('paginile atinse se încarcă fără erori de consolă', async ({ page }) => {
  test.skip(!STAFF_READY, `lipsesc proiectul sau credențialele staff din ${ENV_FILE}`)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await login(page, 'STAFF')
  for (const url of ['/', '/notificari', `/projects/${PROJECT}`]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
  }
  expect(errors).toEqual([])
})

test('un tip de fișier nepermis e oprit în client, fără să atingă serverul', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const calls: string[] = []
  page.on('request', r => { if (r.url().includes('uploads/init')) calls.push(r.url()) })

  await login(page, 'CLIENT')
  await openFirstPendingRequest(page)
  await page.locator('input[type=file]:not([webkitdirectory])').first()
    .setInputFiles(badFile('smoke-e2e.xyz'))
  await page.waitForTimeout(1500)

  await expect(page.getByText('Tip de fișier nepermis').first()).toBeVisible()
  expect(calls, 'validarea nu are voie să ajungă la server').toEqual([])
})

test('chatul redirecționează documentele spre cereri, fără inițiere de upload', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const calls: string[] = []
  page.on('request', r => {
    if (r.url().includes(`/api/projects/${PROJECT}/chat/images/init`)) calls.push(r.url())
  })

  await login(page, 'CLIENT')
  const drawer = await openProjectChat(page)
  await drawer.locator('input[type=file]').setInputFiles(samplePdf('smoke-chat.pdf'))

  await expect(drawer.getByText('Documentele se încarcă prin cererile dedicate.')).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Alege cererea potrivită' })).toBeVisible()
  expect(calls, 'un document nu trebuie trimis la endpointul imaginilor').toEqual([])
})

test('chatul respinge a șasea imagine înainte de upload', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const calls: string[] = []
  page.on('request', r => {
    if (r.url().includes(`/api/projects/${PROJECT}/chat/images/init`)) calls.push(r.url())
  })

  await login(page, 'CLIENT')
  const drawer = await openProjectChat(page)
  const files = Array.from({ length: 6 }, (_, index) => samplePng(`smoke-chat-${index}.png`))
  await drawer.locator('input[type=file]').setInputFiles(files)

  await expect(drawer.getByText('Poți atașa maximum 5 imagini într-un mesaj.')).toBeVisible()
  expect(calls, 'limita trebuie aplicată înainte de upload').toEqual([])
})

test('mesajele brute nu sunt citibile direct prin PostgREST', async ({ page }) => {
  test.skip(
    !CLIENT_READY || !SUPABASE_URL || !SUPABASE_ANON_KEY,
    `lipsesc proiectul, credențialele client sau configurarea Supabase din ${ENV_FILE}/.env.local`,
  )

  await login(page, 'CLIENT')
  const accessToken = await browserAccessToken(page)
  expect(accessToken, 'sesiunea autentificată trebuie să expună tokenul Supabase').toBeTruthy()

  const apiResponse = await page.context().request.get(`/api/projects/${PROJECT}/chat/messages?limit=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  expect(apiResponse.status(), 'API-ul autorizat trebuie să rămână funcțional').toBe(200)

  const directResponse = await page.context().request.get(
    `${SUPABASE_URL}/rest/v1/project_chat_messages?select=body,images&limit=1`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )
  const directBody = await directResponse.json().catch(() => null) as { code?: string } | null
  expect(directResponse.status(), 'PostgREST trebuie să refuze rolul authenticated').toBe(403)
  expect(directBody?.code, 'refuzul trebuie să fie o eroare de privilegii PostgreSQL').toBe('42501')
})

test('textul actualizat în timpul PUT-ului intră în POST', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const putStarted = deferred<void>()
  const releasePut = deferred<void>()
  const postSeen = deferred<ComposerPost>()
  await mockComposerRequests(page, {
    onPut: async (route) => {
      putStarted.resolve()
      await releasePut.promise
      await route.fulfill({ status: 200, body: '' })
    },
    onPost: async (route, body) => {
      postSeen.resolve(body)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ item: mockChatMessage(PROJECT, body.body) }),
      })
    },
  })

  await login(page, 'CLIENT')
  const drawer = await openProjectChat(page)
  await drawer.locator('input[type=file]').setInputFiles(samplePng('chat-put-lent.png'))
  await drawer.getByRole('button', { name: 'Trimite' }).click()
  await putStarted.promise

  await drawer.locator('textarea').fill('Text scris cât imaginea se încarcă')
  releasePut.resolve()

  expect((await postSeen.promise).body).toBe('Text scris cât imaginea se încarcă')
  await expect(drawer.locator('textarea')).toHaveValue('')
})

test('sufixul tastat după pornirea POST-ului rămâne draft', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const postStarted = deferred<ComposerPost>()
  const releasePost = deferred<void>()
  await mockComposerRequests(page, {
    onPost: async (route, body) => {
      postStarted.resolve(body)
      await releasePost.promise
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ item: mockChatMessage(PROJECT, body.body) }),
      })
    },
  })

  await login(page, 'CLIENT')
  const drawer = await openProjectChat(page)
  const textarea = drawer.locator('textarea')
  await textarea.fill('Mesajul trimis')
  await drawer.getByRole('button', { name: 'Trimite' }).click()
  expect((await postStarted.promise).body).toBe('Mesajul trimis')

  await textarea.press('End')
  await textarea.type(' — draft nou')
  releasePost.resolve()

  await expect(textarea).toHaveValue(' — draft nou')
})

test('POST 500 curăță o singură dată și retry-ul folosește path-uri noi', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const state = await mockComposerRequests(page, {
    onPost: async (route, body, attempt) => {
      if (attempt === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'e2e failure' }),
        })
        return
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ item: mockChatMessage(PROJECT, body.body) }),
      })
    },
  })

  await login(page, 'CLIENT')
  const drawer = await openProjectChat(page)
  const name = 'chat-retry.png'
  await drawer.locator('input[type=file]').setInputFiles(samplePng(name))
  await drawer.locator('textarea').fill('Mesaj pentru retry')
  await drawer.getByRole('button', { name: 'Trimite' }).click()

  await expect.poll(() => state.cleanupCalls.length).toBe(1)
  expect(state.cleanupCalls[0]).toEqual(state.initPaths[0])
  await expect(drawer.locator('textarea')).toHaveValue('Mesaj pentru retry')
  await expect(drawer.locator(`img[alt="${name}"]`)).toBeVisible()

  await drawer.getByRole('button', { name: 'Trimite' }).click()
  await expect.poll(() => state.posts.length).toBe(2)
  await expect.poll(() => state.initPaths.length).toBe(2)
  expect(state.initPaths[1]).not.toEqual(state.initPaths[0])
  expect(state.posts[1].images.map((image) => image.path)).toEqual(state.initPaths[1])
  expect(state.cleanupCalls, 'path-urile primei încercări se curăță exact o dată').toHaveLength(1)
})

test('închiderea în timpul PUT-ului face abort și cleanup înainte să ascundă drawerul', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const putStarted = deferred<void>()
  const finishPutAsAborted = deferred<void>()
  const cleanupStarted = deferred<string[]>()
  const releaseCleanup = deferred<void>()
  const state = await mockComposerRequests(page, {
    onPut: async (route) => {
      putStarted.resolve()
      await finishPutAsAborted.promise
      await route.abort('aborted').catch(() => undefined)
    },
    onCleanup: async (route, paths) => {
      cleanupStarted.resolve(paths)
      await releaseCleanup.promise
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, removedPaths: paths, skippedPaths: [] }),
      })
    },
  })

  await login(page, 'CLIENT')
  const drawer = await openProjectChat(page)
  await drawer.locator('input[type=file]').setInputFiles(samplePng('chat-close-put.png'))
  await drawer.getByRole('button', { name: 'Trimite' }).click()
  await putStarted.promise

  await drawer.getByRole('button', { name: 'Închide chatul' }).click()
  finishPutAsAborted.resolve()
  expect(await cleanupStarted.promise).toEqual(state.initPaths[0])
  await expect(drawer, 'drawerul rămâne deschis până se termină cleanup-ul').toBeVisible()
  expect(state.posts, 'după abort nu mai pornește POST-ul mesajului').toHaveLength(0)

  releaseCleanup.resolve()
  await expect(drawer).toBeHidden()
  expect(state.cleanupCalls).toHaveLength(1)
})

test('închiderea în timpul POST-ului așteaptă răspunsul', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const postStarted = deferred<ComposerPost>()
  const releasePost = deferred<void>()
  await mockComposerRequests(page, {
    onPost: async (route, body) => {
      postStarted.resolve(body)
      await releasePost.promise
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ item: mockChatMessage(PROJECT, body.body) }),
      })
    },
  })

  await login(page, 'CLIENT')
  const drawer = await openProjectChat(page)
  await drawer.locator('textarea').fill('Mesaj cu POST lent')
  await drawer.getByRole('button', { name: 'Trimite' }).click()
  await postStarted.promise

  await drawer.getByRole('button', { name: 'Închide chatul' }).click()
  await expect(drawer, 'drawerul nu se închide cât POST-ul e nedeterminat').toBeVisible()

  releasePost.resolve()
  await expect(drawer).toBeHidden()
})

test.describe('upload real', () => {
  test.skip(!WRITES, 'scrie date reale — rulează cu E2E_WRITES=1')

  test('Realtime propagă create, update și delete numai prin events', async ({ browser }) => {
    test.skip(
      !STAFF_READY || !CLIENT_READY,
      `lipsesc proiectul sau credențialele staff/client din ${ENV_FILE}`,
    )
    const staffContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
    const clientContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
    const staffPage = await staffContext.newPage()
    const clientPage = await clientContext.newPage()
    let messageId: string | null = null
    let staffToken: string | null = null

    try {
      await Promise.all([login(staffPage, 'STAFF'), login(clientPage, 'CLIENT')])
      const [staffDrawer, clientDrawer] = await Promise.all([
        openProjectChat(staffPage),
        openProjectChat(clientPage),
      ])
      staffToken = await browserAccessToken(staffPage)
      expect(staffToken).toBeTruthy()

      const stamp = Date.now()
      const createdBody = `realtime-create-${stamp}`
      const updatedBody = `realtime-update-${stamp}`
      const createResponse = await staffContext.request.post(
        `/api/projects/${PROJECT}/chat/messages`,
        {
          headers: { Authorization: `Bearer ${staffToken}` },
          data: { body: createdBody, images: [] },
        },
      )
      expect(createResponse.status()).toBe(201)
      const created = await createResponse.json() as { item?: { id?: string } }
      messageId = created.item?.id ?? null
      expect(messageId).toBeTruthy()
      await expect(clientDrawer.getByText(createdBody, { exact: true })).toBeVisible({ timeout: 15_000 })

      const patchResponse = await staffContext.request.patch(
        `/api/projects/${PROJECT}/chat/messages/${messageId}`,
        {
          headers: { Authorization: `Bearer ${staffToken}` },
          data: { body: updatedBody },
        },
      )
      expect(patchResponse.status()).toBe(200)
      await expect(clientDrawer.getByText(updatedBody, { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(clientDrawer.getByText(createdBody, { exact: true })).toHaveCount(0)

      const deleteResponse = await staffContext.request.delete(
        `/api/projects/${PROJECT}/chat/messages/${messageId}`,
        { headers: { Authorization: `Bearer ${staffToken}` } },
      )
      expect(deleteResponse.status()).toBe(200)
      await expect(clientDrawer.getByText(updatedBody, { exact: true })).toHaveCount(0, { timeout: 15_000 })
      messageId = null

      // Autorul rămâne și el conectat; folosirea variabilei păstrează explicit
      // ambele sesiuni active până după ultimul eveniment.
      await expect(staffDrawer.getByRole('heading', { name: 'Chat proiect' })).toBeVisible()
    } finally {
      if (messageId && staffToken) {
        await staffContext.request.delete(
          `/api/projects/${PROJECT}/chat/messages/${messageId}`,
          { headers: { Authorization: `Bearer ${staffToken}` } },
        ).catch(() => undefined)
      }
      await Promise.all([staffContext.close(), clientContext.close()])
    }
  })

  test('staff trimite un mesaj chat doar cu imagine', async ({ page }) => {
    test.skip(!STAFF_READY, `lipsesc proiectul sau credențialele staff din ${ENV_FILE}`)
    const steps: Array<{ kind: string, status: number }> = []
    page.on('response', r => {
      const url = r.url()
      if (url.includes(`/api/projects/${PROJECT}/chat/images/init`)) {
        steps.push({ kind: 'init', status: r.status() })
      } else if (url.endsWith(`/api/projects/${PROJECT}/chat/messages`) && r.request().method() === 'POST') {
        steps.push({ kind: 'message', status: r.status() })
      }
    })

    await login(page, 'STAFF')
    const drawer = await openProjectChat(page)
    const name = `smoke-chat-${Date.now()}.png`
    await drawer.locator('input[type=file]').setInputFiles(samplePng(name))
    await drawer.getByRole('button', { name: 'Trimite' }).click()

    await expect(sentImages(drawer, name)).toHaveCount(1, { timeout: 15_000 })
    expect(steps, 'inițializarea și crearea mesajului trebuie să reușească').toEqual([
      { kind: 'init', status: 200 },
      { kind: 'message', status: 201 },
    ])

    // Cu înălțime fixă și `w-full`, bula se strângea pe lățimea intrinsecă a
    // pozei: o fotografie de 1500x1000 ajungea la 144x96 px într-un drawer de
    // 520, iar una portret la 64x96. Ambele praguri de aici ar fi picat atunci.
    const image = sentImages(drawer, name)
    const box = await renderedBox(image)
    expect(box.width, 'poza nu trebuie randată ca miniatură').toBeGreaterThan(240)
    expect(
      box.width / box.height,
      'o singură poză își păstrează proporția, nu e tăiată la o înălțime fixă',
    ).toBeCloseTo(SAMPLE_PNG_RATIO, 1)

    // Escape închidea și lightbox-ul, și tot chatul: Radix își trata singur
    // evenimentul, iar handlerul drawerului prindea aceeași apăsare cu starea
    // deja golită.
    await image.click()
    await expect(page.getByRole('button', { name: 'Descarcă' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Descarcă' })).toBeHidden()
    await expect(
      drawer.getByRole('heading', { name: 'Chat proiect' }),
      'Escape închide doar previzualizarea, nu și chatul',
    ).toBeVisible()
  })

  test('mai multe imagini se așază într-o grilă de pătrate', async ({ page }) => {
    test.skip(!STAFF_READY, `lipsesc proiectul sau credențialele staff din ${ENV_FILE}`)

    await login(page, 'STAFF')
    const drawer = await openProjectChat(page)
    const stamp = Date.now()
    const names = [`smoke-grid-a-${stamp}.png`, `smoke-grid-b-${stamp}.png`]
    await drawer.locator('input[type=file]').setInputFiles(names.map(samplePng))
    await drawer.getByRole('button', { name: 'Trimite' }).click()

    await expect(sentImages(drawer, names[1])).toHaveCount(1, { timeout: 20_000 })
    const boxes = await Promise.all(names.map(name => renderedBox(sentImages(drawer, name))))

    // Cu mai multe poze, consecvența bate proporția: altfel o grilă cu un
    // peisaj și un portret iese cu două celule de înălțimi diferite.
    for (const [index, box] of boxes.entries()) {
      expect(box.width / box.height, `celula ${index + 1} trebuie să fie pătrată`).toBeCloseTo(1, 1)
    }
    expect(boxes[0].width, 'celulele au aceeași lățime').toBeCloseTo(boxes[1].width, 0)
    expect(boxes[0].y, 'cele două poze stau pe același rând').toBeCloseTo(boxes[1].y, 0)
    expect(boxes[0].width, 'nici în grilă nu sunt miniaturi').toBeGreaterThan(100)

    // Lightbox-ul se plimbă prin pozele aceluiași mesaj, cu butoane și taste.
    await sentImages(drawer, names[0]).click()
    await expect(page.getByText('1 din 2')).toBeVisible()
    await page.getByRole('button', { name: 'Imaginea următoare' }).click()
    await expect(page.getByText('2 din 2')).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByText('1 din 2')).toBeVisible()
    await page.keyboard.press('Escape')

    // La editare rămâne vizibil la ce se referă textul.
    await sentImages(drawer, names[0]).hover()
    await drawer.locator('button:visible')
      .filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') })
      .last().click()
    await drawer.getByRole('button', { name: 'Editează' }).click()
    await expect(drawer.getByRole('button', { name: 'Salvează' })).toBeVisible()
    await expect(
      sentImages(drawer, names[0]),
      'pozele rămân vizibile cât editezi textul',
    ).toBeVisible()
    await drawer.getByRole('button', { name: 'Anulează' }).click()
  })

  test('textul și poza nu stau în aceeași bulă', async ({ page }) => {
    test.skip(!STAFF_READY, `lipsesc proiectul sau credențialele staff din ${ENV_FILE}`)

    await login(page, 'STAFF')
    const drawer = await openProjectChat(page)
    const stamp = Date.now()
    const name = `smoke-caption-${stamp}.png`
    const body = `smoke-caption-${stamp}`
    await drawer.locator('input[type=file]').setInputFiles(samplePng(name))
    await drawer.locator('textarea').fill(body)
    await drawer.getByRole('button', { name: 'Trimite' }).click()

    const image = sentImages(drawer, name)
    await expect(image).toHaveCount(1, { timeout: 20_000 })
    await expect(drawer.getByText(body)).toBeVisible()

    // Primul strămoș comun al pozei și al textului trebuie să fie coloana
    // grupului — transparentă. Dacă e o bulă, are fundal pictat, iar poza a
    // ajuns înghesuită în bula de text.
    const background = await image.evaluate((el, text) => {
      let node: HTMLElement | null = el.parentElement
      while (node && !node.textContent?.includes(text)) node = node.parentElement
      return node ? getComputedStyle(node).backgroundColor : null
    }, body)
    expect(background, 'poza nu are voie să stea în bula de text').toBe('rgba(0, 0, 0, 0)')

    // Și geometric: bula de text se termină deasupra pozei, nu în jurul ei.
    const textBox = await (await drawer.getByText(body).boundingBox())
    const imageBox = await renderedBox(image)
    expect(textBox!.y + textBox!.height, 'textul stă deasupra pozei').toBeLessThanOrEqual(imageBox.y)
  })

  test('clientul încarcă din modalul cererii', async ({ page }) => {
    test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
    const steps: number[] = []
    page.on('response', r => {
      if (r.url().includes('uploads/init') || r.url().includes('uploads/complete')) steps.push(r.status())
    })

    await login(page, 'CLIENT')
    await openFirstPendingRequest(page)
    const dialog = page.locator('[role=dialog]')
    await expect(dialog).toBeVisible()
    await dialog.locator('input[type=file]:not([webkitdirectory])').first()
      .setInputFiles(samplePdf('smoke-e2e.pdf'))
    await dialog.getByRole('button', { name: /^Încarcă \(1\)$/ }).click()
    await page.waitForTimeout(12_000)

    expect(steps, 'init și complete trebuie să răspundă 200').toEqual([200, 200])
    await expect(page.getByText('smoke-e2e.pdf').first()).toBeVisible()
  })

  test('clientul încarcă din panoul paginii', async ({ page }) => {
    test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
    const steps: number[] = []
    page.on('response', r => {
      if (r.url().includes('uploads/init') || r.url().includes('uploads/complete')) steps.push(r.status())
    })

    await login(page, 'CLIENT')
    await openFirstPendingRequest(page)
    await page.keyboard.press('Escape') // panoul din pagină, nu modalul
    await page.waitForTimeout(1500)
    await expect(page.locator('[role=dialog]')).toHaveCount(0)

    await page.locator('input[type=file]:not([webkitdirectory])').first()
      .setInputFiles(samplePdf('smoke-e2e.pdf'))
    await page.getByRole('button', { name: /^Încarcă \(1\)$/ }).first().click()
    await page.waitForTimeout(12_000)

    expect(steps).toEqual([200, 200])
  })
})

test('filtrul de categorii se poate folosi numai din tastatură', async ({ page }) => {
  test.skip(!STAFF_READY, `lipsesc proiectul sau credențialele staff din ${ENV_FILE}`)
  await login(page, 'STAFF')
  await page.goto('/notificari', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  const combo = page.getByRole('combobox', { name: 'Filtrează după categorie' })
  await combo.focus()
  await expect(combo).toHaveAttribute('aria-expanded', 'false')

  await page.keyboard.press('ArrowDown')
  await expect(combo).toHaveAttribute('aria-expanded', 'true')

  const first = await combo.getAttribute('aria-activedescendant')
  await page.keyboard.press('ArrowDown')
  expect(await combo.getAttribute('aria-activedescendant'),
    'săgeata trebuie să mute opțiunea activă').not.toBe(first)

  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)

  await expect(combo).toHaveAttribute('aria-expanded', 'false')
  await expect(combo).toContainText('Publicări')
  expect(await combo.evaluate(el => el === document.activeElement),
    'focusul se întoarce pe control după alegere').toBe(true)

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(combo).toHaveAttribute('aria-expanded', 'false')
})
