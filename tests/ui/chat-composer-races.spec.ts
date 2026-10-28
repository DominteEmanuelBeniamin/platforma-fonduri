import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import { autentifica, uiConfig } from './helpers'

const { projectId } = uiConfig()

const CONVERSATION_A = '00000000-0000-4000-8000-000000000301'
const CONVERSATION_B = '00000000-0000-4000-8000-000000000302'
const PEER_A = '00000000-0000-4000-8000-000000000401'
const PEER_B = '00000000-0000-4000-8000-000000000402'
const PROJECT_PEER = '00000000-0000-4000-8000-000000000403'

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

type PostAttempt = { scopeId: string; body: string }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
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
        const session = JSON.parse(raw) as {
          access_token?: unknown
          currentSession?: { access_token?: unknown }
        }
        const token = session.access_token ?? session.currentSession?.access_token
        if (typeof token !== 'string') continue
        const part = token.split('.')[1]
        if (!part) continue
        const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
        const payload = JSON.parse(atob(base64 + '='.repeat((4 - base64.length % 4) % 4))) as {
          sub?: unknown
        }
        if (typeof payload.sub === 'string') return payload.sub
      } catch {
        // Ignore unrelated local-storage entries.
      }
    }
    return null
  })
  if (!userId) throw new Error('Autentificarea UI nu a expus un id de utilizator')
  return userId
}

type MockState = {
  userId: string | null
  posts: PostAttempt[]
  committed: string[]
  holdFirstPost: boolean
  firstPostStarted: ReturnType<typeof deferred>
  releaseFirstPost: ReturnType<typeof deferred>
  failedPostsRemaining: number
}

function mockState(): MockState {
  return {
    userId: null,
    posts: [],
    committed: [],
    holdFirstPost: false,
    firstPostStarted: deferred(),
    releaseFirstPost: deferred(),
    failedPostsRemaining: 0,
  }
}

function makeMessage(
  id: number,
  body: string,
  authorId: string,
  scopeId: string,
  kind: 'private' | 'project',
): Message {
  return {
    id: uuid(id),
    body,
    created_at: new Date(Date.now() + id * 10).toISOString(),
    created_by: authorId,
    deleted_at: null,
    edited_at: null,
    is_deleted: false,
    profiles: { id: authorId, full_name: 'Test Admin', email: 'admin@example.test' },
    images: [],
    ...(kind === 'private' ? { conversation_id: scopeId } : { project_id: scopeId }),
  }
}

async function recordPost(
  route: Route,
  state: MockState,
  scopeId: string,
  body: string,
  messages: Message[],
  kind: 'private' | 'project',
) {
  state.posts.push({ scopeId, body })
  if (state.failedPostsRemaining > 0) {
    state.failedPostsRemaining -= 1
    return json(route, 503, { error: 'Temporarily unavailable' })
  }

  const item = makeMessage(
    50_000 + state.committed.length,
    body,
    state.userId ?? PROJECT_PEER,
    scopeId,
    kind,
  )
  messages.push(item)
  state.committed.push(body)

  if (state.holdFirstPost && state.committed.length === 1) {
    state.firstPostStarted.resolve()
    await state.releaseFirstPost.promise
  }
  return json(route, 201, { item })
}

type PrivateConversation = {
  id: string
  created_at: string
  created_by: string
  last_message_at: string
  last_read_at: null
  other_last_read_at: null
  other_user: { id: string; full_name: string; email: string }
  last_message: Message | null
  has_unread: false
}

