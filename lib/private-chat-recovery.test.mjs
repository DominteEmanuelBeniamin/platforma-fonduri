import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadTsModule } from './project-chat-test-helpers.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function response(payload, ok = true, status = ok ? 200 : 503) {
  return { ok, status, json: async () => payload }
}

function sameDependencies(left, right) {
  return left === right || (
    Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  )
}

class EventTargetDouble {
  constructor() { this.listeners = new Map() }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type })
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0)
  }
}

class ControlledTimers {
  constructor() {
    this.now = 0
    this.nextId = 1
    this.jobs = new Map()
    this.setTimeout = (callback, delay = 0) => this.add(callback, delay, false)
    this.clearTimeout = id => this.jobs.delete(id)
    this.setInterval = (callback, delay = 0) => this.add(callback, delay, true)
    this.clearInterval = id => this.jobs.delete(id)
  }
  add(callback, delay, interval) {
    const id = this.nextId++
    const duration = Math.max(1, Number(delay) || 0)
    this.jobs.set(id, { id, callback, delay: duration, due: this.now + duration, interval })
    return id
  }
  async advance(duration) {
    const end = this.now + duration
    let executions = 0
    while (true) {
      const next = [...this.jobs.values()]
        .filter(job => job.due <= end)
        .sort((a, b) => a.due - b.due)[0]
      if (!next) break
      if (++executions > 500) throw new Error('controlled timer runaway')
      this.now = next.due
      if (next.interval) next.due += next.delay
      else this.jobs.delete(next.id)
      next.callback()
    }
    this.now = end
  }
}

function createSupabaseDouble() {
  const channels = []
  const supabase = {
    channel(name) {
      const channel = {
        name,
        active: true,
        callbacks: [],
        on(_event, filter, callback) {
          this.callbacks.push({ filter, callback })
          return this
        },
        subscribe(callback) {
          this.statusCallback = callback
          return this
        },
        status(status) {
          if (this.active) this.statusCallback?.(status)
          return this
        },
        async emit(table, event, payload) {
          if (!this.active) return
          const callbacks = this.callbacks
            .filter(entry => entry.filter.table === table && (entry.filter.event === '*' || entry.filter.event === event))
            .map(entry => entry.callback(payload))
          await Promise.all(callbacks)
        },
      }
      channels.push(channel)
      return channel
    },
    removeChannel(channel) {
      channel.active = false
      return Promise.resolve('ok')
    },
  }
  return { supabase, channels }
}

