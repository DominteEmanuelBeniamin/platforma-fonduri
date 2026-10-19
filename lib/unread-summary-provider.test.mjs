import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadTsModule } from './project-chat-test-helpers.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const factoryPath = resolve(root, 'app/providers/createUnreadSummaryProvider.tsx')

function response(payload, ok = true) {
  return { ok, json: async () => payload }
}

function payloadFor(kind, value) {
  return kind === 'chat'
    ? { hasUnread: value > 0, unreadProjectCount: value, unreadMessageCount: value, unreadProjects: [] }
    : { unreadCount: value, unreadByProject: [] }
}

function displayedCount(kind, value) {
  return kind === 'chat' ? value.unreadMessageCount : value.unreadCount
}

class EventTargetDouble {
  constructor() { this.listeners = new Map() }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }
  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type })
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0)
  }
}

class ControlledTimers {
  constructor() {
    this.time = 0
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
    this.jobs.set(id, { id, callback, delay: duration, due: this.time + duration, interval })
    return id
  }
  async advance(duration) {
    const end = this.time + duration
    let executions = 0
    while (true) {
      const next = [...this.jobs.values()].filter(job => job.due <= end).sort((a, b) => a.due - b.due)[0]
      if (!next) break
      if (++executions > 500) throw new Error('controlled timer runaway')
      this.time = next.due
      if (next.interval) next.due += next.delay
      else this.jobs.delete(next.id)
      next.callback()
    }
    this.time = end
  }
}

