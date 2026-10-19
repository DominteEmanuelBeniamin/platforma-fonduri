import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadTsModule, PaginatedQuery } from './project-chat-test-helpers.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const conversationId = '00000000-0000-4000-8000-000000000001'
const otherConversationId = '00000000-0000-4000-8000-000000000002'
const stableIds = new Map()

function stableUuid(label) {
  if (!stableIds.has(label)) stableIds.set(label, `00000000-0000-4000-8000-${String(stableIds.size + 100).padStart(12, '0')}`)
  return stableIds.get(label)
}

function splitAtTopLevel(source) {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      parts.push(source.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(source.slice(start).trim())
  return parts
}

function compareSqlValues(left, right) {
  const toParts = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null
    const fraction = value.match(/\.(\d+)(?=Z|[+-]\d\d:\d\d$)/)?.[1] ?? ''
    const wholeSecond = value.replace(/\.\d+(?=Z|[+-]\d\d:\d\d$)/, '')
    const wholeMillis = Date.parse(wholeSecond)
    if (!Number.isFinite(wholeMillis)) return null
    return [wholeMillis, BigInt(fraction.padEnd(9, '0').slice(0, 9) || '0')]
  }
  const a = toParts(left)
  const b = toParts(right)
  if (a && b) return a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)
  return left < right ? -1 : left > right ? 1 : 0
}

function filterExpression(expression, row) {
  const source = expression.trim()
  if (source.startsWith('(') && source.endsWith(')')) {
    let depth = 0
    let wrapsWholeExpression = true
    for (let index = 0; index < source.length - 1; index++) {
      if (source[index] === '(') depth++
      else if (source[index] === ')') depth--
      if (depth === 0) { wrapsWholeExpression = false; break }
    }
    if (wrapsWholeExpression) return filterExpression(source.slice(1, -1), row)
  }
  const nested = source.match(/^(and|or)\((.*)\)$/s)
  if (nested) {
    const values = splitAtTopLevel(nested[2]).map(part => filterExpression(part, row))
    return nested[1] === 'and' ? values.every(Boolean) : values.some(Boolean)
  }
  const firstDot = source.indexOf('.')
  const secondDot = source.indexOf('.', firstDot + 1)
  if (firstDot < 1 || secondDot < 0) throw new Error(`Unsupported PostgREST filter: ${source}`)
  const column = source.slice(0, firstDot)
  const operator = source.slice(firstDot + 1, secondDot)
  const rawValue = source.slice(secondDot + 1).replace(/^"|"$/g, '')
  const value = rawValue === 'null' ? null : rawValue
  const actual = row[column]
  switch (operator) {
    case 'eq': return actual === value
    case 'neq': return actual !== value
    case 'gt': return compareSqlValues(actual, value) > 0
    case 'gte': return compareSqlValues(actual, value) >= 0
    case 'lt': return compareSqlValues(actual, value) < 0
    case 'lte': return compareSqlValues(actual, value) <= 0
    case 'is': return actual === value
    default: throw new Error(`Unsupported PostgREST operator: ${operator}`)
  }
}

class MessageQuery extends PaginatedQuery {
  gt(column, value) { this.filters.push(row => compareSqlValues(row[column], value) > 0); return this }
  gte(column, value) { this.filters.push(row => compareSqlValues(row[column], value) >= 0); return this }
  lt(column, value) { this.filters.push(row => compareSqlValues(row[column], value) < 0); return this }
  lte(column, value) { this.filters.push(row => compareSqlValues(row[column], value) <= 0); return this }
  or(expression) {
    const alternatives = splitAtTopLevel(String(expression))
    this.filters.push(row => alternatives.some(part => filterExpression(part, row)))
    return this
  }
}

async function loadMessagesRoute(database, access = { ok: true, user: { id: 'viewer' }, participant: { conversation_id: conversationId } }) {
  const admin = { from: table => new MessageQuery(database, table) }
  return loadTsModule(resolve(root, 'app/api/private-conversations/[id]/messages/route.ts'), {
    '@/app/api/_utils/auth': {
      guardToResponse: result => Response.json({ error: result.error }, { status: result.status }),
    },
    '@/app/api/_utils/private-chat': { requirePrivateConversationParticipant: async () => access },
    '@/app/api/_utils/supabase': { createSupabaseServiceClient: () => admin },
    '@/app/api/_utils/audit': { logAction: async () => {} },
    '@/app/api/_utils/inactive-reference': { inactiveReferenceConflict: () => null },
  })
}

