import { test, expect, type Page, type Route } from '@playwright/test'
import { autentifica, uiConfig } from './helpers'

// Regresiile găsite la review-ul PR #123: coada de text, istoricul după un prim GET eșuat,
// închiderea panoului de proiect și Escape în meniul „…”. API-ul de chat e simulat.

const { projectId } = uiConfig()

const CONVERSATION_A = '00000000-0000-4000-8000-000000000501'
const CONVERSATION_B = '00000000-0000-4000-8000-000000000502'
const PEER_A = '00000000-0000-4000-8000-000000000601'
const PEER_B = '00000000-0000-4000-8000-000000000602'

type Message = {
  id: string
  body: string
  created_at: string
  created_by: string
  deleted_at: null
  edited_at: null
  is_deleted: false
  profiles: { id: string; full_name: string; email: string }
  images: []
  conversation_id?: string
  project_id?: string
}

type Post = { scopeId: string; body: string }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

let nextId = 1
function uuid() {
  nextId += 1
  return `00000000-0000-4000-8000-${String(700_000 + nextId).padStart(12, '0')}`
}

async function json(route: Route, status: number, value: unknown) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
}

async function signedInUserId(page: Page) {
  const userId = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const raw = localStorage.getItem(localStorage.key(index) ?? '')
      if (!raw) continue
      try {
        const token = (JSON.parse(raw) as { access_token?: unknown }).access_token
        if (typeof token !== 'string') continue
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        const payload = JSON.parse(atob(base64 + '='.repeat((4 - base64.length % 4) % 4))) as { sub?: unknown }
        if (typeof payload.sub === 'string') return payload.sub
      } catch {
        // Intrări locale fără legătură cu sesiunea.
      }
    }
    return null
  })
  if (!userId) throw new Error('Autentificarea UI nu a expus un id de utilizator')
  return userId
}

function message(body: string, authorId: string, createdAt: string, scope: { conversation_id?: string; project_id?: string }): Message {
  return {
    id: uuid(),
    body,
    created_at: createdAt,
    created_by: authorId,
    deleted_at: null,
    edited_at: null,
    is_deleted: false,
    profiles: { id: authorId, full_name: 'Test Admin', email: 'admin@example.test' },
    images: [],
    ...scope,
  }
}

type ChatState = {
  userId: string
  posts: Post[]
  /** POST-urile care întorc 400, în ordinea sosirii. */
  rejectPosts: number
  holdFirstPost: boolean
  firstPostStarted: ReturnType<typeof deferred>
  releaseFirstPost: ReturnType<typeof deferred>
  /** Cât timp e true, GET-ul mesajelor private răspunde 503. */
  failMessageGets: boolean
}

function chatState(): ChatState {
  return {
    userId: '',
    posts: [],
    rejectPosts: 0,
    holdFirstPost: false,
    firstPostStarted: deferred(),
    releaseFirstPost: deferred(),
    failMessageGets: false,
  }
}

async function handlePost(route: Route, state: ChatState, scopeId: string, body: string, rows: Message[], scope: { conversation_id?: string; project_id?: string }) {
  state.posts.push({ scopeId, body })
  if (state.rejectPosts > 0) {
    state.rejectPosts -= 1
    return json(route, 400, { error: 'body is too long (max 5000 chars)' })
  }
  const item = message(body, state.userId, new Date(Date.now() + 1_000).toISOString(), scope)
  rows.push(item)
  if (state.holdFirstPost && state.posts.length === 1) {
    state.firstPostStarted.resolve()
    await state.releaseFirstPost.promise
  }
  return json(route, 201, { item })
}

