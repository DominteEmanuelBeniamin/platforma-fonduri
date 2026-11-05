import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { loadTsModule } from './project-chat-test-helpers.mjs'

async function setup(apiFetch, refresh = async () => {}) {
  const slots = []
  let cursor = 0
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = initial
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(fn) { return fn },
    useEffect() {},
    useTransition() { return [false, callback => callback()] },
  }
  const toasts = [], navigations = [], timers = []
  const window = {
    location: { origin: 'https://example.test', href: 'https://example.test/notificari', assign: href => navigations.push(href), reload() {} },
    setTimeout: fn => { timers.push(fn); return timers.length }, stop() {},
  }
  const { useNotificationFeed: feedHook } = await loadTsModule(resolve('components/notifications/useNotificationFeed.ts'), {
    react,
    'next/navigation': { useRouter: () => ({ push: href => navigations.push(href) }) },
    '@/app/providers/AuthProvider': { useAuth: () => ({ apiFetch }) },
    '@/app/providers/NotificationsProvider': { useNotifications: () => ({ refresh, revision: 0 }) },
    '@/app/providers/ToastProvider': { useToast: () => ({ showToast: (...args) => toasts.push(args) }) },
  }, { window, URL, URLSearchParams, AbortSignal, Date, clearTimeout })
  return { render: () => { cursor = 0; return feedHook({ active: true }) }, toasts, navigations, timers }
}

const item = { id: 'one', readAt: null }
const response = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json })

test('opening shows pending state and clears it with an error when the target fails', async () => {
  let reply
  const h = await setup(() => new Promise(resolve => { reply = resolve }))
  const opening = h.render().openTarget(item)
  assert.equal(h.render().pendingId, 'one')
  reply(response(404, {}))
  await opening
  assert.equal(h.render().pendingId, null)
  assert.match(h.toasts[0][0], /nu mai există/)
  assert.equal(h.navigations.length, 0)
})

test('navigation does not wait for the unread counter and a stalled navigation clears pending', async () => {
  const requests = []
  const h = await setup(async url => {
    requests.push(url)
    return url.endsWith('/target') ? response(200, { href: '/projects/p?phase=a&activity=b' }) : response(200, {})
  }, () => new Promise(() => {}))
  await h.render().openTarget(item)
  assert.equal(requests.length, 2)
  assert.match(h.navigations[0], /fromNotification=1/)
  assert.equal(h.render().pendingId, 'one')
  h.timers[0]()
  assert.equal(h.render().pendingId, null)
  assert.match(h.toasts[0][0], /Nu am putut deschide/)
})

test('failure to mark as read stops loading without navigating', async () => {
  const h = await setup(async url => url.endsWith('/target') ? response(200, { href: '/projects/p' }) : response(500, {}))
  await h.render().openTarget(item)
  assert.equal(h.render().pendingId, null)
  assert.equal(h.navigations.length, 0)
  assert.match(h.toasts[0][0], /Nu am putut marca/)
})