function createHookHost() {
  const timers = new ControlledTimers()
  const window = new EventTargetDouble()
  const document = new EventTargetDouble()
  const navigator = { onLine: true }
  window.navigator = navigator
  window.setTimeout = timers.setTimeout
  window.clearTimeout = timers.clearTimeout
  window.setInterval = timers.setInterval
  window.clearInterval = timers.clearInterval
  document.visibilityState = 'visible'
  const { supabase, channels } = createSupabaseDouble()
  const host = {
    hooks: [],
    effects: new Map(),
    pendingEffects: [],
    cursor: 0,
    mounted: false,
    scheduled: false,
    renderFunction: null,
    value: null,
    window,
    document,
    navigator,
    timers,
    supabase,
    channels,
    calls: [],
    queuedResponses: [],
    currentMessages: [],
    messageCursorIndexes: new Map(),
    messageCursorSerial: 0,
    currentSummary: { hasUnread: false, unreadConversationCount: 0 },
    currentConversations: [],
    auth: null,
    apiFetch: async (url, options = {}) => {
      host.calls.push({ url, options })
      const queuedIndex = host.queuedResponses.findIndex(entry => entry.matches(url, options))
      if (queuedIndex >= 0) {
        const [queued] = host.queuedResponses.splice(queuedIndex, 1)
        return typeof queued.value === 'function' ? queued.value(url, options) : queued.value
      }
      return host.defaultResponse(url, options)
    },
    defaultResponse(url, options = {}) {
      const method = options.method ?? 'GET'
      if (url === '/api/private-conversations/unread') return response(host.currentSummary)
      if (url === '/api/private-conversations') return response({ items: host.currentConversations })
      const messageList = url.match(/^\/api\/private-conversations\/([^/]+)\/messages(?:\?|$)/)
      if (messageList && method === 'GET') {
        const descending = host.currentMessages.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
        const parsedUrl = new URL(url, 'http://localhost')
        const requestedLimit = Number(parsedUrl.searchParams.get('limit'))
        const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 50
        const cursor = parsedUrl.searchParams.get('cursor')
        const start = cursor === null ? 0 : host.messageCursorIndexes.get(cursor)
        if (start === undefined) return response({ error: 'Invalid cursor' }, false, 400)
        const items = descending.slice(start, start + limit)
        let nextCursor = null
        if (start + limit < descending.length) {
          nextCursor = `opaque cursor :: ${++host.messageCursorSerial}`
          host.messageCursorIndexes.set(nextCursor, start + limit)
        }
        return response({ items, nextCursor })
      }
      const messageById = url.match(/^\/api\/private-conversations\/([^/]+)\/messages\/([^/?]+)/)
      if (messageById && method === 'GET') {
        const item = host.currentMessages.find(message => message.id === messageById[2]) ?? null
        return item ? response({ item }) : response({ error: 'Not found' }, false, 404)
      }
      if (/^\/api\/private-conversations\/[^/]+\/read$/.test(url) && method === 'GET') {
        return response({ ok: true, lastReadAt: null, otherLastReadAt: null })
      }
      return response({ ok: true })
    },
    enqueue(value, predicate = () => true) {
      host.queuedResponses.push({ value, matches: predicate })
    },
    scheduleRender() {
      if (!host.mounted || host.scheduled) return
      host.scheduled = true
      queueMicrotask(() => {
        host.scheduled = false
        if (host.mounted) host.render()
      })
    },
    render() {
      if (!host.mounted) return
      host.cursor = 0
      host.pendingEffects = []
      host.value = host.renderFunction()
      for (const { index, effect, dependencies } of host.pendingEffects) {
        const previous = host.effects.get(index)
        if (previous && dependencies !== undefined && sameDependencies(previous.dependencies, dependencies)) continue
        previous?.cleanup?.()
        const cleanup = effect()
        host.effects.set(index, { dependencies, effect, cleanup })
      }
    },
    replayEffects() {
      for (const entry of host.effects.values()) entry.cleanup?.()
      for (const [index, entry] of host.effects) {
        const cleanup = entry.effect()
        host.effects.set(index, { ...entry, cleanup })
      }
    },
    async settle() {
      for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve))
    },
    async mount(renderFunction) {
      host.renderFunction = renderFunction
      host.mounted = true
      host.render()
      await host.settle()
    },
    async setArgs(renderFunction) {
      host.renderFunction = renderFunction
      host.render()
      await host.settle()
    },
    async setAuth(values) {
      host.auth = { ...host.auth, ...values, apiFetch: host.apiFetch }
      host.render()
      await host.settle()
    },
    async unmount() {
      host.mounted = false
      for (const entry of host.effects.values()) entry.cleanup?.()
      host.effects.clear()
      await host.settle()
    },
  }

  host.auth = { loading: false, token: 'session-a', userId: 'user-a', apiFetch: host.apiFetch }
  host.react = {
    useState(initial) {
      const index = host.cursor++
      if (!host.hooks[index]) {
        host.hooks[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = host.hooks[index]
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (Object.is(slot.value, value)) return
        slot.value = value
        host.scheduleRender()
      }]
    },
    useRef(initial) {
      const index = host.cursor++
      if (!host.hooks[index]) host.hooks[index] = { kind: 'ref', value: { current: initial } }
      return host.hooks[index].value
    },
    useCallback(callback, dependencies) {
      const index = host.cursor++
      const previous = host.hooks[index]
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
        host.hooks[index] = { kind: 'callback', dependencies, value: callback }
      }
      return host.hooks[index].value
    },
    useMemo(factory, dependencies) {
      const index = host.cursor++
      const previous = host.hooks[index]
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
        host.hooks[index] = { kind: 'memo', dependencies, value: factory() }
      }
      return host.hooks[index].value
    },
    useEffect(effect, dependencies) {
      const index = host.cursor++
      host.pendingEffects.push({ index, effect, dependencies })
    },
  }
  host.stubs = {
    react: host.react,
    '@/lib/supabaseClient': { supabase },
    '@/app/providers/AuthProvider': { useAuth: () => host.auth },
    '@/lib/user-error': { userErrorMessage: (_status, fallback) => fallback },
  }
  host.globals = {
    window,
    document,
    navigator,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    console,
    AbortController,
  }
  return host
}

