import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page, type Request, type Route } from '@playwright/test'
import { autentifica } from './helpers'

test.setTimeout(120_000)

type Json = Record<string, unknown>
type ScrollMetrics = { self: boolean; index: number; top: number; height: number; clientHeight: number }

const CONVERSATION_ID = randomUUID()
const SELECTED_USER_NAME = 'Layout fixture selected peer'
const SENDER_ID = randomUUID()
const OLD_READ_AT = '2025-01-01T00:00:00.000000Z'
const OTHER_READ_AT = '2025-01-01T00:00:00.000000Z'

const conversations = Array.from({ length: 30 }, (_, index) => {
  const id = index === 17 ? CONVERSATION_ID : randomUUID()
  const peerId = randomUUID()
  const createdAt = new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString()
  const name = index === 17 ? SELECTED_USER_NAME : `Layout fixture peer ${String(index).padStart(2, '0')}`
  return {
    id,
    created_at: createdAt,
    created_by: SENDER_ID,
    last_message_at: createdAt,
    last_read_at: index === 17 ? null : OLD_READ_AT,
    other_last_read_at: OTHER_READ_AT,
    has_unread: false,
    other_user: { id: peerId, full_name: name, email: `${index}.layout-peer@example.invalid` },
    last_message: {
      id: randomUUID(),
      body: `Preview for ${name}`,
      created_at: createdAt,
      created_by: peerId,
    },
  }
})

const selectedConversation = conversations.find(item => item.id === CONVERSATION_ID)!
const messages = Array.from({ length: 100 }, (_, index) => {
  const createdAt = new Date(Date.UTC(2025, 0, 2, 0, index)).toISOString()
  const paragraph = `Layout fixture message ${String(index + 1).padStart(3, '0')} keeps enough words to wrap inside the chat bubble and exercise the message pane scrolling behavior. `
  return {
    id: randomUUID(),
    conversation_id: CONVERSATION_ID,
    created_by: selectedConversation.other_user.id,
    body: paragraph.repeat(3),
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    is_deleted: false,
    profiles: {
      id: selectedConversation.other_user.id,
      full_name: SELECTED_USER_NAME,
      email: 'selected.layout-peer@example.invalid',
      is_active: true,
    },
  }
})

let persistedReadAt: string | null = null
const unexpectedPrivateRoutes: string[] = []

function bodyForRequest(request: Request): Json {
  try {
    const body = request.postData()
    return body ? JSON.parse(body) as Json : {}
  } catch {
    return {}
  }
}

async function mockPrivateConversationApi(page: Page) {
  await page.route('**/api/private-conversations**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const segments = url.pathname.slice('/api/private-conversations'.length).split('/').filter(Boolean)
    let status = 200
    let payload: Json = {}

    if (segments.length === 0 && method === 'GET') {
      payload = { items: conversations }
    } else if (segments[0] === 'unread' && method === 'GET') {
      payload = { hasUnread: false, unreadConversationCount: 0 }
    } else if (segments[0] === 'users' && method === 'GET') {
      payload = { items: [] }
    } else if (segments[0] === CONVERSATION_ID && segments[1] === 'read' && method === 'GET') {
      payload = { ok: true, lastReadAt: persistedReadAt, otherLastReadAt: OTHER_READ_AT }
    } else if (segments[0] === CONVERSATION_ID && segments[1] === 'read' && method === 'POST') {
      const requested = bodyForRequest(request).readThroughAt
      persistedReadAt = typeof requested === 'string' ? requested : new Date().toISOString()
      payload = { ok: true, lastReadAt: persistedReadAt }
    } else if (segments[0] === CONVERSATION_ID && segments[1] === 'messages' && segments.length === 2 && method === 'GET') {
      payload = { items: messages.slice().reverse(), nextCursor: null }
    } else if (segments[0] === CONVERSATION_ID && segments[1] === 'messages' && segments.length === 3 && method === 'GET') {
      payload = { item: messages.find(message => message.id === segments[2]) ?? null }
      if (!payload.item) status = 404
    } else if (segments.length === 0 && method === 'POST') {
      payload = { item: { id: CONVERSATION_ID, created_at: OLD_READ_AT, created_by: SENDER_ID, last_message_at: null } }
    } else {
      unexpectedPrivateRoutes.push(`${method} ${url.pathname}`)
      status = 404
      payload = { error: 'Unexpected private conversation API request' }
    }

    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
  })
}

function conversationRow(page: Page) {
  return page.getByRole('button').filter({ hasText: SELECTED_USER_NAME }).first()
}

function chatThread(page: Page) {
  return page.locator('section').filter({ has: page.getByPlaceholder('Scrie un mesaj...') }).first()
}

async function scrollableInside(root: Locator): Promise<Locator> {
  const metrics = await root.evaluate((element): ScrollMetrics | null => {
    const nodes: HTMLElement[] = [element as HTMLElement, ...Array.from(element.querySelectorAll<HTMLElement>('*'))]
    const index = nodes.findIndex(node => {
      const style = getComputedStyle(node)
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1
    })
    if (index < 0) return null
    const node = nodes[index]
    return {
      self: index === 0,
      index,
      top: node.scrollTop,
      height: node.scrollHeight,
      clientHeight: node.clientHeight,
    }
  })
  if (!metrics) throw new Error('Expected an independently scrollable content pane')
  return metrics.self ? root : root.locator('*').nth(metrics.index - 1)
}

async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav, [role="navigation"]')
    const thread = [...document.querySelectorAll('section')]
      .find(section => section.querySelector('textarea[placeholder="Scrie un mesaj..."]'))
    const header = thread?.querySelector('h3')
    const editor = thread?.querySelector('textarea[placeholder="Scrie un mesaj..."]')
    const rect = (element: Element | null | undefined) => {
      if (!element) return null
      const { top, bottom, height } = element.getBoundingClientRect()
      return { top, bottom, height }
    }
    return {
      nav: rect(nav),
      thread: rect(thread),
      header: rect(header),
      editor: rect(editor),
      documentHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scrollY: window.scrollY,
    }
  })
}