async function installPrivateMocks(page: Page, state: MockState) {
  const messages = new Map<string, Message[]>([
    [CONVERSATION_A, []],
    [CONVERSATION_B, []],
  ])
  let conversations: PrivateConversation[] = []

  await page.route('**/api/private-conversations**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/private-conversations/unread') {
      return json(route, 200, { hasUnread: false, unreadConversationCount: 0 })
    }
    if (path === '/api/private-conversations/users') return json(route, 200, { items: [] })
    if (path === '/api/private-conversations' && request.method() === 'GET') {
      const items = conversations.map((conversation) => {
        const latest = messages.get(conversation.id)?.at(-1) ?? null
        return { ...conversation, last_message: latest, last_message_at: latest?.created_at ?? conversation.last_message_at }
      })
      return json(route, 200, { items })
    }

    const match = path.match(/^\/api\/private-conversations\/([^/]+)\/(messages|read)(?:\/([^/]+))?$/)
    if (!match) return json(route, 200, { items: [] })
    const conversationId = match[1]
    const resource = match[2]
    const messageId = match[3]

    if (resource === 'read' && request.method() === 'GET') {
      return json(route, 200, { ok: true, lastReadAt: null, otherLastReadAt: null })
    }
    if (resource === 'read' && request.method() === 'POST') {
      const body = request.postDataJSON() as { readThroughAt?: string }
      return json(route, 200, { ok: true, lastReadAt: body.readThroughAt ?? new Date().toISOString() })
    }
    if (resource === 'messages' && !messageId && request.method() === 'GET') {
      return json(route, 200, { items: (messages.get(conversationId) ?? []).slice().reverse(), nextCursor: null })
    }
    if (resource === 'messages' && !messageId && request.method() === 'POST') {
      const body = request.postDataJSON() as { body?: string }
      const rows = messages.get(conversationId) ?? []
      messages.set(conversationId, rows)
      return recordPost(route, state, conversationId, body.body ?? '', rows, 'private')
    }
    if (resource === 'messages' && messageId && request.method() === 'DELETE') {
      return json(route, 200, { ok: true })
    }
    if (resource === 'messages' && messageId && request.method() === 'PATCH') {
      return json(route, 200, { item: (messages.get(conversationId) ?? []).find(row => row.id === messageId) ?? null })
    }
    return json(route, 200, { items: [] })
  })

  return {
    messages,
    setFixture(userId: string) {
      state.userId = userId
      const now = new Date().toISOString()
      conversations = [
        {
          id: CONVERSATION_A,
          created_at: now,
          created_by: userId,
          last_message_at: now,
          last_read_at: null,
          other_last_read_at: null,
          other_user: { id: PEER_A, full_name: 'Test Partner One', email: 'one@example.test' },
          last_message: null,
          has_unread: false,
        },
        {
          id: CONVERSATION_B,
          created_at: now,
          created_by: userId,
          last_message_at: new Date(Date.now() - 60_000).toISOString(),
          last_read_at: null,
          other_last_read_at: null,
          other_user: { id: PEER_B, full_name: 'Test Partner Two', email: 'two@example.test' },
          last_message: null,
          has_unread: false,
        },
      ]
    },
  }
}

async function installProjectMocks(page: Page, id: string, state: MockState) {
  const messages: Message[] = []
  await page.route('**/api/projects/chat/unread', route => json(route, 200, {
    ok: true,
    hasUnread: false,
    unreadProjectCount: 0,
    unreadMessageCount: 0,
    unreadProjects: [],
  }))
  await page.route(`**/api/projects/${id}/chat/read`, async (route) => {
    if (route.request().method() === 'GET') {
      return json(route, 200, { ok: true, lastReadAt: null, readStates: [] })
    }
    const body = route.request().postDataJSON() as { readThroughAt?: string }
    return json(route, 200, { ok: true, lastReadAt: body.readThroughAt ?? new Date().toISOString(), readStates: [] })
  })
  await page.route(`**/api/projects/${id}/chat/messages**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === `/api/projects/${id}/chat/messages` && request.method() === 'GET') {
      return json(route, 200, { items: messages.slice().reverse(), nextCursor: null })
    }
    if (path === `/api/projects/${id}/chat/messages` && request.method() === 'POST') {
      const body = request.postDataJSON() as { body?: string }
      return recordPost(route, state, id, body.body ?? '', messages, 'project')
    }
    if (request.method() === 'DELETE') return json(route, 200, { ok: true })
    if (request.method() === 'PATCH') return json(route, 200, { item: null })
    return json(route, 200, { item: messages.find(row => row.id === path.split('/').pop()) ?? null })
  })
  await page.route(`**/api/projects/${id}/chat/images/init`, route => json(route, 200, { uploads: [] }))
  await page.route(`**/api/projects/${id}/chat/images/cleanup`, route => json(route, 200, { ok: true, removedPaths: [], skippedPaths: [] }))
  return { messages }
}

async function openPrivateA(page: Page) {
  const state = mockState()
  const api = await installPrivateMocks(page, state)
  await autentifica(page, 'admin')
  api.setFixture(await signedInUserId(page))
  await page.goto('/chat', { waitUntil: 'networkidle' })
  await page.locator('aside').getByRole('button', { name: /Test Partner One/ }).click()
  const scope = page.getByPlaceholder('Scrie un mesaj...').locator('xpath=ancestor::section[1]')
  await expect(scope.getByPlaceholder('Scrie un mesaj...')).toBeVisible()
  return { state, api, scope }
}

async function openProject(page: Page, id: string) {
  const state = mockState()
  const api = await installProjectMocks(page, id, state)
  await autentifica(page, 'admin')
  state.userId = await signedInUserId(page)
  await page.goto(`/projects/${id}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^Chat/ }).first().click()
  const scope = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Chat proiect' }) })
  await expect(scope.getByPlaceholder('Scrie un mesaj...')).toBeVisible()
  return { state, api, scope }
}

