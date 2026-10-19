import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadTsModule, PaginatedQuery } from './project-chat-test-helpers.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

class ReadQuery {
  constructor(database, table) {
    this.database = database
    this.table = table
    this.filters = []
    this.operation = 'select'
    this.values = null
    this.options = {}
  }

  select() { return this }
  eq(column, value) { this.filters.push(row => row[column] === value); return this }
  neq(column, value) { this.filters.push(row => row[column] !== value); return this }
  in(column, values) { this.filters.push(row => values.includes(row[column])); return this }
  is(column, value) { this.filters.push(row => row[column] === value); return this }
  not(column, operator, value) {
    if (operator === 'is' || operator === 'eq') this.filters.push(row => row[column] !== value)
    else throw new Error(`unsupported NOT comparison: ${operator}`)
    return this
  }
  gt(column, value) { this.filters.push(row => row[column] > value); return this }
  gte(column, value) { this.filters.push(row => row[column] >= value); return this }
  lt(column, value) { this.filters.push(row => row[column] < value); return this }
  lte(column, value) { this.filters.push(row => row[column] <= value); return this }
  or(expression) { return PaginatedQuery.prototype.or.call(this, expression) }
  update(values) { this.operation = 'update'; this.values = values; return this }
  insert(values) { this.operation = 'insert'; this.values = values; return this }
  delete() { this.operation = 'delete'; return this }

  async maybeSingle() {
    if (this.operation !== 'select') {
      const result = this.mutate()
      return result.error ? result : { ...result, data: result.data?.[0] ?? null }
    }
    if (this.database.readError) return { data: null, error: this.database.readError }
    const rows = this.database.rows.filter(row => this.filters.every(filter => filter(row)))
    if (rows.length > 1) return { data: null, error: new Error('maybeSingle returned multiple rows') }
    return { data: rows[0] ?? null, error: null }
  }

  upsert(values, options = {}) {
    this.operation = 'upsert'
    this.values = values
    this.options = options
    this.database.writeAttempts.push({ operation: 'upsert', values, options })
    return this
  }

  mutate() {
    const error = this.database.writeError ?? this.database.upsertError
    if (error) return { data: null, error }
    const values = Array.isArray(this.values) ? this.values : this.values ? [this.values] : []
    if (this.operation === 'upsert' || this.operation === 'insert') {
      const conflictColumns = this.options.onConflict?.split(',') ?? ['project_id', 'user_id']
      for (const value of values) {
        const existing = this.database.rows.find(row => conflictColumns.every(column => row[column] === value[column]))
        if (!existing) this.database.rows.push({ ...value })
        else if (!this.options.ignoreDuplicates) Object.assign(existing, value)
      }
    } else if (this.operation === 'update') {
      for (const row of this.database.rows.filter(candidate => this.filters.every(filter => filter(candidate)))) {
        Object.assign(row, this.values)
      }
    } else if (this.operation === 'delete') {
      this.database.rows = this.database.rows.filter(row => !this.filters.every(filter => filter(row)))
    }
    return { data: this.database.rows.filter(row => this.filters.every(filter => filter(row))), error: null }
  }

  then(resolve, reject) {
    return Promise.resolve().then(async () => {
      if (this.operation !== 'select') {
        await this.database.beforeWrite?.()
        return this.mutate()
      }
      return this.database.readError
        ? { data: null, error: this.database.readError }
        : { data: this.database.rows.filter(row => this.filters.every(filter => filter(row))), error: null }
    }).then(resolve, reject)
  }
}

async function loadRoute(database, access = { ok: true, user: { id: 'viewer' } }) {
  const service = {
    from(table) {
      assert.equal(table, 'project_chat_reads')
      return new ReadQuery(database, table)
    },
  }
  const projectChat = await loadTsModule(resolve(root, 'app/api/_utils/project-chat.ts'), {
    './auth': {},
    './supabase': { createSupabaseServiceClient: () => service },
  })
  return loadTsModule(resolve(root, 'app/api/projects/[id]/chat/read/route.ts'), {
    '@/app/api/_utils/auth': {
      requireProjectAccess: async () => access,
      guardToResponse: result => Response.json({ error: result.error }, { status: result.status }),
    },
    '@/app/api/_utils/supabase': { createSupabaseServiceClient: () => service },
    '@/app/api/_utils/project-chat': projectChat,
  })
}

function makeDatabase(rows = [], overrides = {}) {
  return { rows, writeAttempts: [], ...overrides }
}