async function expectThreadFitsBelowNavigation(page: Page) {
  const metrics = await layoutMetrics(page)
  expect(metrics.nav, 'the app navigation is visible').not.toBeNull()
  expect(metrics.thread, 'the selected chat thread is mounted').not.toBeNull()
  expect(metrics.header, 'the selected peer header is visible').not.toBeNull()
  expect(metrics.editor, 'the message editor is mounted').not.toBeNull()
  const navBottom = metrics.nav!.bottom
  expect(metrics.thread!.top).toBeGreaterThanOrEqual(navBottom - 1)
  expect(metrics.thread!.top - navBottom, 'chat starts directly below navigation').toBeLessThanOrEqual(24)
  expect(metrics.thread!.bottom).toBeLessThanOrEqual(metrics.clientHeight + 1)
  expect(metrics.thread!.bottom, 'chat fills the available height').toBeGreaterThanOrEqual(metrics.clientHeight - 24)
  expect(metrics.header!.top).toBeGreaterThanOrEqual(navBottom - 1)
  expect(metrics.header!.bottom).toBeLessThanOrEqual(metrics.clientHeight + 1)
  expect(metrics.editor!.top).toBeGreaterThanOrEqual(navBottom - 1)
  expect(metrics.editor!.bottom).toBeLessThanOrEqual(metrics.clientHeight + 1)
  expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.clientHeight + 1)
  expect(Math.abs(metrics.scrollY)).toBeLessThanOrEqual(1)
}

async function wheelOnlyTheThread(page: Page) {
  const beforePage = await page.evaluate(() => window.scrollY)
  const scroller = await scrollableInside(chatThread(page))
  const before = await scroller.evaluate((element: HTMLElement) => element.scrollTop)
  const box = await scroller.boundingBox()
  if (!box) throw new Error('Message pane has no visible box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, before > 0 ? -450 : 450)
  if (before > 0) {
    await expect.poll(() => scroller.evaluate((element: HTMLElement) => element.scrollTop)).toBeLessThan(before)
  } else {
    await expect.poll(() => scroller.evaluate((element: HTMLElement) => element.scrollTop)).toBeGreaterThan(before)
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(beforePage)
  await expectThreadFitsBelowNavigation(page)
}

test('private chat stays inside the viewport and scrolls in its own panes', async ({ page }) => {
  await mockPrivateConversationApi(page)
  await autentifica(page, 'staff')

  await page.setViewportSize({ width: 1440, height: 900 })
  const contentSpacing = () => page.locator('#continut').evaluate(element => {
    const style = getComputedStyle(element)
    return { top: style.paddingTop, bottom: style.paddingBottom, overflow: style.overflowY,
      maxWidth: getComputedStyle(element.firstElementChild!).maxWidth }
  })
  const originalSpacing = await contentSpacing()
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible()
  await expect(conversationRow(page)).toBeVisible()

  const conversationList = page.getByRole('complementary').first()
  const listScroller = await scrollableInside(conversationList)
  const listBefore = await listScroller.evaluate((element: HTMLElement) => element.scrollTop)
  const listBox = await listScroller.boundingBox()
  if (!listBox) throw new Error('Conversation list has no visible box')
  await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2)
  await page.mouse.wheel(0, 500)
  await expect.poll(() => listScroller.evaluate((element: HTMLElement) => element.scrollTop))
    .toBeGreaterThan(listBefore)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  await conversationRow(page).scrollIntoViewIfNeeded()
  await conversationRow(page).click()
  await expect(chatThread(page)).toBeVisible()
  await expect(chatThread(page).getByRole('heading', { name: SELECTED_USER_NAME })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/chat')
  await expect(page.getByPlaceholder('Caută utilizatori...')).toBeVisible()
  await expect(page.getByPlaceholder('Scrie un mesaj...')).toHaveCount(0)
  await conversationRow(page).click()
  await expect(chatThread(page)).toBeVisible()
  await page.getByRole('button', { name: 'Înapoi la conversații' }).click()
  await expect(page.getByPlaceholder('Caută utilizatori...')).toBeVisible()
  await conversationRow(page).click()
  await expect(chatThread(page)).toBeVisible()

  const draft = Array.from({ length: 6 }, (_, index) => `Draft line ${index + 1} stays within the composer`).join('\n')
  const editor = page.getByPlaceholder('Scrie un mesaj...')
  await editor.fill(draft)
  await expect(editor).toHaveValue(draft)
  await expectThreadFitsBelowNavigation(page)
  await wheelOnlyTheThread(page)

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 520 },
    { width: 844, height: 390 },
    { width: 390, height: 360 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(chatThread(page)).toBeVisible()
    await expect(editor).toBeVisible()
    await expectThreadFitsBelowNavigation(page)
    const editorHeight = await editor.evaluate(element => element.getBoundingClientRect().height)
    expect(editorHeight).toBeLessThanOrEqual(121)
    await wheelOnlyTheThread(page)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('navigation', { name: 'Navigare principală' }).getByRole('link', { name: /^Proiecte/ }).click()
  await page.waitForURL(url => url.pathname === '/')
  await expect.poll(contentSpacing, { message: 'normal page spacing returns after leaving chat' }).toEqual(originalSpacing)
  await page.getByRole('link', { name: /^Chat/ }).click()
  await page.waitForURL(url => url.pathname === '/chat')
  await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible()
  await expect(conversationRow(page)).toBeVisible()
  expect(unexpectedPrivateRoutes).toEqual([])
})
