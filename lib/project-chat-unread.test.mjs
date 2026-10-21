import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadTsModule, paginatedAdmin } from './project-chat-test-helpers.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let nextMessageId = 0
const other = (project_id, created_at, overrides = {}) => ({
  id: `message-${++nextMessageId}`,
  project_id,
  created_at,
  created_by: 'someone-else',
  deleted_at: null,
  ...overrides,
})

async function loadSummary(database, context) {
  return loadTsModule(resolve(root, 'app/api/_utils/project-chat.ts'), {
    '@/app/api/_utils/auth': { requireProfile: async () => context },
    '@/app/api/_utils/supabase': { createSupabaseServiceClient: () => paginatedAdmin(database) },
    './auth': { requireProfile: async () => context },
    './supabase': { createSupabaseServiceClient: () => paginatedAdmin(database) },
  })
}

function context(userId, role) {
  return { ok: true, user: { id: userId }, profile: { role } }
}

function sortedProjects(result) {
  return [...result.unreadProjects].sort((left, right) => left.projectId.localeCompare(right.projectId))
}

test('admin summary includes unvisited projects and applies read, author, and deletion rules', async () => {
  const userId = 'viewer'
  const watermark = '2026-10-01T12:00:00.000Z'
  const database = {
    tables: {
      projects: [
        { id: 'no-read-row', client_id: 'client' },
        { id: 'watermarked', client_id: 'client' },
        { id: 'null-watermark', client_id: 'client' },
        { id: 'already-read', client_id: 'client' },
      ],
      project_chat_reads: [
        { project_id: 'watermarked', user_id: userId, last_read_at: watermark },
        { project_id: 'null-watermark', user_id: userId, last_read_at: null },
        { project_id: 'already-read', user_id: userId, last_read_at: '2026-10-03T00:00:00.000Z' },
      ],
      project_chat_messages: [
        other('no-read-row', '2026-10-01T10:00:00.000Z'),
        other('no-read-row', '2026-10-01T11:00:00.000Z'),
        other('no-read-row', '2026-10-01T11:30:00.000Z', { created_by: userId }),
        other('no-read-row', '2026-10-01T11:45:00.000Z', { deleted_at: '2026-10-01T11:46:00.000Z' }),
        other('watermarked', watermark),
        other('watermarked', '2026-10-01T12:01:00.000Z'),
        other('watermarked', '2026-10-01T11:59:00.000Z'),
        other('null-watermark', '2026-10-01T09:00:00.000Z'),
        other('null-watermark', '2026-10-01T10:00:00.000Z'),
        other('already-read', '2026-10-02T00:00:00.000Z'),
      ],
    },
  }
  const { getProjectChatUnreadSummary } = await loadSummary(database, context(userId, 'admin'))

  const result = await getProjectChatUnreadSummary(new Request('http://localhost/api/projects/chat/unread'))

  assert.equal(result.ok, true)
  assert.equal(result.hasUnread, true)
  assert.equal(result.unreadProjectCount, 3)
  assert.equal(result.unreadMessageCount, 5)
  assert.deepEqual(sortedProjects(result), [
    { projectId: 'no-read-row', unreadMessageCount: 2 },
    { projectId: 'null-watermark', unreadMessageCount: 2 },
    { projectId: 'watermarked', unreadMessageCount: 1 },
  ])
})

test('consultants and clients see current access only, even when revoked projects retain read history', async () => {
  const userId = 'viewer'
  const database = {
    tables: {
      projects: [
        { id: 'consultant-current', client_id: 'other-client' },
        { id: 'consultant-revoked', client_id: 'other-client' },
        { id: 'client-current', client_id: userId },
        { id: 'client-other', client_id: 'other-client' },
      ],
      project_members: [{ project_id: 'consultant-current', consultant_id: userId }],
      project_chat_reads: [
        { project_id: 'consultant-revoked', user_id: userId, last_read_at: null },
        { project_id: 'client-other', user_id: userId, last_read_at: null },
      ],
      project_chat_messages: [
        other('consultant-current', '2026-10-01T10:00:00.000Z'),
        other('consultant-revoked', '2026-10-01T10:00:00.000Z'),
        other('client-current', '2026-10-01T10:00:00.000Z'),
        other('client-other', '2026-10-01T10:00:00.000Z'),
      ],
    },
  }

  const consultant = await loadSummary(database, context(userId, 'consultant'))
  const consultantResult = await consultant.getProjectChatUnreadSummary(new Request('http://localhost/api'))
  assert.equal(consultantResult.ok, true)
  assert.deepEqual(consultantResult.unreadProjects, [
    { projectId: 'consultant-current', unreadMessageCount: 1 },
  ])

  const client = await loadSummary(database, context(userId, 'client'))
  const clientResult = await client.getProjectChatUnreadSummary(new Request('http://localhost/api'))
  assert.equal(clientResult.ok, true)
  assert.deepEqual(clientResult.unreadProjects, [
    { projectId: 'client-current', unreadMessageCount: 1 },
  ])
})