async function submitThreeWhileFirstResponseWaits(
  scope: Locator,
  state: MockState,
  expectedScopeId: string,
) {
  const composer = scope.getByPlaceholder('Scrie un mesaj...')
  const send = scope.getByRole('button', { name: 'Trimite' })
  const bodies = ['succesiune-mesaj-A', 'succesiune-mesaj-B', 'succesiune-mesaj-C']
  const draft = 'text nou păstrat după răspuns'
  state.holdFirstPost = true

  try {
    await composer.fill(bodies[0])
    await composer.press('Enter')
    await state.firstPostStarted.promise

    await composer.fill(bodies[1])
    await send.click()
    await composer.fill(bodies[2])
    await composer.press('Enter')
    await composer.fill(draft)

    state.releaseFirstPost.resolve()
    await expect.poll(() => state.posts.length, { timeout: 15_000 }).toBe(3)
    await expect.poll(() => state.committed.length, { timeout: 15_000 }).toBe(3)
    expect(state.posts).toEqual(bodies.map(body => ({ scopeId: expectedScopeId, body })))

    const boxes = []
    for (const body of bodies) {
      const row = scope.getByText(body, { exact: true })
      await expect(row).toBeVisible()
      await expect(row).toHaveCount(1)
      const box = await row.boundingBox()
      if (!box) throw new Error(`Mesajul ${body} nu are geometrie`)
      boxes.push(box)
    }
    expect(boxes[0].y).toBeLessThan(boxes[1].y)
    expect(boxes[1].y).toBeLessThan(boxes[2].y)
    await expect(composer).toHaveValue(draft)
  } finally {
    state.releaseFirstPost.resolve()
  }
}

async function exerciseFailureAndRetry(scope: Locator, state: MockState) {
  const composer = scope.getByPlaceholder('Scrie un mesaj...')
  const body = 'mesaj-de-retrimis'
  const followingBodies = ['mesaj-păstrat-după-eșec-1', 'mesaj-păstrat-după-eșec-2']
  const draft = 'draft separat de mesajele în așteptare'
  state.failedPostsRemaining = 1
  await composer.fill(body)
  await composer.press('Enter')

  await expect.poll(() => state.posts.length).toBe(1)
  await expect(scope.getByText(/Nu am putut trimite mesajul|Nu am putut trimite/i).first()).toBeVisible()
  for (const nextBody of followingBodies) {
    await composer.fill(nextBody)
    await composer.press('Enter')
    await expect(composer).toHaveValue('')
  }
  await composer.fill(draft)
  expect(state.posts.map(post => post.body)).toEqual([body])

  const retry = scope.getByRole('button', { name: /Reîncearcă|Retrimite/i })
  if (await retry.count() > 0 && await retry.first().isVisible()) {
    await retry.first().click()
  } else {
    await expect(composer).toHaveValue(body)
    await composer.press('Enter')
  }

  await expect.poll(() => state.posts.length).toBe(4)
  await expect.poll(() => state.committed.length).toBe(3)
  expect(state.posts.map(post => post.body)).toEqual([body, body, ...followingBodies])
  expect(state.committed).toEqual([body, ...followingBodies])
  await expect(scope.getByText(body, { exact: true })).toHaveCount(1)
  await expect(composer).toHaveValue(draft)
}

