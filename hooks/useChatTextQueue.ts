'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

export type ChatTextQueueItem = {
  id: number
  text: string
}

type QueueSnapshot = {
  items: ChatTextQueueItem[]
  sendingId: number | null
  failed: boolean
}

type QueueStore = QueueSnapshot & {
  listeners: Set<() => void>
  inFlight: Promise<void> | null
  snapshot: QueueSnapshot
}

type QueueSender = (text: string) => Promise<unknown>

const emptySnapshot: QueueSnapshot = { items: [], sendingId: null, failed: false }
// shortcut: pending sends live only in this tab; durable delivery needs storage and server deduplication.
const queueStores = new Map<string, QueueStore>()
const queueSenders = new Map<string, Set<QueueSender>>()
const pauseQueue = Symbol('pause-chat-text-queue')
let nextQueueItemId = 0

const getSenders = (scope: string) => Array.from(queueSenders.get(scope) ?? [])

const getStore = (scope: string): QueueStore => {
  const existing = queueStores.get(scope)
  if (existing) return existing

  const store: QueueStore = {
    items: [],
    sendingId: null,
    failed: false,
    listeners: new Set(),
    inFlight: null,
    snapshot: emptySnapshot,
  }
  queueStores.set(scope, store)
  return store
}

const publish = (store: QueueStore) => {
  store.snapshot = {
    items: store.items,
    sendingId: store.sendingId,
    failed: store.failed,
  }
  store.listeners.forEach((listener) => listener())
}

const removeEmptyStore = (scope: string, store: QueueStore) => {
  if (!store.items.length && !store.inFlight && !store.listeners.size && queueStores.get(scope) === store) {
    queueStores.delete(scope)
  }
}

const drainQueue = (scope: string): Promise<void> => {
  const store = getStore(scope)
  if (store.inFlight) return store.inFlight
  if (store.failed || !store.items.length || !getSenders(scope).length) return Promise.resolve()

  const pausedSenders = new Set<QueueSender>()
  const run = (async () => {
    while (store.items.length && !store.failed) {
      const sender = getSenders(scope).find((candidate) => !pausedSenders.has(candidate))
      if (!sender) break

      const item = store.items[0]
      store.sendingId = item.id
      publish(store)

      let result: unknown
      try {
        result = await sender(item.text)
      } catch {
        result = null
      }

      if (result === pauseQueue) {
        pausedSenders.add(sender)
        store.sendingId = null
        publish(store)
        continue
      }

      if (result === null || result === undefined || result === false) {
        store.failed = true
        store.sendingId = null
        publish(store)
        break
      }

      store.items = store.items.filter((queued) => queued.id !== item.id)
      store.sendingId = null
      publish(store)
    }
  })()

  const settled = run.finally(() => {
    if (store.inFlight === settled) store.inFlight = null
    store.sendingId = null
    publish(store)
    const hasUntriedSender = getSenders(scope).some((sender) => !pausedSenders.has(sender))
    if (!store.failed && store.items.length && hasUntriedSender) void drainQueue(scope)
    removeEmptyStore(scope, store)
  })
  store.inFlight = settled
  publish(store)
  return settled
}

export function useChatTextQueue(
  scope: string | null,
  sendText: QueueSender,
  enabled: boolean
) {
  const sendConfigRef = useRef({ scope, enabled, sendText })
  sendConfigRef.current = { scope, enabled, sendText }
  const scopedSender = useCallback<QueueSender>(async (text) => {
    const current = sendConfigRef.current
    if (current.scope !== scope || !current.enabled) return pauseQueue
    return current.sendText(text)
  }, [scope])

  const subscribe = useCallback((listener: () => void) => {
    if (!scope) return () => undefined
    const store = getStore(scope)
    store.listeners.add(listener)
    return () => {
      store.listeners.delete(listener)
      removeEmptyStore(scope, store)
    }
  }, [scope])

  const getSnapshot = useCallback(() => {
    return scope ? getStore(scope).snapshot : emptySnapshot
  }, [scope])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => emptySnapshot)

  useEffect(() => {
    if (!scope || !enabled) return
    // Un sender propriu fiecărei montări, ca o montare nouă să nu fie scoasă de curățarea celei vechi.
    const sender: QueueSender = (text) => scopedSender(text)
    const senders = queueSenders.get(scope) ?? new Set<QueueSender>()
    senders.add(sender)
    queueSenders.set(scope, senders)
    const store = getStore(scope)
    if (store.items.length && !store.failed) void drainQueue(scope)

    return () => {
      const detach = () => {
        const attachedSenders = queueSenders.get(scope)
        attachedSenders?.delete(sender)
        if (attachedSenders?.size === 0) queueSenders.delete(scope)
        removeEmptyStore(scope, store)
      }
      // La schimbarea conversației sau a paginii, textele deja puse în coadă pleacă în continuare.
      // Dacă scope-ul sau trimiterea s-au schimbat, senderul se oprește singur (pauseQueue).
      if (!store.inFlight) {
        detach()
        return
      }
      void (async () => {
        while (store.inFlight) await store.inFlight
        detach()
      })()
    }
  }, [enabled, scope, scopedSender])

  const enqueue = useCallback((text: string) => {
    if (!scope || !enabled || !text.trim()) return false
    const store = getStore(scope)
    store.items = store.items.concat({ id: ++nextQueueItemId, text })
    publish(store)
    void drainQueue(scope)
    return true
  }, [enabled, scope])

  const retry = useCallback(() => {
    if (!scope || !enabled) return
    const store = getStore(scope)
    if (!store.failed) return
    store.failed = false
    publish(store)
    if (store.inFlight) {
      void store.inFlight.then(() => {
        if (!store.failed) void drainQueue(scope)
      })
    } else {
      void drainQueue(scope)
    }
  }, [enabled, scope])

  // Scoate din coadă mesajul care nu a putut fi trimis și reia trimiterea celorlalte.
  // Întoarce textul, ca să poată fi pus înapoi în editor.
  const discardFailed = useCallback(() => {
    if (!scope) return null
    const store = getStore(scope)
    if (!store.failed || store.inFlight) return null
    const [first, ...rest] = store.items
    if (!first) return null
    store.items = rest
    store.failed = false
    publish(store)
    if (store.items.length) void drainQueue(scope)
    else removeEmptyStore(scope, store)
    return first.text
  }, [scope])

  const waitForIdle = useCallback(async () => {
    if (!scope) return true
    const store = getStore(scope)
    if (store.inFlight) await store.inFlight
    else if (!store.failed && getSenders(scope).length) await drainQueue(scope)
    return store.items.length === 0
  }, [scope])

  return {
    items: snapshot.items,
    sendingId: snapshot.sendingId,
    failed: snapshot.failed,
    enqueue,
    retry,
    discardFailed,
    waitForIdle,
  }
}