async function loadHooks(host) {
  const [chat, unread, conversations] = await Promise.all([
    loadTsModule(resolve(root, 'hooks/usePrivateChat.ts'), host.stubs, host.globals),
    loadTsModule(resolve(root, 'hooks/usePrivateChatUnread.ts'), host.stubs, host.globals),
    loadTsModule(resolve(root, 'hooks/usePrivateConversations.ts'), host.stubs, host.globals),
  ])
  return { chat, unread, conversations }
}

function makeMessage(id, createdAt, createdBy = 'peer', body = id, overrides = {}) {
  return {
    id,
    conversation_id: 'conversation-a',
    created_by: createdBy,
    body,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    profiles: { id: createdBy, full_name: createdBy, email: null },
    ...overrides,
  }
}

function makeConversation(id, unread = true) {
  return {
    id,
    created_at: '2026-10-01T00:00:00.000Z',
    created_by: 'user-a',
    last_message_at: '2026-10-02T00:00:00.000Z',
    last_read_at: null,
    other_last_read_at: null,
    other_user: { id: `peer-${id}`, full_name: `Peer ${id}`, email: null },
    last_message: {
      id: `last-${id}`,
      body: `body-${id}`,
      created_at: '2026-10-02T00:00:00.000Z',
      created_by: unread ? `peer-${id}` : 'user-a',
    },
  }
}

async function signal(host, callback) {
  callback()
  await host.timers.advance(1_000)
  await host.settle()
}

function privateMessageChannel(host, conversationId) {
  const channel = host.channels.find(item => item.active && item.callbacks.some(({ filter }) => (
    filter.table === 'private_messages' && filter.filter === `conversation_id=eq.${conversationId}`
  )))
  assert.ok(channel, `active message subscription for ${conversationId}`)
  return channel
}

test('private chat recovers missed messages on reconnect and browser wakeups without replacing history', async () => {
  const host = createHookHost()
  const { chat } = await loadHooks(host)
  const old = makeMessage('old', '2026-10-18T10:00:00.000Z')
  host.currentMessages = [old]
  const renderChat = () => chat.usePrivateChat('conversation-a', { initialLimit: 50 })
  await host.mount(renderChat)
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['old'])
  const channel = privateMessageChannel(host, 'conversation-a')

  const reconnectArrival = makeMessage('after-connect', '2026-10-18T10:01:00.000Z')
  host.currentMessages = [reconnectArrival, old]
  channel.status('SUBSCRIBED')
  await host.settle()
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['old', 'after-connect'])

  const focusArrival = makeMessage('after-focus', '2026-10-18T10:02:00.000Z')
  host.currentMessages = [focusArrival, reconnectArrival, old]
  await signal(host, () => host.window.emit('focus'))
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['old', 'after-connect', 'after-focus'])

  const visibleArrival = makeMessage('after-visible', '2026-10-18T10:03:00.000Z')
  host.currentMessages = [visibleArrival, focusArrival, reconnectArrival, old]
  host.document.visibilityState = 'hidden'
  host.document.emit('visibilitychange')
  host.document.visibilityState = 'visible'
  await signal(host, () => host.document.emit('visibilitychange'))
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['old', 'after-connect', 'after-focus', 'after-visible'])

  const onlineArrival = makeMessage('after-online', '2026-10-18T10:04:00.000Z')
  host.currentMessages = [onlineArrival, visibleArrival, focusArrival, reconnectArrival, old]
  host.navigator.onLine = false
  host.navigator.onLine = true
  await signal(host, () => host.window.emit('online'))
  assert.deepEqual(Array.from(host.value.messages, message => message.id), [
    'old', 'after-connect', 'after-focus', 'after-visible', 'after-online',
  ])
  assert.equal(new Set(host.value.messages.map(message => message.id)).size, 5)
  await host.unmount()
})