function makeMessage(id, created_at, overrides = {}) {
  const messageId = stableUuid(`message:${id}`)
  const authorId = stableUuid(`author:${id}`)
  return {
    id: messageId,
    conversation_id: conversationId,
    created_by: authorId,
    body: `body-${id}`,
    created_at,
    edited_at: null,
    deleted_at: null,
    profiles: { id: authorId, full_name: null, email: null, is_active: true },
    ...overrides,
  }
}

function pageRequest(cursor) {
  const url = new URL(`http://localhost/api/private-conversations/${conversationId}/messages`)
  url.searchParams.set('limit', '3')
  if (cursor !== undefined && cursor !== null) url.searchParams.set('cursor', String(cursor))
  return new Request(url)
}

async function getPage(route, cursor) {
  const response = await route.GET(pageRequest(cursor), { params: Promise.resolve({ id: conversationId }) })
  return { response, json: await response.json() }
}

test('opaque nextCursor pages all same-time and microsecond messages without duplicates or gaps', async () => {
  const sameTime = '2026-10-18T12:00:00.123456Z'
  const messages = [
    ...Array.from({ length: 8 }, (_, index) => makeMessage(`tie-${index}`, sameTime)),
    makeMessage('later-microsecond', '2026-10-18T12:00:00.123457Z'),
    makeMessage('earlier-microsecond', '2026-10-18T12:00:00.123455Z'),
    makeMessage('deleted-tie', sameTime, { body: 'private deleted text', deleted_at: '2026-10-18T12:01:00.000000Z' }),
    makeMessage('other-conversation', sameTime, { conversation_id: otherConversationId }),
  ]
  const database = { tables: { private_messages: messages } }
  const route = await loadMessagesRoute(database)
  const allIds = []
  const allRows = []
  let cursor
  let pages = 0
  do {
    const { response, json } = await getPage(route, cursor)
    assert.equal(response.status, 200)
    allIds.push(...json.items.map(item => item.id))
    allRows.push(...json.items)
    cursor = json.nextCursor
    pages++
    assert.ok(pages < 10, 'pagination terminates')
  } while (cursor !== null)

  const expectedIds = messages
    .filter(item => item.conversation_id === conversationId)
    .map(item => item.id)
  assert.equal(allIds.length, expectedIds.length)
  assert.equal(new Set(allIds).size, expectedIds.length)
  assert.deepEqual([...allIds].sort(), [...expectedIds].sort())
  const deleted = allRows.find(item => item.id === stableUuid('message:deleted-tie'))
  assert.equal(deleted.body, null)
  assert.equal(deleted.is_deleted, true)
  assert.equal(allRows.some(item => item.body === 'private deleted text'), false)
})

test('legacy ISO cursors remain valid and retain their microsecond boundary', async () => {
  const messages = [
    makeMessage('equal', '2026-10-18T12:00:00.123456Z'),
    makeMessage('newer-micro', '2026-10-18T12:00:00.123457Z'),
    makeMessage('older-micro', '2026-10-18T12:00:00.123455Z'),
    makeMessage('older-second', '2026-10-18T12:00:00.000000Z'),
  ]
  const route = await loadMessagesRoute({ tables: { private_messages: messages } })

  const { response, json } = await getPage(route, '2026-10-18T12:00:00.123456Z')

  assert.equal(response.status, 200)
  const ids = json.items.map(item => item.id)
  assert.equal(ids.includes(stableUuid('message:older-micro')), true)
  assert.equal(ids.includes(stableUuid('message:older-second')), true)
  assert.equal(ids.includes(stableUuid('message:equal')), false)
  assert.equal(ids.includes(stableUuid('message:newer-micro')), false)
})

test('invalid cursors return 400 and access denial remains denied', async t => {
  await t.test('invalid cursor', async () => {
    const route = await loadMessagesRoute({ tables: { private_messages: [] } })
    const { response } = await getPage(route, 'not-a-cursor')
    assert.equal(response.status, 400)
  })

  await t.test('access denied', async () => {
    const denied = { ok: false, status: 403, error: 'Forbidden' }
    const route = await loadMessagesRoute({ tables: { private_messages: [] } }, denied)
    const { response } = await getPage(route)
    assert.equal(response.status, 403)
  })
})