test.describe('Compunerea mesajelor în chatul privat', () => {
  test('trimite rapid trei mesaje în ordine și păstrează textul scris în așteptare', async ({ page }) => {
    const chat = await openPrivateA(page)
    await submitThreeWhileFirstResponseWaits(chat.scope, chat.state, CONVERSATION_A)
  })

  test('arată eșecul și permite reîncercarea fără duplicat', async ({ page }) => {
    const chat = await openPrivateA(page)
    await exerciseFailureAndRetry(chat.scope, chat.state)
  })

  test('schimbarea conversației nu trimite un draft vechi către noul partener', async ({ page }) => {
    const chat = await openPrivateA(page)
    await chat.scope.getByPlaceholder('Scrie un mesaj...').fill('draft destinat doar partenerului unu')

    const back = page.getByRole('button', { name: 'Înapoi la conversații' })
    if (await back.isVisible()) await back.click()
    await page.locator('aside').getByRole('button', { name: /Test Partner Two/ }).click()

    const nextScope = page.getByPlaceholder('Scrie un mesaj...').locator('xpath=ancestor::section[1]')
    const composer = nextScope.getByPlaceholder('Scrie un mesaj...')
    await expect(composer).toHaveValue('')
    await composer.fill('mesaj destinat partenerului doi')
    await composer.press('Enter')

    await expect.poll(() => chat.state.posts.length).toBe(1)
    expect(chat.state.posts).toEqual([{ scopeId: CONVERSATION_B, body: 'mesaj destinat partenerului doi' }])
    expect(chat.api.messages.get(CONVERSATION_A)).toHaveLength(0)
    expect(chat.api.messages.get(CONVERSATION_B)?.map(message => message.body)).toEqual(['mesaj destinat partenerului doi'])
    await expect(nextScope.getByText('mesaj destinat partenerului doi', { exact: true })).toBeVisible()
  })
})

test('mesajele acceptate în așteptare rămân la partenerul lor după schimbarea conversației', async ({ page }) => {
  const chat = await openPrivateA(page)
  const composer = chat.scope.getByPlaceholder('Scrie un mesaj...')
  chat.state.holdFirstPost = true
  try {
    await composer.fill('primul mesaj pentru partenerul unu')
    await composer.press('Enter')
    await chat.state.firstPostStarted.promise
    await composer.fill('al doilea mesaj pentru partenerul unu')
    await composer.press('Enter')
    const back = page.getByRole('button', { name: 'Înapoi la conversații' })
    if (await back.isVisible()) await back.click()
    await page.locator('aside').getByRole('button', { name: /Test Partner Two/ }).click()
    const nextComposer = page.getByPlaceholder('Scrie un mesaj...')
    await nextComposer.fill('mesaj doar pentru partenerul doi')
    await nextComposer.press('Enter')
    await expect.poll(() => chat.state.posts.length).toBe(2)
    const firstResponse = page.waitForResponse(response =>
      response.request().method() === 'POST' && response.url().includes(`${CONVERSATION_A}/messages`))
    chat.state.releaseFirstPost.resolve()
    await firstResponse
    await expect(page.getByText('mesaj doar pentru partenerul doi', { exact: true })).toBeVisible()
    if (await back.isVisible()) await back.click()
    await page.locator('aside').getByRole('button', { name: /Test Partner One/ }).click()
    await expect.poll(() => chat.state.posts.length).toBe(3)
    expect(chat.state.posts).toEqual([
      { scopeId: CONVERSATION_A, body: 'primul mesaj pentru partenerul unu' },
      { scopeId: CONVERSATION_B, body: 'mesaj doar pentru partenerul doi' },
      { scopeId: CONVERSATION_A, body: 'al doilea mesaj pentru partenerul unu' },
    ])
    await expect(chat.scope.getByText('al doilea mesaj pentru partenerul unu', { exact: true })).toBeVisible()
  } finally {
    chat.state.releaseFirstPost.resolve()
  }
})