test('read, access, and message query failures stay errors instead of becoming zero summaries', async t => {
  const userId = 'viewer'
  const base = {
    projects: [{ id: 'project', client_id: userId }],
    project_members: [{ project_id: 'project', consultant_id: userId }],
    project_chat_reads: [{ project_id: 'project', user_id: userId, last_read_at: null }],
    project_chat_messages: [other('project', '2026-10-01T10:00:00.000Z')],
  }

  for (const [name, role, table] of [
    ['read rows', 'admin', 'project_chat_reads'],
    ['access rows', 'consultant', 'project_members'],
    ['message rows', 'admin', 'project_chat_messages'],
  ]) {
    await t.test(name, async () => {
      const database = { tables: base, errors: { [table]: new Error(`failed ${table}`) } }
      const { getProjectChatUnreadSummary } = await loadSummary(database, context(userId, role))
      const result = await getProjectChatUnreadSummary(new Request('http://localhost/api'))
      assert.equal(result.ok, false)
      assert.equal(result.status, 500)
      assert.equal('unreadMessageCount' in result, false)
    })
  }
})

test('summary pagination counts projects beyond the PostgREST 1000-row page', async () => {
  const userId = 'viewer'
  const projects = Array.from({ length: 1007 }, (_, index) => ({
    id: `project-${String(index).padStart(4, '0')}`,
    client_id: 'client',
  }))
  const largeProject = { id: 'project-many-messages', client_id: 'client' }
  const watermark = '2026-10-01T00:00:00.000Z'
  const messages = projects.map(project => other(project.id, '2026-10-01T10:00:00.000Z'))
  messages.push(...Array.from({ length: 1007 }, (_, index) => other(
    largeProject.id,
    new Date(Date.parse('2026-10-01T10:00:00.000Z') + index).toISOString(),
  )))
  const database = {
    tables: {
      projects: [...projects, largeProject],
      project_chat_reads: [...projects, largeProject].map(project => ({
        project_id: project.id,
        user_id: userId,
        last_read_at: watermark,
      })),
      project_chat_messages: messages,
    },
  }
  const { getProjectChatUnreadSummary } = await loadSummary(database, context(userId, 'admin'))

  const result = await getProjectChatUnreadSummary(new Request('http://localhost/api'))

  assert.equal(result.ok, true)
  assert.equal(result.unreadProjectCount, 1008)
  assert.equal(result.unreadMessageCount, 2014)
  assert.equal(result.unreadProjects.length, 1008)
  assert.equal(result.unreadProjects.find(project => project.projectId === largeProject.id)?.unreadMessageCount, 1007)
})

test('a message after the read boundary within the same millisecond stays unread', async () => {
  const database = {
    tables: {
      projects: [{ id: 'project', client_id: 'client' }],
      project_chat_reads: [{ project_id: 'project', user_id: 'viewer', last_read_at: '2026-10-01T10:00:00.123456+00:00' }],
      project_chat_messages: [
        other('project', '2026-10-01T10:00:00.123456+00:00'),
        other('project', '2026-10-01T10:00:00.123457+00:00'),
      ],
    },
  }
  const { getProjectChatUnreadSummary } = await loadSummary(database, context('viewer', 'admin'))
  const result = await getProjectChatUnreadSummary(new Request('http://localhost/api'))
  assert.equal(result.unreadMessageCount, 1)
})