test('private chat applies message edits, deletions, and updated read receipts from realtime', async () => {
  const host = createHookHost()
  const { chat } = await loadHooks(host)
  const original = makeMessage('message-1', '2026-10-18T10:00:00.000Z')
  host.currentMessages = [original]
  await host.mount(() => chat.usePrivateChat('conversation-a'))
  const channel = privateMessageChannel(host, 'conversation-a')

  const edited = makeMessage('message-1', original.created_at, 'peer', 'edited body', {
    edited_at: '2026-10-18T10:01:00.000Z',
  })
  host.currentMessages = [edited]
  await channel.emit('private_messages', 'UPDATE', { new: { id: 'message-1', deleted_at: null } })
  await host.settle()
  assert.equal(host.value.messages.find(message => message.id === 'message-1')?.body, 'edited body')

  const receiptAt = '2026-10-18T10:02:00.000Z'
  await channel.emit('private_conversation_participants', 'UPDATE', {
    new: { user_id: 'peer', last_read_at: receiptAt },
  })
  await host.settle()
  assert.equal(host.value.otherLastReadAt, receiptAt)

  await channel.emit('private_messages', 'UPDATE', {
    new: { id: 'message-1', deleted_at: '2026-10-18T10:03:00.000Z' },
  })
  await host.settle()
  assert.ok(host.value.messages.find(message => message.id === 'message-1')?.deleted_at)
  await host.unmount()
})

test('a failed or missed-message refresh recovers while visible and keeps already loaded history', async () => {
  const host = createHookHost()
  const { chat } = await loadHooks(host)
  const old = makeMessage('already-loaded', '2026-10-18T10:00:00.000Z')
  host.currentMessages = [old]
  await host.mount(() => chat.usePrivateChat('conversation-a'))
  const channel = privateMessageChannel(host, 'conversation-a')

  const newMessage = makeMessage('missed-during-outage', '2026-10-18T10:01:00.000Z')
  host.currentMessages = [newMessage, old]
  host.enqueue(response({ error: 'temporary failure' }, false), url => url.includes('/messages?'))
  channel.status('SUBSCRIBED')
  await host.settle()
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['already-loaded'])

  await host.timers.advance(60_000)
  await host.settle()
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['already-loaded', 'missed-during-outage'])
  await host.unmount()
})

test('reconnect catches a gap larger than initialLimit across opaque cursor pages', async () => {
  const host = createHookHost()
  const { chat } = await loadHooks(host)
  const history = makeMessage('loaded-history', '2026-10-18T10:00:00.000Z')
  host.currentMessages = [history]
  await host.mount(() => chat.usePrivateChat('conversation-a', { initialLimit: 50 }))
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['loaded-history'])

  const gap = Array.from({ length: 75 }, (_, index) => makeMessage(
    `missed-${index}`,
    new Date(Date.parse('2026-10-18T10:01:00.000Z') + index * 1_000).toISOString(),
  ))
  host.currentMessages = [...gap, history]
  const channel = privateMessageChannel(host, 'conversation-a')
  channel.status('SUBSCRIBED')
  await host.timers.advance(1_000)
  await host.settle()

  const actualIds = Array.from(host.value.messages, message => message.id)
  const expectedIds = ['loaded-history', ...gap.map(message => message.id)]
  assert.equal(actualIds.length, expectedIds.length)
  assert.deepEqual(new Set(actualIds), new Set(expectedIds))
  assert.equal(new Set(actualIds).size, actualIds.length)
  await host.unmount()
})

