import assert from 'node:assert/strict'
import test from 'node:test'
import { checkCifAvailable, finalizeCreatedAccount, persistedAuthTimestamp, userCifConflict } from '../app/api/_utils/user-creation.ts'
import { createRouteLoader } from '../scripts/issue-110-route-loader.mjs'

const actorId = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const duplicate = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_cif_unique"', details: 'private account data' }
const input = { userId, actorId, ban: '2036-10-22T10:00:00.123456Z', role: 'client', cif: 'RO5258486', profile: { full_name: 'Test' } }
const states = {
  pending: { creation_pending: true, is_active: false }, finalized: { creation_pending: false, is_active: true },
  inactive: { creation_pending: false, is_active: false }, absent: null,
}
function fakeCreation({ state = 'pending', after = state, failure = duplicate, cancelError = null, ack = false, loseCancel = false } = {}) {
  const calls = [], filters = []
  let cancelled = false
  const admin = {
    calls, filters,
    from(table) {
      assert.equal(table, 'profiles')
      const query = {
        select() { return query }, eq(key, value) { filters.push([key, value]); return query },
        neq(key, value) { filters.push(['neq', key, value]); return query }, limit() { return query },
        async maybeSingle() { const current = cancelled ? after : state; return { data: states[current], error: current === 'unknown' ? { code: 'offline' } : null } },
      }
      return query
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'finalize_new_user_account') return { data: ack ? { finalized: true, userId } : null, error: ack ? null : failure }
      assert.equal(name, 'cancel_new_user_account')
      cancelled = true
      if (loseCancel) throw new Error('lost response')
      return { data: cancelError ? null : { deleted: true, userId }, error: cancelError }
    },
  }
  return admin
}

test('CIF duplicate classification names exactly the unique index and never copies SQL details', () => {
  const result = userCifConflict(duplicate)
  assert.equal(result.status, 409); assert.equal(result.body.code, 'CIF_DUPLICATE')
  assert.equal(JSON.stringify(result).includes('private'), false)
  for (const error of [{ ...duplicate, code: 'P0001' }, { ...duplicate, message: 'duplicate key value violates unique constraint "other_index"' }, { ...duplicate, message: 'unique constraint "profiles_cif_unique_extra"' }, null]) assert.equal(userCifConflict(error), null)
})
test('initial Auth ban preserves six microseconds without rounding or Date conversion', () => {
  for (const suffix of ['123456001', '123456499', '123456999']) assert.equal(persistedAuthTimestamp('2036-10-22T10:00:00.' + suffix + 'Z'), input.ban)
  assert.equal(persistedAuthTimestamp('2036-10-22T10:00:00.123456789+03:00'), '2036-10-22T10:00:00.123456+03:00')
  for (const value of [null, undefined, 1, '', 'not a date', '2036-13-22T10:00:00Z']) assert.equal(persistedAuthTimestamp(value), null)
})
test('confirmed finalization never reads or cancels the account', async () => {
  const admin = fakeCreation({ ack: true })
  assert.deepEqual(await finalizeCreatedAccount(admin, input), { ok: true })
  assert.equal(admin.calls.length, 1); assert.deepEqual(admin.filters, [])
})
test('lost finalization reply reconciles by UUID without a second finalization', async () => {
  const admin = fakeCreation({ state: 'finalized', failure: { code: '', message: 'network failure' } })
  assert.deepEqual(await finalizeCreatedAccount(admin, input), { ok: true })
  assert.equal(admin.calls.length, 1); assert.deepEqual(admin.filters, [['id', userId]])
})
test('unknown reads and an uncertain pending outcome neither cancel nor return credentials', async () => {
  for (const state of ['pending', 'unknown']) {
    const admin = fakeCreation({ state, failure: { code: '', message: 'network failure' } })
    const result = await finalizeCreatedAccount(admin, input)
    assert.equal(result.status, 503); assert.equal(result.body.code, 'ACCOUNT_CREATION_UNCONFIRMED')
    assert.equal(admin.calls.length, 1)
    assert.equal('temporaryPassword' in result.body, false)
  }
})
test('a definite duplicate cancels only the pending UUID and returns a private conflict', async () => {
  const admin = fakeCreation()
  const result = await finalizeCreatedAccount(admin, input)
  assert.equal(result.status, 409); assert.equal(result.body.code, 'CIF_DUPLICATE')
  assert.deepEqual(admin.calls[1], { name: 'cancel_new_user_account', args: { p_target_id: userId, p_actor_id: actorId } })
  assert.equal('userId' in result.body, false)
})
test('a failed cleanup leaves an explicit blocked outcome', async () => {
  const admin = fakeCreation({ cancelError: { code: 'P0001' } })
  const result = await finalizeCreatedAccount(admin, input)
  assert.equal(result.status, 500); assert.equal(result.body.code, 'ACCOUNT_CREATION_PENDING')
})
test('lost cleanup reply is reconciled; a concurrent successful finalization is preserved', async () => {
  for (const [after, expected] of [['absent', false], ['finalized', true]]) {
    const admin = fakeCreation({ after, loseCancel: true })
    assert.equal((await finalizeCreatedAccount(admin, input)).ok, expected)
    assert.equal(admin.calls.length, 2)
  }
})
test('a finalized inactive account is never reactivated or reported as successful', async () => {
  const admin = fakeCreation({ state: 'inactive' })
  const result = await finalizeCreatedAccount(admin, input)
  assert.equal(result.body.code, 'ACCOUNT_CREATION_INACTIVE'); assert.equal(admin.calls.length, 1)
})
test('a missing ban cancels before finalization and cannot unban an account', async () => {
  const admin = fakeCreation()
  assert.equal((await finalizeCreatedAccount(admin, { ...input, ban: null })).body.code, 'ACCOUNT_CREATION_FAILED')
  assert.deepEqual(admin.calls.map(call => call.name), ['cancel_new_user_account'])
})
test('availability checks all profiles and excludes only the edited UUID', async () => {
  const admin = fakeCreation({ state: 'absent' })
  assert.equal(await checkCifAvailable(admin, input.cif, userId), null)
  assert.deepEqual(admin.filters, [['cif', input.cif], ['neq', 'id', userId]])
  assert.equal((await checkCifAvailable(fakeCreation({ state: 'unknown' }), input.cif)).status, 503)
})

