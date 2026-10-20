import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type Request } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient } from './helpers/project-state'
import { startDedicatedNext, startPatchGateProxy, type PatchGateProxy, type StartedNextServer } from './helpers/private-chat-edit-order'

const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const adminClient = serviceClient()

if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(CONFIG.supabaseUrl).hostname)) {
  throw new Error('Private chat edit-order acceptance requires explicitly local Supabase')
}
if (!adminClient) throw new Error('Dedicated E2E Supabase service credentials are required')
const ADMIN = adminClient

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Person = { id: string; email: string; password: string; token: string }
type FixtureScope = { userIds: string[]; messageIds: string[]; conversationId?: string }
type ChatHarness = {
  sender: Person
  recipient: Person
  conversationId: string
  messageId: string
  initialBody: string
  page: Page
  proxy: PatchGateProxy
  server: StartedNextServer
  scope: FixtureScope
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function waitForGate<T>(promise: Promise<T>, label: string, timeoutMs = 30_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} was not reached`)), timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function createPerson(admin: SupabaseClient, scope: FixtureScope, label: string): Promise<Person> {
  const email = `private-edit-${label}-${randomUUID()}@example.invalid`
  const password = `PrivateEdit-${randomUUID()}!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`Could not create temporary ${label} account: ${error?.message ?? 'missing user'}`)
  scope.userIds.push(data.user.id)

  const profile = await admin.from('profiles').update({
    role: 'consultant',
    full_name: `Private edit ${label}`,
    consultant_level: 'junior',
    is_active: true,
  }).eq('id', data.user.id)
  if (profile.error) throw profile.error

  const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password })
  if (signInError || !session.session) {
    throw new Error(`Could not sign in temporary ${label} account: ${signInError?.message ?? 'missing session'}`)
  }
  return { id: data.user.id, email, password, token: session.session.access_token }
}

async function appRequest(server: StartedNextServer, person: Person, method: string, path: string, body?: unknown) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${person.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) as Json }
}

async function messageRow(admin: SupabaseClient, messageId: string) {
  const { data, error } = await admin.from('private_messages')
    .select('id, body, edited_at, deleted_at')
    .eq('id', messageId)
    .single()
  if (error || !data) throw new Error(`Could not read test message: ${error?.message ?? 'missing row'}`)
  return data
}

function threadBody(page: Page, body: string) {
  return page.locator('section')
    .filter({ has: page.getByPlaceholder('Scrie un mesaj...') })
    .locator('div.whitespace-pre-wrap')
    .filter({ hasText: body })
}

function timestampMicros(value: string): bigint {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new Error(`Unexpected ISO timestamp: ${value}`)
  const seconds = Date.parse(`${match[1]}${match[3]}`)
  if (!Number.isFinite(seconds)) throw new Error(`Unexpected ISO timestamp: ${value}`)
  const fractionalMicros = BigInt((match[2] ?? '').slice(0, 6).padEnd(6, '0'))
  return BigInt(seconds) * BigInt(1000) + fractionalMicros
}

async function cleanupFixture(admin: SupabaseClient, scope: FixtureScope) {
  for (const id of scope.messageIds) {
    const result = await admin.from('private_messages').delete().eq('id', id)
    if (result.error) throw result.error
  }
  if (scope.conversationId) {
    const participants = await admin.from('private_conversation_participants').delete()
      .eq('conversation_id', scope.conversationId)
    if (participants.error) throw participants.error
    const conversation = await admin.from('private_conversations').delete().eq('id', scope.conversationId)
    if (conversation.error) throw conversation.error
  }
  for (const id of scope.userIds) {
    const result = await admin.auth.admin.deleteUser(id)
    if (result.error) throw result.error
  }
}