function post(body, includeBody = true) {
  return new Request('http://localhost/api/projects/project/chat/read', {
    method: 'POST',
    ...(includeBody
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
}

async function postJson(route, body, includeBody = true) {
  const response = await route.POST(post(body, includeBody), { params: Promise.resolve({ id: 'project' }) })
  return { response, json: await response.json() }
}

test('an explicit UI read-through time cannot absorb messages arriving while POST is delayed', async () => {
  const through = new Date(Date.now() - 10_000).toISOString()
  const arrivedAfterSnapshot = new Date(Date.parse(through) + 2_000).toISOString()
  assert.ok(Date.parse(arrivedAfterSnapshot) < Date.now())
  const database = makeDatabase()
  const route = await loadRoute(database)

  const { response, json } = await postJson(route, { readThroughAt: through })

  assert.equal(response.status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.lastReadAt, through)
  assert.equal(Date.parse(arrivedAfterSnapshot) > Date.parse(json.lastReadAt), true)
  assert.equal(database.rows[0].last_read_at, through)
})

test('an older requested limit never moves an existing read marker backwards', async () => {
  const existing = new Date(Date.now() - 2_000).toISOString()
  const requested = new Date(Date.parse(existing) - 5_000).toISOString()
  const database = makeDatabase([{ project_id: 'project', user_id: 'viewer', last_read_at: existing }])
  const route = await loadRoute(database)

  const { response, json } = await postJson(route, { readThroughAt: requested })

  assert.equal(response.status, 200)
  assert.ok(Date.parse(json.lastReadAt) >= Date.parse(existing))
  assert.equal(Date.parse(database.rows[0].last_read_at) >= Date.parse(existing), true)
})

test('a delayed older write cannot overwrite a newer completed read request', async () => {
  const older = '2026-10-01T10:00:00.000Z'
  const newer = '2026-10-01T10:00:02.000Z'
  let releaseOlder
  let writingOlder
  const blocked = new Promise(resolve => { releaseOlder = resolve })
  const firstWriteStarted = new Promise(resolve => { writingOlder = resolve })
  let writes = 0
  const database = makeDatabase([], {
    beforeWrite: async () => {
      if (++writes === 1) {
        writingOlder()
        await blocked
      }
    },
  })
  const route = await loadRoute(database)
  const olderRequest = postJson(route, { readThroughAt: older })
  await firstWriteStarted
  try {
    const completed = await postJson(route, { readThroughAt: newer })
    assert.equal(completed.response.status, 200)
  } finally {
    releaseOlder()
  }
  assert.equal((await olderRequest).response.status, 200)
  assert.equal(database.rows[0].last_read_at, newer)
})

test('explicit read limits preserve the sub-millisecond precision from the message timestamp', async () => {
  const through = '2026-10-01T10:00:00.123456+00:00'
  const database = makeDatabase()
  const { response, json } = await postJson(await loadRoute(database), { readThroughAt: through })
  assert.equal(response.status, 200)
  assert.equal(json.lastReadAt, through)
  assert.equal(database.rows[0].last_read_at, through)
})

test('a future read-through value is capped at request time', async () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString()
  const database = makeDatabase()
  const route = await loadRoute(database)
  const startedAt = Date.now()

  const { response, json } = await postJson(route, { readThroughAt: future })

  if (response.status === 400) {
    assert.equal(database.writeAttempts.length, 0)
    return
  }
  assert.equal(response.status, 200)
  assert.ok(Date.parse(json.lastReadAt) < Date.parse(future))
  assert.ok(Date.parse(json.lastReadAt) <= Date.now())
  assert.ok(Date.parse(json.lastReadAt) >= startedAt - 1_000)
})

test('omitting the optional body still marks the chat read through the request time', async () => {
  const database = makeDatabase()
  const route = await loadRoute(database)
  const startedAt = Date.now()

  const { response, json } = await postJson(route, undefined, false)

  assert.equal(response.status, 200)
  assert.equal(json.ok, true)
  assert.ok(Number.isFinite(Date.parse(json.lastReadAt)))
  assert.ok(Date.parse(json.lastReadAt) >= startedAt - 1_000)
  assert.ok(Date.parse(json.lastReadAt) <= Date.now())
})

test('invalid timestamps and denied project access do not write a read marker', async t => {
  await t.test('invalid timestamp', async () => {
    const database = makeDatabase()
    const route = await loadRoute(database)
    const { response } = await postJson(route, { readThroughAt: 'not-a-timestamp' })
    assert.equal(response.status, 400)
    assert.equal(database.writeAttempts.length, 0)
  })

  await t.test('access denied', async () => {
    const database = makeDatabase()
    const route = await loadRoute(database, { ok: false, status: 403, error: 'Forbidden' })
    const { response } = await postJson(route, { readThroughAt: new Date().toISOString() })
    assert.equal(response.status, 403)
    assert.equal(database.writeAttempts.length, 0)
  })
})

test('database read and write failures return server errors', async t => {
  const originalError = console.error
  console.error = () => {}
  try {
    await t.test('reading the persisted marker fails', async () => {
      const database = makeDatabase([], { readError: new Error('database unavailable') })
      const route = await loadRoute(database)
      const { response } = await postJson(route, { readThroughAt: new Date().toISOString() })
      assert.equal(response.status, 500)
    })

    await t.test('saving the marker fails', async () => {
      const database = makeDatabase([], { upsertError: new Error('write unavailable') })
      const route = await loadRoute(database)
      const { response } = await postJson(route, { readThroughAt: new Date().toISOString() })
      assert.equal(response.status, 500)
      assert.equal(database.rows.length, 0)
    })
  } finally {
    console.error = originalError
  }
})