test('unread summary and conversation list refresh on reconnect, focus, visibility, and online', async () => {
  const host = createHookHost()
  const { unread, conversations } = await loadHooks(host)
  host.currentSummary = { hasUnread: true, unreadConversationCount: 1 }
  host.currentConversations = [makeConversation('one')]
  await host.mount(() => ({
    summary: unread.usePrivateChatUnread(true),
    list: conversations.usePrivateConversations(),
  }))
  await host.timers.advance(1)
  await host.settle()

  const assertConsistent = () => {
    const unreadFromList = host.value.list.items.filter(host.value.list.getIsUnread).length
    assert.equal(host.value.summary.unreadConversationCount, unreadFromList)
    assert.equal(host.value.summary.hasUnread, unreadFromList > 0)
  }
  assert.equal(host.value.list.items.length, 1)
  assertConsistent()

  const replaceWithTwoUnread = () => {
    host.currentSummary = { hasUnread: true, unreadConversationCount: 2 }
    host.currentConversations = [makeConversation('one'), makeConversation('two')]
  }

  const channels = [...host.channels]
  replaceWithTwoUnread()
  for (const channel of channels) channel.status('SUBSCRIBED')
  await host.timers.advance(250)
  await host.settle()
  assert.equal(host.value.list.items.length, 2)
  assertConsistent()

  host.currentSummary = { hasUnread: true, unreadConversationCount: 3 }
  host.currentConversations = [...host.currentConversations, makeConversation('three')]
  await signal(host, () => host.window.emit('focus'))
  assert.equal(host.value.list.items.length, 3)
  assertConsistent()

  host.currentSummary = { hasUnread: false, unreadConversationCount: 0 }
  host.currentConversations = host.currentConversations.map(item => makeConversation(item.id, false))
  host.document.visibilityState = 'visible'
  await signal(host, () => host.document.emit('visibilitychange'))
  assertConsistent()

  host.currentSummary = { hasUnread: true, unreadConversationCount: 1 }
  host.currentConversations = [makeConversation('four')]
  host.navigator.onLine = false
  host.navigator.onLine = true
  await signal(host, () => host.window.emit('online'))
  assert.equal(host.value.list.items.length, 1)
  assertConsistent()
  await host.unmount()
})

test('unread summary keeps its last good value on failure and recovers missed events within 60 seconds', async () => {
  const host = createHookHost()
  const { unread } = await loadHooks(host)
  host.currentSummary = { hasUnread: true, unreadConversationCount: 2 }
  await host.mount(() => unread.usePrivateChatUnread(true))
  await host.timers.advance(1)
  await host.settle()
  assert.equal(host.value.unreadConversationCount, 2)

  host.enqueue(response({ error: 'temporary failure' }, false), url => url === '/api/private-conversations/unread')
  host.channels[0].status('SUBSCRIBED')
  await host.settle()
  assert.equal(host.value.unreadConversationCount, 2)

  host.currentSummary = { hasUnread: true, unreadConversationCount: 5 }
  await host.timers.advance(60_000)
  await host.settle()
  assert.equal(host.value.unreadConversationCount, 5)
  await host.unmount()
})

