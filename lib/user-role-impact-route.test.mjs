import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouteLoader } from '../scripts/issue-110-route-loader.mjs'

const actorId = '10000000-0000-4000-8000-000000000001'
const targetId = '10000000-0000-4000-8000-000000000002'
const params = { params: Promise.resolve({ userId: targetId }) }
const request = body => new Request('http://127.0.0.1/impact', { method: 'POST', body: JSON.stringify(body) })

function scenario({ authorized = true, data = null, error = null } = {}) {
  const calls = []
  const load = createRouteLoader({
    'app/api/_utils/auth.ts': {
      requireAdmin: async () => authorized ? { ok: true, user: { id: actorId } } : { ok: false, status: 403 },
      guardToResponse: result => Response.json({ message: 'Forbidden' }, { status: result.status }),
    },
    'app/api/_utils/supabase.ts': {
      createSupabaseServiceClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data, error } } }),
    },
  })
  return { post: load('app/api/users/[userId]/role-impact/route.ts').POST, calls }
}

test('impact rejects unauthorized requests before accessing the database', async () => {
  const api = scenario({ authorized: false })
  assert.equal((await api.post(request({ role: 'admin' }), params)).status, 403)
  assert.deepEqual(api.calls, [])
})

test('impact rejects malformed or unsupported operations without an RPC', async () => {
  const api = scenario()
  for (const body of [null, [], {}, { role: 'client' }, { consultant_level: 'expert' }, { is_active: 'false' }, { role: 'admin', page: 0 }, { role: 'admin', extra: true }]) {
    assert.equal((await api.post(request(body), params)).status, 400)
  }
  const malformed = new Request('http://127.0.0.1/impact', { method: 'POST', body: '{' })
  assert.equal((await api.post(malformed, params)).status, 400)
  assert.equal((await api.post(request({ role: 'admin' }), { params: Promise.resolve({ userId: 'invalid' }) })).status, 404)
  assert.deepEqual(api.calls, [])
})

test('impact returns the complete database inventory and exact totals', async () => {
  const blockers = Array.from({ length: 41 }, (_, i) => ({ id: String(i), kind: 'activity', title: 'Activitate', reason: 'Reatribuie', project_id: 'p1' }))
  const data = { target_id: targetId, changes: { role: 'admin' }, checked_at: '2026-11-02T10:00:00Z', blockers, information: [], totals: { blockers: 41, information: 0 }, warnings: [] }
  const api = scenario({ data })
  const response = await api.post(request({ role: 'admin' }), params)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.blockers, blockers)
  assert.deepEqual(body.totals, { blockers: 41, information: 0 })
  assert.deepEqual(api.calls, [{ name: 'user_role_change_impact', args: { p_target_id: targetId, p_actor_id: actorId, p_changes: { role: 'admin' } } }])
})

test('impact maps database conflicts without exposing details', async () => {
  const api = scenario({ error: { code: 'P0001', message: 'ACCOUNT_CREATION_PENDING', details: 'private' } })
  const response = await api.post(request({ role: 'admin' }), params)
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.code, 'ACCOUNT_CREATION_PENDING')
  assert.equal(JSON.stringify(body).includes('private'), false)
})

test('impact never treats malformed RPC output as an empty inventory', async () => {
  const valid = { target_id: targetId, changes: { role: 'admin' }, checked_at: '2026-11-02T10:00:00Z', blockers: [], information: [], totals: { blockers: 0, information: 0 }, warnings: [] }
  for (const data of [null, { ...valid, totals: { blockers: 1, information: 0 } }, { ...valid, checked_at: 'invalid' }, { ...valid, target_id: actorId }]) {
    const api = scenario({ data })
    assert.equal((await api.post(request({ role: 'admin' }), params)).status, 500)
  }
})
