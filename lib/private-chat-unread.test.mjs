import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadTsModule, paginatedAdmin } from './project-chat-test-helpers.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const selfId = 'current-user'
const peerId = 'other-user'
let nextMessageId = 0

const message = (conversation_id, created_at, created_by = peerId, overrides = {}) => ({
  id: `private-message-${++nextMessageId}`,
  conversation_id,
  created_at,
  created_by,
  body: 'message body',
  deleted_at: null,
  ...overrides,
})

async function loadPrivateChat(database, profile = { id: selfId, role: 'client', email: 'self@example.test' }) {
  const context = { ok: true, user: { id: selfId }, profile }
  return loadTsModule(resolve(root, 'app/api/_utils/private-chat.ts'), {
    './auth': { requireProfile: async () => context },
    './supabase': { createSupabaseServiceClient: () => paginatedAdmin(database) },
    './private-chat-access': { canChatWithUser: () => true },
    './inactive-reference': { inactiveReferenceConflict: () => null },
  })
}

function participant(conversation_id, user_id, last_read_at = null, profiles = null) {
  return {
    conversation_id,
    user_id,
    joined_at: '2026-09-01T00:00:00.000Z',
    last_read_at,
    profiles,
  }
}

test('summary counts any active incoming message after the watermark, including before a deleted latest message', async () => {
  const watermark = '2026-10-01T12:00:00.000Z'
  const database = {
    tables: {
      private_conversation_participants: [
        participant('unread-null', selfId),
        participant('unread-watermark', selfId, watermark),
        participant('read-watermark', selfId, '2026-10-01T14:00:00.000Z'),
        participant('received-before-own', selfId, null),
        participant('own-only', selfId, null),
        participant('not-mine', peerId, null),
      ],
      private_messages: [
        message('unread-null', '2026-10-01T10:00:00.000Z'),
        message('unread-null', '2026-10-01T11:00:00.000Z', peerId, { deleted_at: '2026-10-01T11:01:00.000Z' }),
        message('unread-watermark', watermark),
        message('unread-watermark', '2026-10-01T12:00:00.001Z'),
        message('read-watermark', '2026-10-01T13:00:00.000Z'),
        message('received-before-own', '2026-10-01T10:00:00.000Z'),
        message('received-before-own', '2026-10-01T11:00:00.000Z', selfId),
        message('own-only', '2026-10-01T15:00:00.000Z', selfId),
        message('not-mine', '2026-10-01T15:00:00.000Z'),
      ],
    },
  }
  const api = await loadPrivateChat(database)

  const result = await api.getPrivateConversationUnreadSummary(new Request('http://localhost/api/private-conversations/unread'))

  assert.equal(result.ok, true)
  assert.deepEqual(result.user, { id: selfId })
  assert.equal(result.profile.id, selfId)
  assert.equal(result.hasUnread, true)
  assert.equal(result.unreadConversationCount, 3)
})

test('conversation list keeps every participant conversation and chooses the latest active preview', async () => {
  const conversations = [
    { id: 'conv-deleted-latest', created_at: '2026-09-01T00:00:00.000Z', created_by: selfId, last_message_at: '2026-10-02T00:00:00.000Z' },
    { id: 'conv-newer', created_at: '2026-09-02T00:00:00.000Z', created_by: peerId, last_message_at: '2026-10-03T00:00:00.000Z' },
    { id: 'conv-read', created_at: '2026-09-03T00:00:00.000Z', created_by: selfId, last_message_at: '2026-10-01T00:00:00.000Z' },
  ]
  const database = {
    tables: {
      private_conversations: conversations,
      private_conversation_participants: [
        participant('conv-deleted-latest', selfId, null),
        participant('conv-deleted-latest', peerId, '2026-10-01T11:00:00.000Z', {
          id: peerId, full_name: 'Ana', email: 'ana@example.test', is_active: true,
        }),
        participant('conv-newer', selfId, '2026-10-02T00:00:00.000Z'),
        participant('conv-newer', peerId, '2026-10-02T12:00:00.000Z', {
          id: peerId, full_name: 'Ana', email: 'ana@example.test', is_active: true,
        }),
        participant('conv-read', selfId, '2026-10-01T00:00:00.000Z'),
        participant('conv-read', peerId, null, {
          id: peerId, full_name: 'Ana', email: 'ana@example.test', is_active: true,
        }),
        participant('not-mine', peerId),
      ],
      private_messages: [
        message('conv-deleted-latest', '2026-10-01T10:00:00.000Z', peerId, { id: 'active-preview', body: 'preview activ' }),
        message('conv-deleted-latest', '2026-10-02T00:00:00.000Z', peerId, { id: 'deleted-preview', body: 'secret deleted', deleted_at: '2026-10-02T00:01:00.000Z' }),
        message('conv-newer', '2026-10-03T00:00:00.000Z', peerId, { id: 'newest-preview', body: 'cel mai nou' }),
        message('conv-read', '2026-09-30T00:00:00.000Z', peerId, { id: 'read-preview' }),
      ],
    },
  }
  const api = await loadPrivateChat(database)
  const request = new Request('http://localhost/api/private-conversations')

  const [list, summary] = await Promise.all([
    api.listPrivateConversationsForCurrentUser(request),
    api.getPrivateConversationUnreadSummary(request),
  ])

  assert.equal(list.ok, true)
  assert.equal(summary.ok, true)
  assert.deepEqual(list.items.map(item => item.id), ['conv-newer', 'conv-deleted-latest', 'conv-read'])
  assert.ok(list.items.every(item => item.id !== 'not-mine'))
  assert.deepEqual(list.items[1].last_message, {
    id: 'active-preview',
    body: 'preview activ',
    created_at: '2026-10-01T10:00:00.000Z',
    created_by: peerId,
  })
  assert.deepEqual(list.items[1].other_user, {
    id: peerId, full_name: 'Ana', email: 'ana@example.test', is_active: true,
  })
  assert.equal(list.items[1].last_read_at, null)
  assert.equal(list.items[1].other_last_read_at, '2026-10-01T11:00:00.000Z')
  assert.equal(list.items[1].last_message.body.includes('secret'), false)

  const unreadFromList = list.items.filter(item =>
    item.last_message &&
    item.last_message.created_by !== selfId &&
    (!item.last_read_at || Date.parse(item.last_message.created_at) > Date.parse(item.last_read_at)),
  ).length
  assert.equal(summary.unreadConversationCount, 2)
  assert.equal(summary.unreadConversationCount, unreadFromList)
})