test('unread signals during a pending summary request are deduplicated and followed by a fresh read', async () => {
  const host = createHookHost()
  const { unread } = await loadHooks(host)
  const pending = deferred()
  host.enqueue(() => pending.promise, url => url === '/api/private-conversations/unread')
  await host.mount(() => unread.usePrivateChatUnread(true))
  await host.timers.advance(1)
  await host.settle()
  const initialCount = host.calls.filter(call => call.url === '/api/private-conversations/unread').length
  assert.equal(initialCount, 1)

  const channel = host.channels[0]
  channel.status('SUBSCRIBED')
  host.window.emit('focus')
  host.document.visibilityState = 'visible'
  host.document.emit('visibilitychange')
  host.window.emit('online')
  await host.settle()
  assert.equal(host.calls.filter(call => call.url === '/api/private-conversations/unread').length, 1)

  host.currentSummary = { hasUnread: true, unreadConversationCount: 4 }
  pending.resolve(response({ hasUnread: true, unreadConversationCount: 1 }))
  await host.settle()
  await host.timers.advance(1_000)
  await host.settle()
  assert.ok(host.calls.filter(call => call.url === '/api/private-conversations/unread').length >= 2)
  assert.equal(host.value.unreadConversationCount, 4)
  await host.unmount()
})

test('a recovery signal during a conversations request causes one follow-up read', async () => {
  const host = createHookHost()
  const { conversations } = await loadHooks(host)
  host.currentConversations = [makeConversation('before')]
  await host.mount(() => conversations.usePrivateConversations())
  assert.deepEqual(Array.from(host.value.items, item => item.id), ['before'])

  const firstResponse = deferred()
  host.enqueue(() => firstResponse.promise, url => url === '/api/private-conversations')
  const pendingRefresh = host.value.refresh()
  const initialListCalls = host.calls.filter(call => call.url === '/api/private-conversations').length
  host.currentConversations = [makeConversation('after')]
  await signal(host, () => host.window.emit('focus'))
  assert.equal(host.calls.filter(call => call.url === '/api/private-conversations').length, initialListCalls)

  firstResponse.resolve(response({ items: [makeConversation('stale-response')] }))
  await pendingRefresh
  await host.timers.advance(500)
  await host.settle()
  assert.equal(host.calls.filter(call => call.url === '/api/private-conversations').length, initialListCalls + 1)
  assert.deepEqual(Array.from(host.value.items, item => item.id), ['after'])
  await host.unmount()
})

test('conversation or session changes discard stale results from the previous scope', async () => {
  const host = createHookHost()
  const { chat, unread, conversations } = await loadHooks(host)
  let conversationId = 'conversation-a'
  const oldMessage = makeMessage('old-session-message', '2026-10-18T10:00:00.000Z')
  const newMessage = makeMessage('new-conversation-message', '2026-10-18T10:01:00.000Z', 'peer', 'new-conversation-message', {
    conversation_id: 'conversation-b',
  })
  host.currentMessages = [oldMessage]
  const staleInitial = deferred()
  host.enqueue(() => staleInitial.promise, url => url.includes('/conversation-a/messages?'))
  const renderAll = () => ({
    chat: chat.usePrivateChat(conversationId),
    summary: unread.usePrivateChatUnread(true),
    list: conversations.usePrivateConversations(),
  })
  await host.mount(renderAll)

  conversationId = 'conversation-b'
  host.currentMessages = [newMessage]
  await host.setArgs(renderAll)
  assert.deepEqual(Array.from(host.value.chat.messages, message => message.id), ['new-conversation-message'])
  staleInitial.resolve(response({ items: [oldMessage], nextCursor: null }))
  await host.settle()
  assert.deepEqual(Array.from(host.value.chat.messages, message => message.id), ['new-conversation-message'])

  await host.setAuth({ token: null, userId: null })
  assert.deepEqual(Array.from(host.value.chat.messages), [])
  assert.equal(host.value.summary.unreadConversationCount, 0)
  assert.deepEqual(Array.from(host.value.list.items), [])
  host.currentSummary = { hasUnread: true, unreadConversationCount: 3 }
  host.currentConversations = [makeConversation('new-user')]
  await host.setAuth({ token: 'session-b', userId: 'user-b' })
  await host.timers.advance(1)
  await host.settle()
  assert.equal(host.value.summary.unreadConversationCount, 3)
  assert.deepEqual(Array.from(host.value.list.items, item => item.id), ['new-user'])
  await host.unmount()
})