async function withOpenChat<T>(page: Page, action: (chat: ChatHarness) => Promise<T>): Promise<T> {
  const scope: FixtureScope = { userIds: [], messageIds: [] }
  let proxy: PatchGateProxy | undefined
  let server: StartedNextServer | undefined
  let sender: Person | undefined
  let recipient: Person | undefined

  try {
    sender = await createPerson(ADMIN, scope, 'sender')
    recipient = await createPerson(ADMIN, scope, 'recipient')
    proxy = await startPatchGateProxy(CONFIG.supabaseUrl)
    server = await startDedicatedNext(CONFIG, proxy.url)

    const created = await appRequest(server, sender, 'POST', '/api/private-conversations', { userId: recipient.id })
    expect(created.status, JSON.stringify(created.json)).toBe(200)
    const conversationId = created.json.item?.id as string
    expect(conversationId).toBeTruthy()
    scope.conversationId = conversationId

    const initialBody = `Private edit initial ${randomUUID()}`
    const createdMessage = await appRequest(server, sender, 'POST', `/api/private-conversations/${conversationId}/messages`, { body: initialBody })
    expect(createdMessage.status, JSON.stringify(createdMessage.json)).toBe(201)
    const messageId = createdMessage.json.item?.id as string
    expect(messageId).toBeTruthy()
    scope.messageIds.push(messageId)

    await page.goto(`${server.url}/login`)
    await page.fill('input[type=email]', recipient.email)
    await page.fill('input[type=password]', recipient.password)
    await page.click('button[type=submit]')
    await page.waitForURL(url => !url.pathname.startsWith('/login'))
    await page.goto(`${server.url}/chat?conversation=${encodeURIComponent(conversationId)}`)
    await expect(page.getByPlaceholder('Scrie un mesaj...')).toBeVisible()
    await expect(threadBody(page, initialBody)).toHaveCount(1)

    return await action({ sender, recipient, conversationId, messageId, initialBody, page, proxy, server, scope })
  } finally {
    proxy?.release()
    await page.close().catch(() => undefined)
    await server?.stop().catch(() => undefined)
    await proxy?.close().catch(() => undefined)
    await cleanupFixture(ADMIN, scope)
  }
}

test('an earlier edit whose DB write finishes last remains the final edit', async ({ page }) => {
  await withOpenChat(page, async chat => {
    const bodyA = `Private edit A ${randomUUID()}`
    const bodyB = `Private edit B ${randomUUID()}`
    chat.proxy.arm(chat.messageId, bodyA)

    const pendingA = appRequest(chat.server, chat.sender, 'PATCH',
      `/api/private-conversations/${chat.conversationId}/messages/${chat.messageId}`, { body: bodyA })
    void pendingA.catch(() => undefined)

    try {
      const heldWrite = await chat.proxy.waitUntilHeld()
      expect(heldWrite.body.body).toBe(bodyA)
      expect(heldWrite.body.edited_at).toBeUndefined()

      const responseB = await appRequest(chat.server, chat.sender, 'PATCH',
        `/api/private-conversations/${chat.conversationId}/messages/${chat.messageId}`, { body: bodyB })
      expect(responseB.status, JSON.stringify(responseB.json)).toBe(200)
      expect((await messageRow(ADMIN, chat.messageId)).body).toBe(bodyB)
      await expect(threadBody(chat.page, bodyB)).toHaveCount(1)

      chat.proxy.release()
      const responseA = await pendingA
      expect(responseA.status, JSON.stringify(responseA.json)).toBe(200)
      const finalRow = await messageRow(ADMIN, chat.messageId)
      expect(finalRow.body).toBe(bodyA)
      expect(finalRow.edited_at).toBeTruthy()

      const timestampA = finalRow.edited_at as string
      const timestampB = responseB.json.item?.edited_at as string
      expect(timestampB).toBeTruthy()
      expect(timestampMicros(timestampA)).toBeGreaterThan(timestampMicros(timestampB))
      expect(responseA.json.item?.edited_at).toBe(timestampA)

      const audit = await ADMIN.from('audit_logs').select('id, new_values')
        .eq('entity_id', chat.messageId)
      if (audit.error) throw audit.error
      expect((audit.data ?? []).some(row =>
        (row.new_values as { edited_at?: string } | null)?.edited_at === timestampA,
      )).toBe(true)
      await expect(threadBody(chat.page, bodyA)).toHaveCount(1)
    } finally {
      chat.proxy.release()
    }
  })
})

