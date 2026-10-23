import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRouteLoader } from './issue-110-route-loader.mjs'

// Real route sources, guards, Auth, RPCs and audit; only email delivery is stubbed.
export async function checkPhase3(ctx) {
  const { sql, probe, q, service, actor, fixture, data, finalize, finalArgs, cif, state, cancel, active, userClient, password, setLostReply, setRejectReads } = ctx
  const originalEnv = { ...process.env }
  const emailEnv = {
    RESEND_API_KEY: 'local-probe-no-delivery', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1', VERCEL_ENV: 'development',
    REMINDER_EMAIL_OVERRIDE_TO: 'probe@example.invalid', RESEND_FROM_EMAIL: 'internal@example.invalid',
    RESEND_CLIENT_NOTIFICATION_FROM_EMAIL: 'client@example.invalid',
  }
  Object.assign(process.env, emailEnv)
  const supabase = createRouteLoader()('app/api/_utils/supabase.ts')
  const login = async (person, selectedPassword = password) => data(await userClient().auth.signInWithPassword({ email: person.email, password: selectedPassword }), 'API fixture login').session.access_token
  const token = await login(actor)
  const client = async (role = 'client') => {
    const person = await fixture()
    data(await finalize(finalArgs(person, role)), 'API fixture finalization')
    return person
  }
  const audit = id => JSON.parse(sql("SELECT coalesce(jsonb_agg(jsonb_build_object('action',action_type,'old',old_values,'new',new_values)),'[]'::jsonb) FROM public.audit_logs WHERE entity_type='user' AND entity_id=" + q(id)))
  const absent = id => assert.equal(sql('SELECT count(*) FROM auth.users WHERE id=' + q(id)), '0', 'Only the newly created UUID was removed')
  const input = (overrides = {}) => ({ email: 'issue110.api.' + randomUUID() + '@example.invalid', fullName: 'API probe', role: 'client', cif: cif(), ...overrides })
  function api(options = {}) {
    const created = [], emails = [], calls = []
    const wrapped = {
      from: service.from.bind(service),
      auth: { admin: { createUser: async args => {
        const result = await service.auth.admin.createUser(args)
        if (result.data?.user) {
          const person = { id: result.data.user.id, email: args.email, password: args.password }
          created.push(person)
          await options.onCreated?.(person)
        }
        return result
      } } },
      rpc: async (name, args) => {
        calls.push({ name, target: args.p_target_id })
        const overridden = await options.onRpc?.(name, args)
        return overridden === undefined ? service.rpc(name, args) : overridden
      },
    }
    const load = createRouteLoader({
      'app/api/_utils/supabase.ts': { ...supabase, createSupabaseServiceClient: () => wrapped },
      resend: { Resend: class { emails = { send: async (message, sendOptions) => {
        const id = sendOptions.idempotencyKey.slice('welcome-user/'.length)
        const saved = state({ id })
        assert.ok(!saved.pending && saved.active && saved.temporary && saved.ban === null, 'Email requires confirmed activation')
        assert.equal(message.to, emailEnv.REMINDER_EMAIL_OVERRIDE_TO)
        assert.equal(message.from, saved.role === 'client' ? emailEnv.RESEND_CLIENT_NOTIFICATION_FROM_EMAIL : emailEnv.RESEND_FROM_EMAIL)
        emails.push(id)
        return options.mailFails === false ? { data: { id: 'local-email' } } : { error: { name: 'local_probe' } }
      } } } },
    })
    const { POST } = load('app/api/users/route.ts'), { PATCH } = load('app/api/users/[userId]/route.ts')
    const request = (body, selectedToken, method) => new Request('http://127.0.0.1/api/users', {
      method, headers: { 'Content-Type': 'application/json', ...(selectedToken ? { Authorization: 'Bearer ' + selectedToken } : {}) }, body: JSON.stringify(body),
    })
    return {
      created, emails, calls,
      post: (body, selectedToken = token) => POST(request(body, selectedToken, 'POST')),
      patch: (id, body, selectedToken = token) => PATCH(request(body, selectedToken, 'PATCH'), { params: Promise.resolve({ userId: id }) }),
    }
  }
  function noCredentials(body) {
    assert.ok(!Object.hasOwn(body, 'temporaryPassword') && !Object.hasOwn(body, 'emailSent') && !Object.hasOwn(body, 'userId'), 'An unconfirmed or failed creation exposes no credentials or success')
  }
  function barrier() {
    let count = 0, release
    const ready = new Promise(resolve => { release = resolve })
    return async () => {
      if (++count === 2) release()
      let timer
      try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Second concurrent API request did not arrive')), 10000) })]) }
      finally { clearTimeout(timer) }
    }
  }
  try {
    await probe('api_post_validation_and_authorization_precede_auth_creation', async () => {
      const route = api(), valid = input()
      for (const bad of [null, [], { ...valid, cif: null }, { ...valid, cif: 123 }, { ...valid, cif: 'RO12345678' }, { ...valid, cifCountry: 'US' }, { ...valid, cif: 'DE123456789', cifCountry: 'RO' }, { ...valid, telefon: [] }]) {
        const response = await route.post(bad)
        assert.equal(response.status, 400); noCredentials(await response.json())
      }
      assert.equal((await route.post(valid, null)).status, 401)
      const senior = await client('consultant')
      sql("UPDATE public.profiles SET consultant_level='senior' WHERE id=" + q(senior.id))
      assert.equal((await route.post(valid, await login(senior))).status, 403)
      assert.equal(route.created.length, 0); assert.equal(route.emails.length, 0)
    })
    await probe('api_post_pending_is_blocked_until_atomic_finalization_and_fallback_works', async () => {
      const body = input(), route = api({ onCreated: async person => {
        const saved = state(person)
        assert.ok(saved.pending && !saved.active && saved.ban, 'Pause after Auth keeps the account blocked')
        assert.equal(route.emails.length, 0)
        assert.ok((await userClient().auth.signInWithPassword({ email: person.email, password: person.password })).error, 'Pending cannot log in')
      } })
      body.cif = 'ro 000' + body.cif.slice(2)
      const response = await route.post(body), result = await response.json()
      assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.ok(result.emailSent === false && typeof result.temporaryPassword === 'string')
      const person = route.created[0], saved = state(person)
      assert.ok(!saved.pending && saved.active && saved.temporary && saved.ban === null)
      assert.equal(saved.cif, body.cif.replace('ro 000', 'RO'))
      const accessToken = await login(person, result.temporaryPassword)
      const guard = createRouteLoader()('app/api/_utils/auth.ts')
      assert.ok((await guard.requireProfile(new Request('http://127.0.0.1', { headers: { Authorization: 'Bearer ' + accessToken } }))).ok)
      const history = audit(person.id)
      assert.equal(history.length, 1); assert.equal(history[0].new.cif, saved.cif)
      assert.ok(!JSON.stringify(history).includes(result.temporaryPassword), 'Password absent from audit')
    })
    await probe('api_post_all_roles_and_fr_prefix_like_key_keep_email_contract', async () => {
      for (const role of ['client', 'consultant', 'admin']) {
        const route = api({ mailFails: false })
        const body = role === 'client' ? input({ cifCountry: 'FR', cif: 'DE987654321' }) : input({ role })
        if (role !== 'client') delete body.cif
        const response = await route.post(body), result = await response.json()
        assert.equal(response.status, 201); assert.equal(result.emailSent, true)
        assert.ok(!Object.hasOwn(result, 'temporaryPassword')); assert.equal(route.emails.length, 1)
        assert.equal(state(route.created[0]).cif, role === 'client' ? 'FRDE987654321' : null)
      }
    })
    await probe('api_early_duplicate_is_private_and_reserves_inactive_and_historical_cif', async () => {
      const owner = await client(), reserved = state(owner).cif
      data(await active(owner, false), 'Deactivate duplicate owner')
      for (const historical of [false, true]) {
        if (historical) sql("UPDATE public.profiles SET role='consultant' WHERE id=" + q(owner.id))
        const route = api(), response = await route.post(input({ cif: 'ro 000' + reserved.slice(2) })), body = await response.json()
        assert.equal(response.status, 409); assert.equal(body.code, 'CIF_DUPLICATE'); noCredentials(body)
        assert.ok(!JSON.stringify(body).includes(owner.id) && !JSON.stringify(body).includes(owner.email), 'No owner disclosure')
        assert.equal(route.created.length, 0); assert.equal(route.emails.length, 0)
      }
    })
    await probe('api_post_create_create_race_has_one_success_and_cancels_only_loser', async () => {
      const wait = barrier(), route = api({ onCreated: wait }), wanted = cif()
      const responses = await Promise.all([route.post(input({ cif: wanted })), route.post(input({ cif: wanted }))])
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409])
      const bodies = await Promise.all(responses.map(response => response.json()))
      noCredentials(bodies[responses.findIndex(response => response.status === 409)])
      const winner = bodies.find(body => body.userId).userId
      assert.equal(state({ id: winner }).cif, wanted)
      absent(route.created.find(person => person.id !== winner).id)
      assert.equal(route.emails.length, 1); assert.equal(audit(winner).length, 1)
    })
    await probe('api_finalization_rollback_cancels_new_uuid_without_email', async () => {
      const route = api({ onCreated: person => sql('INSERT INTO issue110_probe.faults VALUES(' + q(person.id) + ",'unban')") })
      const response = await route.post(input())
      assert.equal(response.status, 500); noCredentials(await response.json())
      absent(route.created[0].id); assert.equal(route.emails.length, 0)
    })
    await probe('api_failed_cleanup_remains_pending_blocked_and_reports_remediation', async () => {
      const route = api({
        onCreated: person => sql('INSERT INTO issue110_probe.faults VALUES(' + q(person.id) + ",'unban')"),
        onRpc: async (name, args) => {
          if (name !== 'finalize_new_user_account') return
          const result = await service.rpc(name, args)
          sql("UPDATE issue110_probe.faults SET stage='cleanup' WHERE target_id=" + q(args.p_target_id))
          return result
        },
      })
      const response = await route.post(input()), body = await response.json(), person = route.created[0]
      assert.equal(response.status, 500); assert.equal(body.code, 'ACCOUNT_CREATION_PENDING'); noCredentials(body)
      const saved = state(person)
      assert.ok(saved.pending && !saved.active && saved.ban); assert.equal(route.emails.length, 0)
      sql('DELETE FROM issue110_probe.faults WHERE target_id=' + q(person.id)); data(await cancel(person), 'Remove blocked cleanup fixture')
    })
    await probe('api_lost_committed_finalization_reply_reconciles_without_retry', async () => {
      const route = api({ onCreated: person => setLostReply(person.id) })
      const response = await route.post(input()), body = await response.json()
      assert.equal(response.status, 201); assert.ok(body.userId)
      assert.equal(route.calls.filter(call => call.name === 'finalize_new_user_account').length, 1)
      assert.equal(route.calls.filter(call => call.name === 'cancel_new_user_account').length, 0)
      assert.equal(route.emails.length, 1); assert.ok(!state(route.created[0]).pending)
    })
    await probe('api_unavailable_reconciliation_preserves_commit_without_success_or_email', async () => {
      const route = api({ onCreated: person => { setLostReply(person.id); setRejectReads(person.id) } })
      try {
        const response = await route.post(input()), body = await response.json()
        assert.equal(response.status, 503); assert.equal(body.code, 'ACCOUNT_CREATION_UNCONFIRMED'); noCredentials(body)
        assert.ok(!state(route.created[0]).pending); assert.equal(route.emails.length, 0)
        assert.equal(route.calls.filter(call => call.name === 'cancel_new_user_account').length, 0)
      } finally { setRejectReads(null); setLostReply(null) }
    })
    await probe('api_uncertain_pending_never_cancels_or_retries', async () => {
      const route = api({ onRpc: name => name === 'finalize_new_user_account' ? { data: null, error: { code: '', message: 'local network failure' } } : undefined })
      const response = await route.post(input()), body = await response.json(), person = route.created[0]
      assert.equal(response.status, 503); noCredentials(body)
      assert.ok(state(person).pending && !state(person).active)
      assert.equal(route.calls.length, 1); assert.equal(route.emails.length, 0)
      data(await cancel(person), 'Remove unconfirmed pending fixture')
    })
    await probe('api_patch_client_and_senior_cannot_submit_any_cif_key', async () => {
      for (const role of ['client', 'consultant']) {
        const person = await client(role), route = api()
        if (role === 'consultant') sql("UPDATE public.profiles SET consultant_level='senior' WHERE id=" + q(person.id))
        const accessToken = await login(person)
        for (const body of [{ cif: null }, { cif: '' }, { cif: state(person).cif }, { cif: 12 }, { cifCountry: 'RO' }]) {
          const response = await route.patch(person.id, body, accessToken)
          assert.equal(response.status, 403); assert.equal((await response.json()).code, 'CIF_FORBIDDEN')
        }
        assert.equal(route.calls.length, 0)
        assert.equal((await route.patch(person.id, { full_name: 'Own profile' }, accessToken)).status, 200)
      }
    })
    await probe('api_patch_validates_body_final_role_and_pending_state', async () => {
      const person = await client(), pending = await fixture(), route = api()
      for (const body of [[], null, { cif: null }, { cif: 12 }, { cif: 'RO12345678' }, { cifCountry: 'RO' }, { cif: cif(), cifCountry: 'US' }]) {
        assert.equal((await route.patch(person.id, body)).status, 400)
      }
      const response = await route.patch(pending.id, { full_name: 'Changed' })
      assert.equal(response.status, 409); assert.equal((await response.json()).code, 'ACCOUNT_CREATION_PENDING')
      data(await cancel(pending), 'Remove pending edit fixture')
    })
    await probe('api_patch_role_and_cif_are_atomic_history_is_preserved_and_noop_unaudited', async () => {
      const person = await client('consultant'), route = api(), wanted = cif()
      assert.equal((await route.patch(person.id, { role: 'client' })).status, 400)
      const change = await route.patch(person.id, { role: 'client', cifCountry: 'RO', cif: wanted.slice(2) })
      assert.equal(change.status, 200); assert.equal(state(person).cif, wanted); assert.equal(state(person).role, 'client')
      const before = audit(person.id).length
      const noop = await route.patch(person.id, { cif: 'ro 000' + wanted.slice(2) })
      assert.equal(noop.status, 200); assert.equal((await noop.json()).changed, false); assert.equal(audit(person.id).length, before)
      assert.equal((await route.patch(person.id, { role: 'consultant' })).status, 200)
      assert.equal(state(person).cif, wanted)
      assert.equal((await route.patch(person.id, { cif: cif() })).status, 403)
    })
    await probe('api_patch_same_target_concurrency_audits_the_committed_chain', async () => {
      const person = await client(), initial = state(person).cif, left = cif(), right = cif(), wait = barrier()
      const route = api({ onRpc: async name => { if (name === 'update_user_profile_guarded') await wait() } })
      const results = await Promise.all([route.patch(person.id, { cif: left }), route.patch(person.id, { cif: right })])
      assert.ok(results.every(response => response.status === 200))
      const history = audit(person.id)
      assert.equal(history.length, 2)
      const first = history.find(row => row.old.cif === initial), second = history.find(row => row !== first)
      assert.ok(first && second); assert.equal(second.old.cif, first.new.cif)
      assert.equal(second.new.cif, state(person).cif)
      assert.deepEqual([first.new.cif, second.new.cif].sort(), [left, right].sort())
    })
    await probe('api_patch_edit_edit_conflict_uses_unique_index_after_both_prechecks', async () => {
      const first = await client(), second = await client(), wanted = cif(), wait = barrier()
      const route = api({ onRpc: async name => { if (name === 'update_user_profile_guarded') await wait() } })
      const results = await Promise.all([route.patch(first.id, { cif: wanted }), route.patch(second.id, { cif: wanted })])
      assert.deepEqual(results.map(response => response.status).sort(), [200, 409])
      const conflict = await results.find(response => response.status === 409).json()
      assert.equal(conflict.code, 'CIF_DUPLICATE')
      assert.equal([state(first), state(second)].filter(saved => saved.cif === wanted).length, 1)
    })
    await probe('api_create_edit_race_has_one_owner_and_no_orphan_usable_account', async () => {
      const person = await client(), wanted = cif(), wait = barrier()
      const route = api({ onCreated: wait, onRpc: async name => { if (name === 'update_user_profile_guarded') await wait() } })
      const [created, edited] = await Promise.all([route.post(input({ cif: wanted })), route.patch(person.id, { cif: wanted })])
      assert.ok((created.status === 201 && edited.status === 409) || (created.status === 409 && edited.status === 200))
      const body = await created.json(), fresh = route.created[0]
      if (created.status === 201) {
        assert.equal(state(fresh).cif, wanted); assert.equal(route.emails.length, 1)
      } else {
        noCredentials(body); absent(fresh.id); assert.equal(route.emails.length, 0)
        assert.equal(state(person).cif, wanted)
      }
    })
  } finally {
    setRejectReads(null); setLostReply(null)
    for (const key of Object.keys(emailEnv)) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]
    }
  }
}