test.describe('Compunerea mesajelor în chatul proiectului', () => {
  test.skip(!projectId, 'E2E_PROJECT_ID lipsește din configurația UI')

  test('trimite rapid trei mesaje în ordine și păstrează textul scris în așteptare', async ({ page }) => {
    const chat = await openProject(page, projectId!)
    await submitThreeWhileFirstResponseWaits(chat.scope, chat.state, projectId!)
  })

  test('arată eșecul și permite reîncercarea fără duplicat', async ({ page }) => {
    const chat = await openProject(page, projectId!)
    await exerciseFailureAndRetry(chat.scope, chat.state)
  })

  test('închiderea în timpul răspunsului întârziat păstrează mesajul acceptat', async ({ page }) => {
    const chat = await openProject(page, projectId!)
    const body = 'mesaj-acceptat-înainte-de-închidere'
    const composer = chat.scope.getByPlaceholder('Scrie un mesaj...')
    chat.state.holdFirstPost = true

    try {
      await composer.fill(body)
      await chat.scope.getByRole('button', { name: 'Trimite' }).click()
      await chat.state.firstPostStarted.promise
      expect(chat.state.posts).toEqual([{ scopeId: projectId!, body }])

      await chat.scope.getByRole('button', { name: /Închide chatul|Înapoi/ }).click()
      chat.state.releaseFirstPost.resolve()
      await expect(chat.scope).toBeHidden()

      await page.getByRole('button', { name: /^Chat/ }).first().click()
      const reopened = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Chat proiect' }) })
      await expect(reopened.getByText(body, { exact: true })).toBeVisible()
      expect(chat.state.committed).toEqual([body])
      expect(chat.api.messages.map(message => message.body)).toEqual([body])
    } finally {
      chat.state.releaseFirstPost.resolve()
    }
  })
})

