import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import { autentifica, uiConfig } from './helpers'

const { projectId } = uiConfig()

const PRIVATE_CONVERSATION_ID = '00000000-0000-4000-8000-000000000101'
const PRIVATE_PEER_ID = '00000000-0000-4000-8000-000000000201'
const PROJECT_PEER_ID = '00000000-0000-4000-8000-000000000202'

type Message = {
  id: string
  body: string
  created_at: string
  created_by: string
  deleted_at: null
  edited_at: null
  is_deleted: false
  profiles: { id: string; full_name: string; email: string } | null
  images: []
  conversation_id?: string
  project_id?: string
}

type PrivateConversation = {
  id: string
  created_at: string
  created_by: string
  last_message_at: string
  last_read_at: null
  other_last_read_at: null
  other_user: { id: string; full_name: string; email: string }
  last_message: Message
  has_unread: false
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

async function json(route: Route, status: number, value: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
  })
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
        // Other local-storage entries are not Supabase sessions.
      }
    }
    return null
  })
  if (!userId) throw new Error('Autentificarea UI nu a expus un id de utilizator')
  return userId
}

function message(
  id: number,
  body: string,
  authorId: string,
  createdAt: string,
  profile: Message['profiles'],
  scope: { conversationId?: string; projectId?: string },
): Message {
  return {
    id: uuid(id),
    body,
    created_at: createdAt,
    created_by: authorId,
    deleted_at: null,
    edited_at: null,
    is_deleted: false,
    profiles: profile,
    images: [],
    ...(scope.conversationId ? { conversation_id: scope.conversationId } : {}),
    ...(scope.projectId ? { project_id: scope.projectId } : {}),
  }
}

function seededMessages(
  kind: 'private' | 'project',
  currentUserId: string,
  scope: { conversationId?: string; projectId?: string },
) {
  const now = Date.now()
  return Array.from({ length: 32 }, (_, index) => {
    const isPeer = kind === 'project' && index === 16
    const authorId = isPeer ? PROJECT_PEER_ID : currentUserId
    const name = isPeer ? 'Mesaj de la coleg' : 'Mesaj propriu'
    const email = isPeer ? 'coleg@example.test' : 'utilizator@example.test'
    return message(
      (kind === 'private' ? 1000 : 2000) + index,
      `${kind}-seed-${String(index).padStart(2, '0')}`,
      authorId,
      new Date(now - (32 - index) * 10_000).toISOString(),
      { id: authorId, full_name: name, email },
      scope,
    )
  })
}

async function installPrivateMocks(page: Page) {
  let currentUserId: string | null = null
  let conversations: PrivateConversation[] = []
  const messages = new Map<string, Message[]>()

  await page.route('**/api/private-conversations**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path === '/api/private-conversations/unread') {
      return json(route, 200, { hasUnread: false, unreadConversationCount: 0 })
    }
    if (path === '/api/private-conversations/users') {
      return json(route, 200, { items: [] })
    }
    if (path === '/api/private-conversations' && request.method() === 'GET') {
      return json(route, 200, { items: conversations })
    }

    const messageMatch = path.match(/^\/api\/private-conversations\/([^/]+)\/messages(?:\/([^/]+))?$/)
    if (messageMatch) {
      const conversationId = messageMatch[1]
      const messageId = messageMatch[2]
      if (!messageId && request.method() === 'GET') {
        return json(route, 200, {
          items: (messages.get(conversationId) ?? []).slice().reverse(),
          nextCursor: null,
        })
      }
      if (!messageId && request.method() === 'POST') {
        const body = request.postDataJSON() as { body?: string }
        const rows = messages.get(conversationId) ?? []
        const item = message(
          10_000 + rows.length,
          body.body ?? '',
          currentUserId ?? PRIVATE_PEER_ID,
          new Date().toISOString(),
          { id: currentUserId ?? PRIVATE_PEER_ID, full_name: 'Test Admin', email: 'admin@example.test' },
          { conversationId },
        )
        rows.push(item)
        messages.set(conversationId, rows)
        return json(route, 201, { item })
      }
      if (messageId && request.method() === 'DELETE') return json(route, 200, { ok: true })
      if (messageId && request.method() === 'PATCH') {
        return json(route, 200, { item: (messages.get(conversationId) ?? []).find(row => row.id === messageId) ?? null })
      }
    }

    const readMatch = path.match(/^\/api\/private-conversations\/([^/]+)\/read$/)
    if (readMatch && request.method() === 'GET') {
      return json(route, 200, { ok: true, lastReadAt: null, otherLastReadAt: null })
    }
    if (readMatch && request.method() === 'POST') {
      const body = request.postDataJSON() as { readThroughAt?: string }
      return json(route, 200, { ok: true, lastReadAt: body.readThroughAt ?? new Date().toISOString() })
    }

    return json(route, 200, { items: [] })
  })

  return {
    setFixture(userId: string) {
      currentUserId = userId
      const now = new Date().toISOString()
      const firstMessages = seededMessages('private', userId, { conversationId: PRIVATE_CONVERSATION_ID })
      messages.set(PRIVATE_CONVERSATION_ID, firstMessages)
      conversations = [{
        id: PRIVATE_CONVERSATION_ID,
        created_at: now,
        created_by: userId,
        last_message_at: now,
        last_read_at: null,
        other_last_read_at: null,
        other_user: {
          id: PRIVATE_PEER_ID,
          full_name: 'Test Partner One',
          email: 'partner-one@example.test',
        },
        last_message: firstMessages[firstMessages.length - 1],
        has_unread: false,
      }]
    },
    body(index: number) { return `private-seed-${String(index).padStart(2, '0')}` },
  }
}