test('a held stale recovery response cannot replace a newer realtime edit', async ({ page }) => {
  await withOpenChat(page, async chat => {
    const bodyA = `Private recovery A ${randomUUID()}`
    const bodyB = `Private recovery B ${randomUUID()}`
    const initialEdit = await appRequest(chat.server, chat.sender, 'PATCH',
      `/api/private-conversations/${chat.conversationId}/messages/${chat.messageId}`, { body: bodyB })
    expect(initialEdit.status, JSON.stringify(initialEdit.json)).toBe(200)
    expect((await messageRow(ADMIN, chat.messageId)).body).toBe(bodyB)
    await expect(threadBody(chat.page, bodyB)).toHaveCount(1)

    const heldGet = deferred<void>()
    const releaseGet = deferred<void>()
    const staleGetFinished = deferred<void>()
    let didHoldResponse = false
    let staleRequest: Request | undefined
    const messagesPath = `/api/private-conversations/${chat.conversationId}/messages`
    const matchesMessagesGet = (url: URL) => url.origin === new URL(chat.server.url).origin &&
      url.pathname === messagesPath && url.searchParams.has('limit')
    const routeMatchesMessagesGet = (url: URL) => matchesMessagesGet(url)

    try {
      await chat.page.route(routeMatchesMessagesGet, async route => {
        const response = await route.fetch()
        const payload = await response.json().catch(() => ({})) as Json
        const item = (payload.items as Json[] | undefined)?.find(message => message.id === chat.messageId)
        if (!didHoldResponse && response.ok() && item?.body === bodyB) {
          didHoldResponse = true
          staleRequest = route.request()
          heldGet.resolve()
          try {
            await releaseGet.promise
            await route.fulfill({ response, body: JSON.stringify(payload) })
          } finally {
            staleGetFinished.resolve()
          }
          return
        }
        await route.fulfill({ response, body: JSON.stringify(payload) })
      })

      await chat.page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await waitForGate(heldGet.promise, 'The recovery GET returning B')

      const newerEdit = await appRequest(chat.server, chat.sender, 'PATCH',
        `/api/private-conversations/${chat.conversationId}/messages/${chat.messageId}`, { body: bodyA })
      expect(newerEdit.status, JSON.stringify(newerEdit.json)).toBe(200)
      expect((await messageRow(ADMIN, chat.messageId)).body).toBe(bodyA)
      await expect(threadBody(chat.page, bodyA)).toHaveCount(1)

      await chat.page.evaluate(body => {
        type WatchWindow = Window & {
          __privateChatStaleWatcher?: { seen: boolean; observer: MutationObserver }
        }
        const watcher: NonNullable<WatchWindow['__privateChatStaleWatcher']> = {
          seen: false,
          observer: new MutationObserver(() => {
            const chatThread = [...document.querySelectorAll('section')]
              .find(section => section.querySelector('textarea[placeholder="Scrie un mesaj..."]'))
            if (chatThread && [...chatThread.querySelectorAll('.whitespace-pre-wrap')]
              .some(element => element.textContent?.trim() === body)) watcher.seen = true
          }),
        }
        ;(window as WatchWindow).__privateChatStaleWatcher = watcher
        const chatThread = [...document.querySelectorAll('section')]
          .find(section => section.querySelector('textarea[placeholder="Scrie un mesaj..."]'))
        if (!chatThread) throw new Error('Private chat thread is not mounted')
        watcher.observer.observe(chatThread, { childList: true, subtree: true, characterData: true })
      }, bodyB)

      if (!staleRequest) throw new Error('The held recovery GET was not captured')
      const requestFinished = chat.page.waitForEvent('requestfinished', {
        predicate: request => request === staleRequest,
      })
      releaseGet.resolve()
      await waitForGate(
        Promise.all([requestFinished, staleGetFinished.promise]),
        'The stale recovery response to finish',
      )
      await chat.page.evaluate(() => new Promise<void>(resolve => {
        queueMicrotask(() => requestAnimationFrame(() => queueMicrotask(() => requestAnimationFrame(() => resolve()))))
      }))
      const staleBodyWasRendered = await chat.page.evaluate(() => {
        type WatchWindow = Window & {
          __privateChatStaleWatcher?: { seen: boolean; observer: MutationObserver }
        }
        const watcher = (window as WatchWindow).__privateChatStaleWatcher
        watcher?.observer.disconnect()
        return watcher?.seen ?? false
      })
      expect(staleBodyWasRendered).toBe(false)
      await expect(threadBody(chat.page, bodyA)).toHaveCount(1)
      await expect(threadBody(chat.page, bodyB)).toHaveCount(0)
    } finally {
      releaseGet.resolve()
      await chat.page.unroute(routeMatchesMessagesGet).catch(() => undefined)
    }
  })
})