async function expectComposerResize(scope: Locator, state: MockState) {
  const composer = scope.getByPlaceholder('Scrie un mesaj...')
  const singleLineHeight = await composer.evaluate(el => el.getBoundingClientRect().height)
  state.holdFirstPost = true
  try {
    await composer.fill(Array(9).fill('linie').join('\n'))
    await expect.poll(() => composer.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(singleLineHeight)
    await scope.getByRole('button', { name: 'Trimite', exact: true }).click()
    await state.firstPostStarted.promise
    await expect(composer).toHaveValue('')
    await expect.poll(() => composer.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(singleLineHeight + 1)
    await composer.evaluate(el => { el.style.height = '140px' })
    await expect.poll(() => composer.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(singleLineHeight + 1)
    await composer.fill('draft nou\nîncă o linie')
    await expect.poll(() => composer.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(singleLineHeight)
    state.releaseFirstPost.resolve()
    await expect(composer).toHaveValue('draft nou\nîncă o linie')
  } finally {
    state.releaseFirstPost.resolve()
  }
}

async function expectWrapped(scope: Locator, text: string) {
  const message = scope.getByText(text, { exact: true })
  await expect(message).toBeVisible()
  const geometry = await message.evaluate(el => {
    const box = el.getBoundingClientRect()
    const container = el.closest('.group\\/row')!.getBoundingClientRect()
    return { width: box.width, height: box.height, containerWidth: container.width, left: box.left, right: box.right, containerLeft: container.left, containerRight: container.right }
  })
  expect(geometry.width).toBeLessThanOrEqual(geometry.containerWidth)
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.containerLeft - 1)
  expect(geometry.right).toBeLessThanOrEqual(geometry.containerRight + 1)
  expect(geometry.height).toBeGreaterThan(40)
}

test('chatul privat încadrează textul lung și micșorează compozitorul', async ({ page }) => {
  const state = mockState()
  const api = await installPrivateMocks(page, state)
  await autentifica(page, 'admin')
  const userId = await signedInUserId(page)
  api.setFixture(userId)
  const longText = 'Q'.repeat(1500)
  api.messages.get(CONVERSATION_A)!.push(makeMessage(900, longText, PEER_A, CONVERSATION_A, 'private'))
  api.messages.get(CONVERSATION_A)!.push(makeMessage(901, 'R'.repeat(1500), userId, CONVERSATION_A, 'private'))
  await page.goto('/chat', { waitUntil: 'networkidle' })
  await page.locator('aside').getByRole('button', { name: /Test Partner One/ }).click()
  const scope = page.getByPlaceholder('Scrie un mesaj...').locator('xpath=ancestor::section[1]')
  await expectWrapped(scope, longText)
  await expectWrapped(scope, 'R'.repeat(1500))
  await expectComposerResize(scope, state)
})

test('chatul proiectului folosește totalul complet, încadrează textul și micșorează compozitorul', async ({ page }) => {
  test.skip(!projectId, 'E2E_PROJECT_ID lipsește din configurația UI')
  const id = projectId!
  const state = mockState()
  const api = await installProjectMocks(page, id, state)
  await autentifica(page, 'admin')
  const userId = await signedInUserId(page)
  state.userId = userId
  const longText = 'Q'.repeat(1500)
  for (let i = 0; i < 50; i++) {
    api.messages.push(makeMessage(1000 + i, i === 49 ? longText : i === 0 ? 'R'.repeat(1500) : `mesaj-${i}`, i === 0 ? userId : PROJECT_PEER, id, 'project'))
  }
  let unread = 123
  await page.route('**/api/projects/chat/unread', route => json(route, 200, {
    hasUnread: unread > 0, unreadProjectCount: unread > 0 ? 1 : 0, unreadMessageCount: unread,
    unreadProjects: unread > 0 ? [{ projectId: id, unreadMessageCount: unread }] : [],
  }))
  await page.route(`**/api/projects/${id}/chat/read`, async route => {
    if (route.request().method() === 'POST') unread = 0
    return json(route, 200, { ok: true, lastReadAt: null, readStates: [] })
  })
  await page.goto(`/projects/${id}`, { waitUntil: 'networkidle' })
  const chatButton = page.getByRole('button', { name: /^Chat/ }).first()
  await expect(chatButton).toHaveAttribute('aria-label', 'Chat, 123 mesaje necitite')
  await expect(chatButton.getByText('99+')).toBeVisible()
  await chatButton.click()
  const scope = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Chat proiect' }) })
  await expectWrapped(scope, longText)
  await expectWrapped(scope, 'R'.repeat(1500))
  await expect(chatButton).toHaveAttribute('aria-label', 'Chat')
  await expectComposerResize(scope, state)
})

test('confirmarea de citire folosește singularul, pluralul și «toți»', async ({ page }) => {
  test.skip(!projectId, 'E2E_PROJECT_ID lipsește din configurația UI')
  const id = projectId!
  const state = mockState()
  const api = await installProjectMocks(page, id, state)
  await autentifica(page, 'admin')
  const userId = await signedInUserId(page)
  api.messages.push(makeMessage(2000, 'mesaj cu confirmare', userId, id, 'project'))
  let readers = 1
  await page.route(`**/api/projects/${id}/chat/read`, route => json(route, 200, {
    ok: true,
    lastReadAt: null,
    readStates: [userId, PEER_A, PEER_B, PROJECT_PEER, uuid(404)].map((reader, index) => ({
      project_id: id,
      user_id: reader,
      last_read_at: index > 0 && index <= readers ? '2100-01-01T00:00:00.000Z' : null,
    })),
  }))
  for (const [count, label] of [[1, 'Citit de 1 persoană'], [3, 'Citit de 3 persoane'], [4, 'Citit de toți']] as const) {
    readers = count
    await page.goto(`/projects/${id}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Chat/ }).first().click()
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
})