async function installProjectMocks(page: Page, id: string) {
  let currentUserId: string | null = null
  let messages: Message[] = []

  await page.route('**/api/projects/chat/unread', route =>
    json(route, 200, {
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
    return json(route, 200, { ok: true, lastReadAt: new Date().toISOString(), readStates: [] })
  })
  await page.route(`**/api/projects/${id}/chat/messages**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === `/api/projects/${id}/chat/messages` && request.method() === 'GET') {
      return json(route, 200, { items: messages.slice().reverse(), nextCursor: null })
    }
    if (path === `/api/projects/${id}/chat/messages` && request.method() === 'POST') {
      const body = request.postDataJSON() as { body?: string }
      const authorId = currentUserId ?? PROJECT_PEER_ID
      const item = message(
        20_000 + messages.length,
        body.body ?? '',
        authorId,
        new Date().toISOString(),
        { id: authorId, full_name: 'Test Admin', email: 'admin@example.test' },
        { projectId: id },
      )
      messages.push(item)
      return json(route, 201, { item })
    }
    if (request.method() === 'DELETE') return json(route, 200, { ok: true })
    if (request.method() === 'PATCH') {
      return json(route, 200, { item: messages.find(row => row.id === path.split('/').pop()) ?? null })
    }
    return json(route, 200, { item: null })
  })

  return {
    setFixture(userId: string) {
      currentUserId = userId
      messages = seededMessages('project', userId, { projectId: id })
    },
    body(index: number) { return `project-seed-${String(index).padStart(2, '0')}` },
  }
}

async function openPrivateChat(page: Page) {
  const mocks = await installPrivateMocks(page)
  await autentifica(page, 'admin')
  mocks.setFixture(await signedInUserId(page))
  await page.goto('/chat', { waitUntil: 'networkidle' })
  await page.locator('aside').getByRole('button', { name: /Test Partner One/ }).click()
  const scope = page.getByPlaceholder('Scrie un mesaj...').locator('xpath=ancestor::section[1]')
  await expect(scope.getByText(mocks.body(0), { exact: true })).toBeVisible()
  return { scope, body: mocks.body }
}

async function openProjectChat(page: Page, id: string, alreadySignedIn = false) {
  const mocks = await installProjectMocks(page, id)
  if (!alreadySignedIn) await autentifica(page, 'admin')
  mocks.setFixture(await signedInUserId(page))
  await page.goto(`/projects/${id}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^Chat/ }).first().click()
  const scope = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'Chat proiect' }) })
  await expect(scope.getByRole('heading', { name: 'Chat proiect' })).toBeVisible()
  await expect(scope.getByText(mocks.body(0), { exact: true })).toBeVisible()
  return { scope, body: mocks.body }
}

function messageRow(messageText: Locator) {
  return messageText.locator(
    'xpath=ancestor::*[.//button[@aria-label="Opțiuni mesaj"] or .//button[.//svg[contains(@class,"lucide-ellipsis") or contains(@class,"lucide-more-horizontal")]]][1]',
  )
}

async function setMessageScrollerEdge(messageText: Locator, edge: 'top' | 'bottom') {
  const found = await messageText.evaluate((messageElement, requestedEdge) => {
    let element = messageElement.parentElement
    while (element) {
      const overflowY = getComputedStyle(element).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
        element.scrollTop = requestedEdge === 'top'
          ? element.scrollTop + messageElement.getBoundingClientRect().top - element.getBoundingClientRect().top - 16
          : element.scrollHeight
        return true
      }
      element = element.parentElement
    }
    return false
  }, edge)
  if (!found) throw new Error('Firul de mesaje nu are un scroller vertical')
}

/**
 * Așteaptă ca firul să nu se mai miște: după încărcare, conversația mai crește
 * cu câțiva pixeli (stări de citire, imagini), iar lipirea de capăt o urmează.
 * Altfel prima măsurătoare prinde scrollerul cu 2–3 px înainte de capăt.
 */
async function waitForStableScroller(messageText: Locator) {
  let previous = ''
  await expect.poll(async () => {
    const current = await messageText.evaluate((messageElement) => new Promise<string>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        let element = messageElement.parentElement
        while (element) {
          const overflowY = getComputedStyle(element).overflowY
          if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
            resolve(`${element.scrollHeight}:${element.scrollTop}`)
            return
          }
          element = element.parentElement
        }
        resolve('')
      }))
    }))
    const stable = current !== '' && current === previous
    previous = current
    return stable
  }, { message: 'firul de mesaje nu se mai mișcă' }).toBe(true)
}