test('StrictMode effect replay remains active once and unmount cancels pending recovery work', async () => {
  const host = createHookHost()
  const { chat, unread, conversations } = await loadHooks(host)
  host.currentMessages = [makeMessage('history', '2026-10-18T10:00:00.000Z')]
  host.currentSummary = { hasUnread: true, unreadConversationCount: 1 }
  host.currentConversations = [makeConversation('one')]
  const renderAll = () => ({
    chat: chat.usePrivateChat('conversation-a'),
    summary: unread.usePrivateChatUnread(true),
    list: conversations.usePrivateConversations(),
  })
  await host.mount(renderAll)
  await host.timers.advance(1)
  await host.settle()
  host.replayEffects()
  await host.settle()
  assert.equal(host.channels.filter(channel => channel.active).length, 3)

  const chatChannel = privateMessageChannel(host, 'conversation-a')
  const pendingMessage = deferred()
  host.enqueue(() => pendingMessage.promise, url => url.includes('/messages?'))
  const queuedLookup = chatChannel.emit('private_messages', 'INSERT', { new: { id: 'queued-arrival', deleted_at: null } })
  await host.settle()
  chatChannel.status('SUBSCRIBED')
  await host.settle()
  const callsBeforeUnmount = host.calls.length

  await host.unmount()
  assert.equal(host.window.listenerCount + host.document.listenerCount, 0)
  assert.equal(host.timers.jobs.size, 0)
  assert.equal(host.channels.filter(channel => channel.active).length, 0)
  pendingMessage.resolve(response({ items: [makeMessage('queued-arrival', '2026-10-18T10:01:00.000Z')], nextCursor: null }))
  await queuedLookup
  await host.settle()
  assert.equal(host.calls.length, callsBeforeUnmount)
})

test('a late send response from a previous conversation does not enter the active conversation', async () => {
  const host = createHookHost()
  const { chat } = await loadHooks(host)
  let conversationId = 'conversation-a'
  host.currentMessages = [makeMessage('history-a', '2026-10-18T10:00:00.000Z')]
  const renderChat = () => chat.usePrivateChat(conversationId)
  await host.mount(renderChat)
  const pending = deferred()
  host.enqueue(() => pending.promise, (url, options) => url.endsWith('/conversation-a/messages') && options.method === 'POST')
  const sending = host.value.sendMessage('message sent in A')

  conversationId = 'conversation-b'
  host.currentMessages = [makeMessage('history-b', '2026-10-18T10:01:00.000Z', 'peer', 'history-b', { conversation_id: conversationId })]
  await host.setArgs(renderChat)
  pending.resolve(response({ item: makeMessage('late-in-a', '2026-10-18T10:02:00.000Z', 'user-a') }))
  await sending
  await host.settle()
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['history-b'])
  assert.equal(host.value.sending, false)
  await host.unmount()
})

test('token rotation keeps history and releases a pending send from the previous session generation', async () => {
  const host = createHookHost()
  const { chat } = await loadHooks(host)
  host.currentMessages = [makeMessage('history', '2026-10-18T10:00:00.000Z')]
  await host.mount(() => chat.usePrivateChat('conversation-a'))
  const pending = deferred()
  host.enqueue(() => pending.promise, (url, options) => url.endsWith('/messages') && options.method === 'POST')
  const sending = host.value.sendMessage('pending at token rotation')
  await host.settle()
  assert.equal(host.value.sending, true)
  await host.setAuth({ token: 'rotated-token' })
  assert.equal(host.value.sending, false)
  assert.deepEqual(Array.from(host.value.messages, message => message.id), ['history'])
  pending.resolve(response({ item: makeMessage('sent-before-rotation', '2026-10-18T10:01:00.000Z', 'user-a') }))
  await sending
  await host.settle()
  assert.equal(host.value.sending, false)
  await host.unmount()
})