function createSupabaseDouble() {
  const channels = []
  const supabase = {
    channel(name) {
      const channel = {
        name,
        callbacks: [],
        active: true,
        on(_event, filter, callback) {
          this.callbacks.push({ filter, callback })
          return this
        },
        subscribe(callback) {
          this.statusCallback = callback
          return this
        },
        status(status) { this.statusCallback?.(status); return this },
        emitTable(table) {
          for (const entry of this.callbacks) {
            if (entry.filter.table === table) entry.callback({ table })
          }
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

function createReactDouble(host) {
  return {
    createContext(defaultValue) { return { Provider: {}, defaultValue } },
    useContext(context) { return context.defaultValue },
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
      const slot = host.hooks[index]
      if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
        host.hooks[index] = { kind: 'callback', dependencies, value: callback }
      }
      return host.hooks[index].value
    },
    useMemo(factory, dependencies) {
      const index = host.cursor++
      const slot = host.hooks[index]
      if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
        host.hooks[index] = { kind: 'memo', dependencies, value: factory() }
      }
      return host.hooks[index].value
    },
    useEffect(effect, dependencies) {
      const index = host.cursor++
      host.pendingEffects.push({ index, effect, dependencies })
    },
  }
}

function sameDependencies(left, right) {
  return left === right || (
    Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  )
}

function createHookHost(kind) {
  const timers = new ControlledTimers()
  const window = new EventTargetDouble()
  const navigator = { onLine: true }
  window.navigator = navigator
  window.setTimeout = timers.setTimeout
  window.clearTimeout = timers.clearTimeout
  window.setInterval = timers.setInterval
  window.clearInterval = timers.clearInterval
  const document = new EventTargetDouble()
  document.visibilityState = 'visible'
  const { supabase, channels } = createSupabaseDouble()
  const calls = []
  const queuedResponses = []
  const host = {
    kind,
    hooks: [],
    effects: new Map(),
    pendingEffects: [],
    cursor: 0,
    mounted: false,
    scheduled: false,
    value: null,
    Provider: null,
    window,
    document,
    navigator,
    timers,
    channels,
    calls,
    queuedResponses,
    currentPayload: payloadFor(kind, 7),
    auth: null,
    apiFetch: (url, options) => {
      calls.push({ url, options })
      const next = queuedResponses.shift()
      if (next) return typeof next === 'function' ? next() : Promise.resolve(next)
      return Promise.resolve(response(host.currentPayload))
    },
    enqueue(value) { queuedResponses.push(value) },
    scheduleRender() {
      if (!host.mounted || host.scheduled) return
      host.scheduled = true
      queueMicrotask(() => {
        host.scheduled = false
        if (host.mounted) host.render()
      })
    },
    render() {
      host.cursor = 0
      host.pendingEffects = []
      const element = host.Provider({ children: null })
      host.value = element.props.value
      for (const { index, effect, dependencies } of host.pendingEffects) {
        const previous = host.effects.get(index)
        if (previous && sameDependencies(previous.dependencies, dependencies)) continue
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
      for (let index = 0; index < 12; index++) {
        await new Promise(resolve => setImmediate(resolve))
      }
    },
    async mount(Provider) {
      host.Provider = Provider
      host.mounted = true
      host.render()
      await host.settle()
    },
    async setAuth(auth) {
      host.auth = { ...auth, apiFetch: host.apiFetch }
      host.render()
      await host.settle()
    },
    async unmount() {
      host.mounted = false
      for (const effect of host.effects.values()) effect.cleanup?.()
      host.effects.clear()
      await host.settle()
    },
  }
  host.auth = { loading: false, token: 'session-token', userId: 'user-a', apiFetch: host.apiFetch }
  const react = createReactDouble(host)
  const stubs = {
    react,
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    '@/lib/supabaseClient': { supabase },
    '@/app/providers/AuthProvider': { useAuth: () => host.auth },
  }
  const globals = {
    window,
    document,
    navigator,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    console,
  }
  host.factory = null
  host.stubs = stubs
  host.globals = globals
  return host
}

async function loadProvider(host, kind) {
  host.factory = await loadTsModule(factoryPath, host.stubs, host.globals)
  host.stubs['@/app/providers/createUnreadSummaryProvider'] = host.factory
  const file = kind === 'chat'
    ? 'app/providers/ProjectChatUnreadProvider.tsx'
    : 'app/providers/NotificationsProvider.tsx'
  const loadedProvider = await loadTsModule(resolve(root, file), host.stubs)
  return kind === 'chat' ? loadedProvider.ProjectChatUnreadProvider : loadedProvider.NotificationsProvider
}

async function eachProvider(run) {
  for (const kind of ['chat', 'notifications']) {
    await run(kind)
  }
}

test('both global summaries fetch initially and refresh on subscription, reconnection, focus, visibility, and online', async () => {
  await eachProvider(async kind => {
    const host = createHookHost(kind)
    const Provider = await loadProvider(host, kind)
    await host.mount(Provider)
    assert.equal(host.calls.length, 1, `${kind}: initial summary`)
    assert.equal(displayedCount(kind, host.value), 7)
    const [channel] = host.channels

    channel.status('SUBSCRIBED')
    await host.settle()
    assert.equal(host.calls.length, 2, `${kind}: first subscription`)
    channel.status('SUBSCRIBED')
    await host.settle()
    assert.equal(host.calls.length, 3, `${kind}: reconnect subscription`)

    host.window.emit('focus')
    await host.settle()
    assert.equal(host.calls.length, 4, `${kind}: focus`)
    host.document.visibilityState = 'visible'
    host.document.emit('visibilitychange')
    await host.settle()
    assert.equal(host.calls.length, 5, `${kind}: visible tab`)
    host.navigator.onLine = false
    assert.equal(host.navigator.onLine, false, `${kind}: the host can model an offline browser`)
    host.navigator.onLine = true
    host.window.emit('online')
    await host.settle()
    assert.equal(host.calls.length, 6, `${kind}: network online`)
    await host.unmount()
  })
})

test('both summaries retry a failed refresh within 60 seconds and preserve the last good value', async () => {
  await eachProvider(async kind => {
    const host = createHookHost(kind)
    const Provider = await loadProvider(host, kind)
    await host.mount(Provider)
    const [channel] = host.channels
    host.enqueue(response({ error: 'temporary failure' }, false))
    channel.status('SUBSCRIBED')
    await host.settle()
    assert.equal(host.calls.length, 2)
    assert.equal(displayedCount(kind, host.value), 7)
    assert.ok(host.timers.jobs.size > 0, `${kind}: a recovery timer is scheduled`)
    assert.ok([...host.timers.jobs.values()].every(job => job.delay <= 60_000), `${kind}: recovery is bounded`)

    host.currentPayload = payloadFor(kind, 3)
    await host.timers.advance(60_000)
    await host.settle()
    assert.ok(host.calls.length >= 3, `${kind}: retry ran`)
    assert.equal(displayedCount(kind, host.value), 3)
    await host.unmount()
  })
})

test('both summaries recover a missed event while the tab remains visible', async () => {
  await eachProvider(async kind => {
    const host = createHookHost(kind)
    const Provider = await loadProvider(host, kind)
    await host.mount(Provider)
    host.currentPayload = payloadFor(kind, 2)
    await host.timers.advance(60_000)
    await host.settle()
    assert.ok(host.calls.length >= 2, `${kind}: visible-tab recovery fetch ran`)
    assert.equal(displayedCount(kind, host.value), 2)
    await host.unmount()
  })
})

test('overlapping signals share the request and perform one follow-up read', async () => {
  await eachProvider(async kind => {
    const host = createHookHost(kind)
    const firstRequest = deferred()
    host.enqueue(() => firstRequest.promise)
    const Provider = await loadProvider(host, kind)
    await host.mount(Provider)
    assert.equal(host.calls.length, 1)
    const [channel] = host.channels
    channel.status('SUBSCRIBED')
    channel.emitTable(kind === 'chat' ? 'project_chat_events' : 'notifications')
    assert.equal(host.calls.length, 1, `${kind}: signals coalesce while the request is pending`)

    firstRequest.resolve(response(payloadFor(kind, 6)))
    await host.settle()
    assert.equal(host.calls.length, 2, `${kind}: a queued signal causes one reread`)
    assert.equal(displayedCount(kind, host.value), 7)
    await host.unmount()
  })
})

test('logout clears old-session data and removes listeners, channels, timers, and pending refreshes', async () => {
  await eachProvider(async kind => {
    const host = createHookHost(kind)
    const Provider = await loadProvider(host, kind)
    await host.mount(Provider)
    const channel = host.channels[0]
    assert.ok(host.window.listenerCount + host.document.listenerCount > 0)

    const pending = deferred()
    host.enqueue(() => pending.promise)
    const staleRefresh = host.value.refresh()
    assert.equal(host.calls.length, 2)
    await host.setAuth({ loading: false, token: null, userId: null })
    assert.equal(host.value.active, false)
    assert.equal(displayedCount(kind, host.value), 0)
    pending.resolve(response(payloadFor(kind, 99)))
    await staleRefresh
    await host.settle()
    assert.equal(displayedCount(kind, host.value), 0, `${kind}: stale response cannot restore the old session`)
    assert.equal(host.window.listenerCount, 0)
    assert.equal(host.document.listenerCount, 0)
    assert.equal(channel.active, false)
    assert.equal(host.timers.jobs.size, 0)

    const requestsAfterLogout = host.calls.length
    host.window.emit('focus')
    host.window.emit('online')
    host.document.visibilityState = 'visible'
    host.document.emit('visibilitychange')
    channel.status('SUBSCRIBED')
    channel.emitTable('notifications')
    await host.timers.advance(60_000)
    await host.settle()
    assert.equal(host.calls.length, requestsAfterLogout, `${kind}: no work remains after logout`)

    const newSessionFetch = deferred()
    host.enqueue(() => newSessionFetch.promise)
    await host.setAuth({ loading: false, token: 'new-session', userId: 'user-b' })
    assert.equal(displayedCount(kind, host.value), 0, `${kind}: new session starts without old user data`)
    newSessionFetch.resolve(response(payloadFor(kind, 4)))
    await host.settle()
    assert.equal(displayedCount(kind, host.value), 4, `${kind}: fresh-session data is applied`)
    await host.unmount()
    assert.equal(host.window.listenerCount + host.document.listenerCount, 0)
    assert.equal(host.timers.jobs.size, 0)
  })
})

test('effect setup-cleanup-setup preserves hook refs and does not revise an unchanged summary', async () => {
  await eachProvider(async kind => {
    const host = createHookHost(kind)
    const Provider = await loadProvider(host, kind)
    await host.mount(Provider)
    const revision = host.value.revision
    const firstChannel = host.channels[0]

    host.replayEffects()
    await host.settle()

    assert.equal(host.calls.length, 2, `${kind}: setup after cleanup refreshes`)
    assert.equal(host.value.revision, revision, `${kind}: an unchanged summary keeps its revision`)
    assert.equal(firstChannel.active, false, `${kind}: the first channel was cleaned up`)
    assert.equal(host.channels.filter(channel => channel.active).length, 1, `${kind}: one channel remains active`)
    await host.unmount()
  })
})

test('unmount during a request discards a queued reread and stale realtime callbacks', async () => {
  await eachProvider(async kind => {
    const host = createHookHost(kind)
    const initialRequest = deferred()
    host.enqueue(() => initialRequest.promise)
    const Provider = await loadProvider(host, kind)
    await host.mount(Provider)
    assert.equal(host.calls.length, 1)
    const [channel] = host.channels
    channel.status('SUBSCRIBED')
    channel.emitTable(kind === 'chat' ? 'project_chat_reads' : 'notifications')
    assert.equal(host.calls.length, 1, `${kind}: the in-flight request is shared`)

    await host.unmount()
    assert.equal(host.window.listenerCount, 0)
    assert.equal(host.document.listenerCount, 0)
    assert.equal(host.timers.jobs.size, 0)
    initialRequest.resolve(response(payloadFor(kind, 99)))
    await host.settle()
    channel.status('SUBSCRIBED')
    channel.emitTable(kind === 'chat' ? 'project_chat_events' : 'notifications')
    await host.settle()

    assert.equal(host.calls.length, 1, `${kind}: neither the queued signal nor stale callbacks refetch`)
    assert.equal(host.timers.jobs.size, 0)
  })
})

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