function routes({ role = 'admin', profile = {}, dbOld = {}, dbNew = {}, changed = false, rpcError = null, lookupError = null, duplicateFound = false, mailFails = true } = {}) {
  const events = [], audit = [], queries = [], authUsers = []
  const old = { id: userId, email: 'target@example.invalid', role: 'client', cif: input.cif, creation_pending: false, consultant_level: 'junior', ...profile }
  let finalized = false
  const admin = {
    from(table) {
      const query = {
        columns: '', filters: [], select(columns) { query.columns = columns; return query },
        eq(key, value) { query.filters.push([key, value]); return query }, neq(key, value) { query.filters.push(['neq', key, value]); return query },
        limit() { return query },
        async maybeSingle() {
          queries.push({ table, columns: query.columns, filters: query.filters })
          return { data: query.columns.includes('full_name') ? old : duplicateFound ? { id: 'other', creation_pending: false } : null, error: lookupError }
        },
      }
      return query
    },
    auth: { admin: { async createUser(args) { events.push('auth'); authUsers.push(args); return { data: { user: { id: userId, banned_until: input.ban } }, error: null } } } },
    async rpc(name, args) {
      events.push({ name, args })
      if (name === 'finalize_new_user_account') { finalized = true; return { data: { finalized: true, userId }, error: null } }
      return { data: { profile: { ...old, ...dbNew }, changed, oldValues: dbOld, newValues: dbNew }, error: rpcError }
    },
  }
  const context = { ok: true, user: { id: role === 'admin' ? actorId : userId }, profile: { role, email: 'actor@example.invalid' }, isAdmin: role === 'admin' }
  const load = createRouteLoader({
    'app/api/_utils/auth.ts': { requireAdmin: async () => role === 'admin' ? context : { ok: false, status: 403 }, requireUserOrAdmin: async () => context, guardToResponse: result => Response.json({ message: 'Forbidden' }, { status: result.status }) },
    'app/api/_utils/supabase.ts': { createSupabaseServiceClient: () => admin },
    'app/api/_utils/audit.ts': { logUserAction: async entry => audit.push(entry), getClientIP: () => 'local', getUserAgent: () => 'test' },
    resend: { Resend: class { emails = { send: async () => { assert.equal(finalized, true); events.push('email'); return mailFails ? { error: {} } : { data: { id: 'local-email' } } } } } },
  })
  return { post: load('app/api/users/route.ts').POST, patch: load('app/api/users/[userId]/route.ts').PATCH, events, audit, queries, authUsers }
}
const request = body => new Request('http://127.0.0.1/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const target = { params: Promise.resolve({ userId }) }
const validPost = { email: 'new@example.invalid', fullName: 'Test', role: 'client', cif: 'ro 0005258486', cifCountry: 'RO' }

test('POST validates CIF and all optional field types before touching Auth', async () => {
  const api = routes()
  for (const body of [
    { ...validPost, cif: null }, { ...validPost, cif: 5258486 }, { ...validPost, cif: 'RO12345678' },
    { ...validPost, cif: 'DE123456789' }, { ...validPost, cifCountry: 'US' }, { ...validPost, telefon: [] },
    { ...validPost, role: 'admin' }, [], null,
  ]) assert.ok((await api.post(request(body))).status >= 400)
  assert.equal(api.authUsers.length, 0)
})
test('POST refuses non-admin, duplicates and missing schema before creating Auth', async () => {
  for (const [options, status] of [[{ role: 'consultant' }, 403], [{ duplicateFound: true }, 409], [{ lookupError: { code: '42703' } }, 503]]) {
    const api = routes(options)
    assert.equal((await api.post(request(validPost))).status, status)
    assert.equal(api.authUsers.length, 0)
  }
})
test('POST finalizes with a ban and canonical CIF, then audits without the fallback password', async () => {
  const api = routes()
  const response = await api.post(request(validPost)), body = await response.json()
  assert.equal(response.status, 201); assert.equal(body.emailSent, false); assert.equal(typeof body.temporaryPassword, 'string')
  assert.equal(api.authUsers[0].ban_duration, '87600h')
  const final = api.events.find(event => event.name === 'finalize_new_user_account')
  assert.equal(final.args.p_cif, input.cif); assert.equal(final.args.p_profile.full_name, 'Test')
  assert.equal('role' in final.args.p_profile, false)
  assert.equal(api.audit[0].newValues.cif, input.cif)
  assert.equal(JSON.stringify(api.audit).includes(body.temporaryPassword), false)
})
test('POST sends welcome only after finalization and returns no password when email succeeds', async t => {
  const env = { ...process.env }
  t.after(() => { for (const key of ['RESEND_API_KEY','NEXT_PUBLIC_APP_URL','VERCEL_ENV','REMINDER_EMAIL_OVERRIDE_TO']) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key] } })
  Object.assign(process.env, { RESEND_API_KEY: 'local-test', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1', VERCEL_ENV: 'development', REMINDER_EMAIL_OVERRIDE_TO: 'probe@example.invalid' })
  const api = routes({ mailFails: false })
  const response = await api.post(request(validPost)), body = await response.json()
  assert.equal(response.status, 201); assert.equal(body.emailSent, true); assert.equal('temporaryPassword' in body, false)
  assert.ok(api.events.indexOf('email') > api.events.findIndex(event => event.name === 'finalize_new_user_account'))
})
test('POST creates admin and consultant without CIF', async () => {
  for (const role of ['admin', 'consultant']) {
    const api = routes()
    const response = await api.post(request({ email: 'internal@example.invalid', fullName: 'Test', role }))
    assert.equal(response.status, 201)
    assert.equal(api.events.find(event => event.name === 'finalize_new_user_account').args.p_cif, null)
  }
})
test('PATCH rejects any CIF or country key from a non-admin before reading the target', async () => {
  for (const role of ['client', 'consultant']) {
    const api = routes({ role })
    for (const body of [{ cif: null }, { cif: '' }, { cif: input.cif }, { cif: 1 }, { cifCountry: 'RO' }]) {
      const response = await api.patch(request(body), target)
      assert.equal(response.status, 403); assert.equal((await response.json()).code, 'CIF_FORBIDDEN')
    }
    assert.equal(api.queries.length, 0)
  }
})
test('PATCH validates country-only, arrays, missing/invalid CIF and pending targets', async () => {
  const api = routes()
  for (const body of [{ cifCountry: 'RO' }, [], { cif: null }, { cif: 'RO12345678' }]) assert.equal((await api.patch(request(body), target)).status, 400)
  assert.equal((await routes({ profile: { creation_pending: true } }).patch(request({ full_name: 'New' }), target)).status, 409)
})
test('PATCH saves role plus normalized CIF together, without writing an old CIF for unrelated edits', async () => {
  const api = routes({ profile: { role: 'consultant', cif: null } })
  assert.equal((await api.patch(request({ role: 'client', cif: 'fr de987654321', cifCountry: 'FR' }), target)).status, 200)
  assert.deepEqual(api.events[0].args.p_changes, { role: 'client', cif: 'FRDE987654321' })
  const own = routes()
  await own.patch(request({ full_name: 'New name' }), target)
  assert.deepEqual(own.events[0].args.p_changes, { full_name: 'New name' })
})
test('PATCH uses transactional audit values rather than the earlier profile read', async () => {
  const api = routes({ changed: true, dbOld: { cif: 'RO4221306' }, dbNew: { cif: input.cif } })
  const response = await api.patch(request({ cif: input.cif }), target)
  assert.equal(response.status, 200)
  assert.deepEqual(api.audit[0].oldValues, { cif: 'RO4221306' }); assert.deepEqual(api.audit[0].newValues, { cif: input.cif })
  const noOp = routes()
  await noOp.patch(request({ cif: input.cif }), target)
  assert.equal(noOp.audit.length, 0)
})
test('PATCH maps only the CIF unique index to a duplicate response', async () => {
  const api = routes({ rpcError: duplicate })
  assert.equal((await api.patch(request({ cif: input.cif }), target)).status, 409)
  const other = routes({ rpcError: { code: '23505', message: 'unique constraint "other_index"' } })
  assert.equal((await other.patch(request({ cif: input.cif }), target)).status, 500)
})