async function scrollMetrics(messageText: Locator) {
  return messageText.evaluate((messageElement) => {
    let element = messageElement.parentElement
    while (element) {
      const overflowY = getComputedStyle(element).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
        const rect = element.getBoundingClientRect()
        return {
          scrollTop: element.scrollTop,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        }
      }
      element = element.parentElement
    }
    return null
  })
}

async function expectFullyTouchable(locator: Locator, page: Page) {
  await expect(locator).toBeVisible()
  const visibility = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const samples = [0.2, 0.5, 0.8]
    let hitCount = 0
    for (const yFraction of samples) {
      for (const xFraction of samples) {
        const hit = document.elementFromPoint(
          rect.left + rect.width * xFraction,
          rect.top + rect.height * yFraction,
        )
        if (hit && element.contains(hit)) hitCount += 1
      }
    }
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      hitCount,
    }
  })
  expect(visibility.left).toBeGreaterThanOrEqual(0)
  expect(visibility.top).toBeGreaterThanOrEqual(0)
  expect(visibility.right).toBeLessThanOrEqual(visibility.width + 1)
  expect(visibility.bottom).toBeLessThanOrEqual(visibility.height + 1)
  expect(visibility.hitCount, 'meniul trebuie să poată fi apăsat în toată suprafața opțiunii').toBe(9)
  void page
}

async function checkMenuAtEdge(
  page: Page,
  scope: Locator,
  body: string,
  edge: 'top' | 'bottom',
  action: 'edit' | 'delete',
) {
  const messageText = scope.getByText(body, { exact: true })
  await expect(messageText).toBeVisible()
  await setMessageScrollerEdge(messageText, edge)
  await expect(messageText).toBeInViewport()

  const row = messageRow(messageText)
  const trigger = row.locator('button').first()
  await messageText.hover()
  await waitForStableScroller(messageText)
  const before = await scrollMetrics(messageText)
  if (!before) throw new Error('Nu am putut citi poziția scrollerului de mesaje')
  const pageScrollBefore = await page.evaluate(() => window.scrollY)

  await trigger.click()
  const editButton = page.getByRole('menuitem', { name: 'Editează', exact: true })
    .or(page.getByRole('button', { name: 'Editează', exact: true }))
  const deleteButton = page.getByRole('menuitem', { name: 'Șterge', exact: true })
    .or(page.getByRole('button', { name: 'Șterge', exact: true }))
  await expect(editButton).toBeVisible()
  await expect(deleteButton).toBeVisible()
  await expectFullyTouchable(editButton, page)
  await expectFullyTouchable(deleteButton, page)

  const after = await scrollMetrics(messageText)
  expect(after?.scrollTop).toBe(before.scrollTop)
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore)
  await expect(editButton).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(deleteButton).toBeFocused()
  await page.screenshot({ path: test.info().outputPath(`menu-${edge}.png`), animations: 'disabled' })

  if (action === 'edit') {
    await editButton.click()
    const editor = row.locator('textarea')
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue(body)
    await row.getByRole('button', { name: 'Anulează' }).click()
  } else {
    await deleteButton.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Anulează' }).last().click()
  }
}

test.describe('Meniurile acțiunilor mesajelor rămân la îndemână', () => {
  test('chatul privat păstrează meniul complet vizibil sus și jos', async ({ page }) => {
    const chat = await openPrivateChat(page)

    await checkMenuAtEdge(page, chat.scope, chat.body(16), 'top', 'edit')
    await checkMenuAtEdge(page, chat.scope, chat.body(31), 'bottom', 'delete')
  })

  test('chatul proiectului păstrează meniul vizibil sus/jos și în ambele aliniamente', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește din configurația UI')
    const chat = await openProjectChat(page, projectId!)

    // Mesajul din mijloc aparține colegului (stânga), ultimul utilizatorului curent (dreapta).
    await checkMenuAtEdge(page, chat.scope, chat.body(16), 'top', 'edit')
    await checkMenuAtEdge(page, chat.scope, chat.body(31), 'bottom', 'delete')
  })

  test('opțiunile încap și pe un ecran de 390×360 fără scroll suplimentar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 360 })
    const privateChat = await openPrivateChat(page)
    await checkMenuAtEdge(page, privateChat.scope, privateChat.body(16), 'top', 'edit')
    await checkMenuAtEdge(page, privateChat.scope, privateChat.body(31), 'bottom', 'delete')
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește din configurația UI')
    const projectChat = await openProjectChat(page, projectId!, true)
    await checkMenuAtEdge(page, projectChat.scope, projectChat.body(16), 'top', 'edit')
    await checkMenuAtEdge(page, projectChat.scope, projectChat.body(31), 'bottom', 'delete')
  })
})
