// Auditul în bloc: un singur insert pentru toate intrările, cu aceleași rânduri
// ca scrierea una câte una. Duplicarea unei faze mari producea peste o sută de
// inserturi secvențiale înainte de răspuns, deci testul ține numărul de cereri
// HTTP, nu doar conținutul lor.

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

/** PostgREST fals: numără cererile spre audit_logs și reține rândurile primite. */
async function fakePostgrest({ rejectBulk = false } = {}) {
  const state = { requests: 0, rows: [], bodies: [] }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const payload = body ? JSON.parse(body) : null
      const rows = Array.isArray(payload) ? payload : [payload]
      const isBulk = Array.isArray(payload) && payload.length > 1
      state.requests += 1
      state.bodies.push(payload)
      if (rejectBulk && isBulk) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'insert în bloc respins' }))
        return
      }
      state.rows.push(...rows)
      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.end('[]')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cheie-de-test'
  return { state, close: () => new Promise(resolve => server.close(resolve)) }
}

const { logAction, logActions } = await import('../app/api/_utils/audit.ts')

const entry = i => ({
  actorId: '11111111-1111-4111-8111-111111111111',
  actionType: 'create',
  entityType: 'document_request',
  entityId: `22222222-2222-4222-8222-00000000000${i}`,
  entityName: `Cerere ${i}`,
  newValues: { project_title: 'Proiect', password: 'secret', source_name: `Sursa ${i}` },
  description: `Duplicare cerere ${i}`,
  ipAddress: '127.0.0.1',
  userAgent: 'test',
})

test('toate intrările pleacă într-o singură cerere', async () => {
  const { state, close } = await fakePostgrest()
  try {
    await logActions(Array.from({ length: 12 }, (_, i) => entry(i)))
    assert.equal(state.requests, 1, 'auditul în bloc trebuie să facă un singur round-trip')
    assert.equal(state.rows.length, 12, 'nicio intrare nu se pierde')
  } finally {
    await close()
  }
})

test('rândurile sunt identice cu cele scrise una câte una', async () => {
  const entries = Array.from({ length: 3 }, (_, i) => entry(i))

  const single = await fakePostgrest()
  try {
    for (const item of entries) await logAction(item)
  } finally {
    await single.close()
  }

  const bulk = await fakePostgrest()
  try {
    await logActions(entries)
  } finally {
    await bulk.close()
  }

  assert.equal(single.state.rows.length, 3)
  assert.deepEqual(bulk.state.rows, single.state.rows)
  // Cheile sensibile rămân redactate și pe drumul în bloc.
  assert.equal(bulk.state.rows[0].new_values.password, '[redacted]')
})

test('un insert în bloc respins nu pierde istoricul: se reîncearcă rând cu rând', async () => {
  const { state, close } = await fakePostgrest({ rejectBulk: true })
  try {
    await logActions(Array.from({ length: 5 }, (_, i) => entry(i)))
    assert.equal(state.requests, 6, 'o încercare în bloc, apoi câte una per rând')
    assert.equal(state.rows.length, 5, 'toate rândurile ajung totuși în audit')
  } finally {
    await close()
  }
})

test('lista goală nu atinge baza, iar una singură rămâne un insert', async () => {
  const { state, close } = await fakePostgrest()
  try {
    await logActions([])
    assert.equal(state.requests, 0)
    await logActions([entry(0)])
    assert.equal(state.requests, 1)
  } finally {
    await close()
  }
})

test('eșecul auditului nu se propagă în afară', async () => {
  const previousUrl = process.env.SUPABASE_URL
  process.env.SUPABASE_URL = 'http://127.0.0.1:1'
  try {
    await logActions(Array.from({ length: 3 }, (_, i) => entry(i)))
  } finally {
    process.env.SUPABASE_URL = previousUrl
  }
})
