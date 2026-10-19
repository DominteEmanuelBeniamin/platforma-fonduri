import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadTsModule, PaginatedQuery } from './project-chat-test-helpers.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const conversationId = 'conversation-1'
const userId = 'current-user'

class ParticipantQuery extends PaginatedQuery {
  constructor(database, table) {
    super(database, table)
    this.operation = 'select'
    this.values = null
    this.options = {}
  }
  update(values) { this.operation = 'update'; this.values = values; this.database.writeAttempts.push(values); return this }
  upsert(values, options = {}) {
    this.operation = 'upsert'
    this.values = values
    this.options = options
    this.database.writeAttempts.push(values)
    return this
  }
  async maybeSingle() {
    const result = this.result()
    if (result.error) return result
    if ((result.data ?? []).length > 1) return { data: null, error: new Error('maybeSingle returned multiple rows') }
    return { ...result, data: result.data?.[0] ?? null }
  }
  async applyWrite() {
    const error = this.database.errors?.[this.table]
    if (error) return { data: null, error }
    await this.database.beforeWrite?.({ operation: this.operation, values: this.values })
    const rows = this.database.tables[this.table] ?? []
    const values = Array.isArray(this.values) ? this.values : [this.values]
    if (this.operation === 'upsert') {
      const keys = this.options.onConflict?.split(',') ?? ['conversation_id', 'user_id']
      for (const value of values) {
        const current = rows.find(row => keys.every(key => row[key] === value[key]))
        if (!current) rows.push({ ...value })
        else if (!this.options.ignoreDuplicates) Object.assign(current, value)
      }
    } else {
      for (const row of this.rows()) Object.assign(row, this.values)
    }
    return { data: this.rows(), error: null }
  }
  then(resolve, reject) {
    const result = this.operation === 'select' ? Promise.resolve(this.result()) : this.applyWrite()
    return result.then(resolve, reject)
  }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function makeDatabase(lastReadAt = null) {
  return {
    tables: {
      private_conversation_participants: [{
        conversation_id: conversationId,
        user_id: userId,
        last_read_at: lastReadAt,
      }],
    },
    writeAttempts: [],
  }
}

async function loadReadRoute(database, access = null) {
  const requireAccess = access ?? (async () => {
    const participant = database.tables.private_conversation_participants.find(row =>
      row.conversation_id === conversationId && row.user_id === userId,
    )
    return participant
      ? {
          ok: true,
          user: { id: userId },
          profile: { id: userId, role: 'client' },
          participant: { ...participant },
        }
      : { ok: false, status: 403, error: 'Forbidden' }
  })
  const admin = { from: table => new ParticipantQuery(database, table) }
  return loadTsModule(resolve(root, 'app/api/private-conversations/[id]/read/route.ts'), {
    '@/app/api/_utils/auth': {
      guardToResponse: result => Response.json({ error: result.error }, { status: result.status }),
    },
    '@/app/api/_utils/private-chat': { requirePrivateConversationParticipant: requireAccess },
    '@/app/api/_utils/supabase': { createSupabaseServiceClient: () => admin },
  })
}

function post(body, includeBody = true) {
  return new Request(`http://localhost/api/private-conversations/${conversationId}/read`, {
    method: 'POST',
    ...(includeBody
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
}

async function send(route, body, includeBody = true) {
  const response = await route.POST(post(body, includeBody), { params: Promise.resolve({ id: conversationId }) })
  return { response, json: await response.json() }
}

test('an explicit read-through cap preserves its sub-millisecond timestamp', async () => {
  const second = new Date(Date.now() - 60_000).toISOString().slice(0, 19)
  const through = `${second}.123456Z`
  const database = makeDatabase()
  const route = await loadReadRoute(database)

  const { response, json } = await send(route, { readThroughAt: through })

  assert.equal(response.status, 200)
  assert.equal(json.lastReadAt, through)
  assert.equal(database.tables.private_conversation_participants[0].last_read_at, through)
})

test('a lower explicit cap preserves a more recent stored limit at full precision', async () => {
  const second = new Date(Date.now() - 60_000).toISOString().slice(0, 19)
  const existing = `${second}.123457Z`
  const requested = `${second}.123456Z`
  const database = makeDatabase(existing)
  const route = await loadReadRoute(database)

  const { response, json } = await send(route, { readThroughAt: requested })

  assert.equal(response.status, 200)
  assert.equal(json.lastReadAt, existing)
  assert.equal(database.tables.private_conversation_participants[0].last_read_at, existing)
})

test('messages arriving after an explicit UI snapshot remain beyond the saved read limit', async () => {
  const through = new Date(Date.now() - 10_000).toISOString()
  const arrivedAt = new Date(Date.parse(through) + 2_000).toISOString()
  const database = makeDatabase()
  const route = await loadReadRoute(database)

  const { response, json } = await send(route, { readThroughAt: through })

  assert.equal(response.status, 200)
  assert.equal(json.lastReadAt, through)
  assert.ok(Date.parse(arrivedAt) > Date.parse(json.lastReadAt))
})

test('concurrent older and newer caps cannot regress when writes complete in reverse order', async () => {
  const base = new Date(Date.now() - 60_000)
  const lower = new Date(base.getTime() + 1_000).toISOString()
  const higher = new Date(base.getTime() + 2_000).toISOString()
  const database = makeDatabase(new Date(base.getTime() - 1_000).toISOString())
  const lowStarted = deferred()
  const releaseLow = deferred()
  let writeCount = 0
  database.beforeWrite = async () => {
    writeCount++
    if (writeCount === 1) {
      lowStarted.resolve()
      await releaseLow.promise
    }
  }
  const route = await loadReadRoute(database)
  const lowerRequest = send(route, { readThroughAt: lower })
  await lowStarted.promise
  let higherResult
  try {
    higherResult = await send(route, { readThroughAt: higher })
  } finally {
    releaseLow.resolve()
  }
  const lowerResult = await lowerRequest

  assert.equal(higherResult.response.status, 200)
  assert.equal(lowerResult.response.status, 200)
  assert.equal(database.tables.private_conversation_participants[0].last_read_at, higher)
})

test('an omitted body remains compatible and marks through request time', async () => {
  const database = makeDatabase()
  const route = await loadReadRoute(database)
  const before = Date.now()

  const { response, json } = await send(route, undefined, false)

  assert.equal(response.status, 200)
  assert.ok(Date.parse(json.lastReadAt) >= before - 1_000)
  assert.ok(Date.parse(json.lastReadAt) <= Date.now())
})

test('future caps may be rejected or capped at request time', async () => {
  const database = makeDatabase()
  const route = await loadReadRoute(database)
  const future = new Date(Date.now() + 60 * 60_000).toISOString()
  const before = Date.now()

  const { response, json } = await send(route, { readThroughAt: future })

  if (response.status === 400) {
    assert.equal(database.writeAttempts.length, 0)
    return
  }
  assert.equal(response.status, 200)
  assert.ok(Date.parse(json.lastReadAt) < Date.parse(future))
  assert.ok(Date.parse(json.lastReadAt) <= Date.now())
  assert.ok(Date.parse(json.lastReadAt) >= before - 1_000)
})

test('invalid bodies, denied access, and database errors remain errors', async t => {
  await t.test('invalid timestamp', async () => {
    const database = makeDatabase()
    const route = await loadReadRoute(database)
    const { response } = await send(route, { readThroughAt: 'invalid' })
    assert.equal(response.status, 400)
    assert.equal(database.writeAttempts.length, 0)
  })

  await t.test('unauthorized', async () => {
    const database = makeDatabase()
    const route = await loadReadRoute(database, async () => ({ ok: false, status: 401, error: 'Unauthorized' }))
    const { response } = await send(route, { readThroughAt: new Date().toISOString() })
    assert.equal(response.status, 401)
    assert.equal(database.writeAttempts.length, 0)
  })

  await t.test('database update fails', async () => {
    const originalError = console.error
    console.error = () => {}
    try {
      const database = makeDatabase()
      database.errors = { private_conversation_participants: new Error('write failed') }
      const route = await loadReadRoute(database)
      const { response } = await send(route, { readThroughAt: new Date().toISOString() })
      assert.equal(response.status, 500)
      assert.equal(database.tables.private_conversation_participants[0].last_read_at, null)
    } finally {
      console.error = originalError
    }
  })
})