async function openPrivateChat(page: Page, history: (userId: string) => Message[] = () => []) {
  const state = chatState()
  const messages = new Map<string, Message[]>([[CONVERSATION_A, []], [CONVERSATION_B, []]])
  let conversations: unknown[] = []

  await page.route('**/api/private-conversations**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/private-conversations/unread') return json(route, 200, { hasUnread: false, unreadConversationCount: 0 })
    if (path === '/api/private-conversations/users') return json(route, 200, { items: [] })
    if (path === '/api/private-conversations' && request.method() === 'GET') return json(route, 200, { items: conversations })

    const match = path.match(/^\/api\/private-conversations\/([^/]+)\/(messages|read)(?:\/([^/]+))?$/)
    if (!match) return json(route, 200, { items: [] })
    const [, conversationId, resource, messageId] = match
    if (resource === 'read' && request.method() === 'GET') return json(route, 200, { ok: true, lastReadAt: null, otherLastReadAt: null })
    if (resource === 'read') {
      const body = request.postDataJSON() as { readThroughAt?: string }
      return json(route, 200, { ok: true, lastReadAt: body.readThroughAt ?? new Date().toISOString() })
    }
    const rows = messages.get(conversationId) ?? []
    if (!messageId && request.method() === 'GET') {
      if (state.failMessageGets) return json(route, 503, { error: 'Temporarily unavailable' })
      return json(route, 200, { items: rows.slice().reverse(), nextCursor: null })
    }
    if (!messageId && request.method() === 'POST') {
      const body = (request.postDataJSON() as { body?: string }).body ?? ''
      return handlePost(route, state, conversationId, body, rows, { conversation_id: conversationId })
    }
    return json(route, 200, { ok: true })
  })

  await autentifica(page, 'admin')
  state.userId = await signedInUserId(page)
  messages.set(CONVERSATION_A, history(state.userId))
  const now = new Date().toISOString()
  conversations = [
    { id: CONVERSATION_A, created_at: now, created_by: state.userId, last_message_at: now, last_read_at: null, other_last_read_at: null, other_user: { id: PEER_A, full_name: 'Review Partner One', email: 'one@example.test' }, last_message: null, has_unread: false },
    { id: CONVERSATION_B, created_at: now, created_by: state.userId, last_message_at: new Date(Date.now() - 60_000).toISOString(), last_read_at: null, other_last_read_at: null, other_user: { id: PEER_B, full_name: 'Review Partner Two', email: 'two@example.test' }, last_message: null, has_unread: false },
  ]
  return { state, messages }
}

async function selectConversation(page: Page, name: RegExp) {
  const back = page.getByRole('button', { name: 'Înapoi la conversații' })
  if (await back.isVisible()) await back.click()
  await page.locator('aside').getByRole('button', { name }).click()
  const composer = page.getByPlaceholder('Scrie un mesaj...')
  await expect(composer).toBeVisible()
  return { composer, scope: composer.locator('xpath=ancestor::section[1]') }
}

async function openProjectChat(page: Page, id: string, seed: (userId: string) => Message[] = () => []) {
  const state = chatState()
  let rows: Message[] = []
  await page.route('**/api/projects/chat/unread', route => json(route, 200, { ok: true, hasUnread: false, unreadProjectCount: 0, unreadMessageCount: 0, unreadProjects: [] }))
  await page.route(`**/api/projects/${id}/chat/read`, async (route) => {
    if (route.request().method() === 'GET') return json(route, 200, { ok: true, lastReadAt: null, readStates: [] })
    const body = route.request().postDataJSON() as { readThroughAt?: string }
    return json(route, 200, { ok: true, lastReadAt: body.readThroughAt ?? new Date().toISOString(), readStates: [] })
  })
  await page.route(`**/api/projects/${id}/chat/messages**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === `/api/projects/${id}/chat/messages` && request.method() === 'GET') return json(route, 200, { items: rows.slice().reverse(), nextCursor: null })
    if (path === `/api/projects/${id}/chat/messages` && request.method() === 'POST') {
      const body = (request.postDataJSON() as { body?: string }).body ?? ''
      return handlePost(route, state, id, body, rows, { project_id: id })
    }
    return json(route, 200, { item: null })
  })
  await autentifica(page, 'admin')
  state.userId = await signedInUserId(page)
  rows = seed(state.userId)
  await page.goto(`/projects/${id}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^Chat/ }).first().click()
  const scope = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Chat proiect' }) })
  await expect(scope.getByPlaceholder('Scrie un mesaj...')).toBeVisible()
  return { state, scope }
}