test('unread and list queries paginate beyond 1000 participants, conversations, and messages', async () => {
  const conversations = Array.from({ length: 1007 }, (_, index) => ({
    id: `conversation-${String(index).padStart(4, '0')}`,
    created_at: '2026-09-01T00:00:00.000Z',
    created_by: selfId,
    last_message_at: new Date(Date.parse('2026-10-01T10:00:00.000Z') + index * 1000).toISOString(),
  }))
  conversations[0].last_message_at = '2026-10-02T00:00:00.000Z'
  const participants = conversations.flatMap((conversation, index) => [
    participant(conversation.id, selfId, null),
    participant(conversation.id, `peer-${index}`, null, {
      id: `peer-${index}`, full_name: `Peer ${index}`, email: null, is_active: true,
    }),
  ])
  const manyDeleted = Array.from({ length: 1000 }, (_, index) => message(
    conversations[0].id,
    new Date(Date.parse('2026-10-02T00:00:00.000Z') + index).toISOString(),
    `peer-0`,
    { deleted_at: '2026-10-02T01:00:00.000Z' },
  ))
  const activeOlder = message(conversations[0].id, '2026-10-01T09:00:00.000Z', 'peer-0', { id: 'old-active-message' })
  const otherMessages = conversations.slice(1).map((conversation, index) => message(
    conversation.id,
    new Date(Date.parse('2026-10-01T09:00:00.000Z') + index * 1000).toISOString(),
    `peer-${index + 1}`,
  ))
  const database = {
    tables: {
      private_conversations: conversations,
      private_conversation_participants: participants,
      private_messages: [...manyDeleted, activeOlder, ...otherMessages],
    },
  }
  const api = await loadPrivateChat(database)
  const request = new Request('http://localhost/api/private-conversations')

  const [list, summary] = await Promise.all([
    api.listPrivateConversationsForCurrentUser(request),
    api.getPrivateConversationUnreadSummary(request),
  ])

  assert.equal(list.ok, true)
  assert.equal(summary.ok, true)
  assert.equal(list.items.length, 1007)
  assert.equal(list.items[0].id, conversations[0].id)
  assert.equal(list.items[0].last_message.id, 'old-active-message')
  assert.equal(summary.unreadConversationCount, 1007)
  assert.equal(summary.hasUnread, true)
})

test('database read errors are returned as errors instead of empty lists or zero summaries', async t => {
  const database = {
    tables: {
      private_conversation_participants: [participant('conversation', selfId)],
      private_conversations: [{ id: 'conversation', created_at: '2026-09-01T00:00:00.000Z', created_by: selfId, last_message_at: null }],
      private_messages: [message('conversation', '2026-10-01T00:00:00.000Z')],
    },
    errors: { private_messages: new Error('message query failed') },
  }
  const api = await loadPrivateChat(database)

  await t.test('summary', async () => {
    const result = await api.getPrivateConversationUnreadSummary(new Request('http://localhost'))
    assert.equal(result.ok, false)
    assert.equal(result.status, 500)
  })
  await t.test('list', async () => {
    const result = await api.listPrivateConversationsForCurrentUser(new Request('http://localhost'))
    assert.equal(result.ok, false)
    assert.equal(result.status, 500)
  })
})