test('periodic recovery reconciles missed edits and deletions throughout loaded history', async () => {
  const host = createHookHost()
  const { chat } = await loadHooks(host)
  const old = makeMessage('old-to-edit', '2026-10-18T10:00:00.000Z')
  const removed = makeMessage('old-to-delete', '2026-10-18T10:01:00.000Z')
  const latest = makeMessage('latest', '2026-10-18T10:02:00.000Z')
  host.currentMessages = [latest, removed, old]
  await host.mount(() => chat.usePrivateChat('conversation-a', { initialLimit: 2 }))
  assert.equal(host.value.hasMore, true)
  await host.value.loadMore()
  await host.settle()
  assert.equal(host.value.messages.length, 3)
  host.currentMessages = [
    latest,
    { ...removed, body: null, deleted_at: '2026-10-18T10:03:00.000Z' },
    { ...old, body: 'recovered edit', edited_at: '2026-10-18T10:04:00.000Z' },
  ]
  await host.timers.advance(60_000)
  await host.settle()
  assert.equal(host.value.messages.find(message => message.id === old.id)?.body, 'recovered edit')
  assert.ok(host.value.messages.find(message => message.id === removed.id)?.deleted_at)
  assert.equal(host.value.hasMore, false)
  await host.unmount()
})

test('private unread comparison retains microsecond precision', async () => {
  const host = createHookHost()
  const { chat } = await loadHooks(host)
  host.currentMessages = [makeMessage('newer-by-one-microsecond', '2026-10-18T10:00:00.123457Z')]
  await host.mount(() => chat.usePrivateChat('conversation-a', { initialLastReadAt: '2026-10-18T10:00:00.123456Z' }))
  assert.equal(host.value.unreadCount, 1)
  await host.unmount()
})

test('the list honors server unread state when the preview is own and a partial local read does not clear it', async () => {
  const host = createHookHost()
  const { conversations } = await loadHooks(host)
  host.currentConversations = [{ ...makeConversation('own-preview', false), has_unread: true }]
  await host.mount(() => conversations.usePrivateConversations())
  assert.equal(host.value.getIsUnread(host.value.items[0]), true)

  host.value.markConversationReadLocally('own-preview', '2026-10-01T12:00:00.000Z')
  await host.settle()
  assert.equal(host.value.getIsUnread(host.value.items[0]), true)

  host.value.markConversationReadLocally('own-preview', '2026-10-02T00:00:00.000Z')
  await host.settle()
  assert.equal(host.value.getIsUnread(host.value.items[0]), false)
  await host.unmount()
})

test('private recovery pauses network polling while hidden or offline and refreshes on return', async () => {
  const host = createHookHost()
  const { chat, unread, conversations } = await loadHooks(host)
  host.currentMessages = [makeMessage('history', '2026-10-18T10:00:00.000Z')]
  await host.mount(() => ({
    chat: chat.usePrivateChat('conversation-a'),
    summary: unread.usePrivateChatUnread(true),
    list: conversations.usePrivateConversations(),
  }))
  host.document.visibilityState = 'hidden'
  host.document.emit('visibilitychange')
  await host.settle()
  const hiddenCalls = host.calls.length
  await host.timers.advance(90_000)
  await host.settle()
  assert.equal(host.calls.length, hiddenCalls)

  host.document.visibilityState = 'visible'
  host.document.emit('visibilitychange')
  await host.settle()
  assert.ok(host.calls.length > hiddenCalls)
  host.navigator.onLine = false
  host.window.emit('offline')
  await host.settle()
  const offlineCalls = host.calls.length
  await host.timers.advance(90_000)
  await host.settle()
  assert.equal(host.calls.length, offlineCalls)
  host.navigator.onLine = true
  host.window.emit('online')
  await host.settle()
  assert.ok(host.calls.length > offlineCalls)
  await host.unmount()
})

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