test.describe('Coada de text în chatul privat', () => {
  test('„Renunță” scoate mesajul respins, îl pune înapoi în editor și lasă restul cozii să plece', async ({ page }) => {
    const chat = await openPrivateChat(page)
    await page.goto('/chat', { waitUntil: 'networkidle' })
    const { composer, scope } = await selectConversation(page, /Review Partner One/)

    chat.state.rejectPosts = 1
    await composer.fill('mesaj respins definitiv')
    await composer.press('Enter')
    await expect(scope.getByText('Nu s-a trimis', { exact: false })).toBeVisible()
    await composer.fill('mesaj următor din coadă')
    await composer.press('Enter')
    await expect(composer).toHaveValue('')
    expect(chat.state.posts.map(post => post.body)).toEqual(['mesaj respins definitiv'])

    await scope.getByRole('button', { name: /Renunță la mesajul netrimis/ }).click()

    await expect.poll(() => chat.state.posts.map(post => post.body)).toEqual(['mesaj respins definitiv', 'mesaj următor din coadă'])
    await expect(composer).toHaveValue('mesaj respins definitiv')
    await expect(scope.getByText('mesaj următor din coadă', { exact: true })).toBeVisible()
    await expect(scope.getByText('Nu s-a trimis', { exact: false })).toHaveCount(0)
  })

  test('editorul nu acceptă mai mult decât limita serverului de 5.000 de caractere', async ({ page }) => {
    await openPrivateChat(page)
    await page.goto('/chat', { waitUntil: 'networkidle' })
    const { composer } = await selectConversation(page, /Review Partner One/)
    await composer.fill('x'.repeat(6_000))
    await expect.poll(async () => (await composer.inputValue()).length).toBeLessThanOrEqual(5_000)
  })

  test('mesajele deja puse în coadă pleacă și după trecerea la altă conversație', async ({ page }) => {
    const chat = await openPrivateChat(page)
    await page.goto('/chat', { waitUntil: 'networkidle' })
    const first = await selectConversation(page, /Review Partner One/)
    chat.state.holdFirstPost = true
    try {
      await first.composer.fill('primul mesaj către unu')
      await first.composer.press('Enter')
      await chat.state.firstPostStarted.promise
      await first.composer.fill('al doilea mesaj către unu')
      await first.composer.press('Enter')

      await selectConversation(page, /Review Partner Two/)
      chat.state.releaseFirstPost.resolve()

      // Fără să revenim la conversația unu.
      await expect.poll(() => chat.state.posts, { timeout: 15_000 }).toEqual([
        { scopeId: CONVERSATION_A, body: 'primul mesaj către unu' },
        { scopeId: CONVERSATION_A, body: 'al doilea mesaj către unu' },
      ])
    } finally {
      chat.state.releaseFirstPost.resolve()
    }
  })
})

test('istoricul rămâne întreg când prima încărcare a eșuat și utilizatorul a trimis între timp', async ({ page }) => {
  const older = ['istoric vechi 1', 'istoric vechi 2', 'istoric vechi 3']
  const chat = await openPrivateChat(page, userId => older.map((body, index) =>
    message(body, index % 2 ? PEER_A : userId, new Date(Date.now() - (10 - index) * 60_000).toISOString(), { conversation_id: CONVERSATION_A })))
  chat.state.failMessageGets = true
  await page.goto('/chat', { waitUntil: 'networkidle' })
  const { composer, scope } = await selectConversation(page, /Review Partner One/)
  await expect(scope.getByText('Nu am putut încărca mesajele', { exact: false })).toBeVisible()

  await composer.fill('trimis cât istoricul lipsea')
  await composer.press('Enter')
  await expect(scope.getByText('trimis cât istoricul lipsea', { exact: true })).toBeVisible()

  chat.state.failMessageGets = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  for (const body of older) await expect(scope.getByText(body, { exact: true })).toBeVisible()
})

test.describe('Panoul de chat al proiectului', () => {
  test.skip(!projectId, 'E2E_PROJECT_ID lipsește din configurația UI')

  test('se poate închide, cu confirmare, când coada s-a oprit la un mesaj netrimis', async ({ page }) => {
    const chat = await openProjectChat(page, projectId!)
    chat.state.rejectPosts = 99
    const composer = chat.scope.getByPlaceholder('Scrie un mesaj...')
    await composer.fill('mesaj care nu poate pleca')
    await composer.press('Enter')
    await expect(chat.scope.getByText('Nu s-a trimis', { exact: false })).toBeVisible()

    await page.keyboard.press('Escape')
    const confirm = page.getByRole('dialog', { name: 'Închizi chatul?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Închide chatul' }).click()
    await expect(chat.scope).toBeHidden()
  })

  test('Escape în meniul „…” închide doar meniul, nu tot chatul', async ({ page }) => {
    const chat = await openProjectChat(page, projectId!, userId => [
      message('mesaj cu meniu', userId, new Date(Date.now() - 60_000).toISOString(), { project_id: projectId! }),
    ])
    const text = chat.scope.getByText('mesaj cu meniu', { exact: true })
    await expect(text).toBeVisible()
    await text.hover()
    await chat.scope.getByRole('button', { name: 'Opțiuni mesaj' }).first().click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(chat.scope.getByRole('heading', { name: 'Chat proiect' })).toBeVisible()
    await expect(chat.scope.getByRole('button', { name: 'Opțiuni mesaj' }).first()).toBeFocused()
  })
})
