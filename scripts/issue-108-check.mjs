// Independent acceptance owned and executed by the orchestrator. Local fixtures and in-memory email only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const parseEnv = file => Object.fromEntries(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
  .filter(line => line.includes('=') && !line.trim().startsWith('#'))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')] }))
const env = parseEnv(process.env.E2E_ENV_FILE || '.env.e2e.localdb')
const base = process.env.ISSUE108_BASE_URL || env.E2E_BASE_URL
for (const value of [base, env.E2E_SUPABASE_URL]) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname), 'Local-only acceptance')
assert.ok(env.E2E_WRITES === '1' && env.E2E_TEST_PROJECT === '1', 'Explicit dedicated test configuration')
const auth = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
const service = createClient(env.E2E_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth })
const client = token => createClient(env.E2E_SUPABASE_URL, env.E2E_SUPABASE_ANON_KEY, { auth,
  ...(token ? { global: { headers: { Authorization: 'Bearer ' + token } } } : {}) })
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const hash = value => createHash('sha256').update(value).digest('hex')
const fixtures = [], messages = [], results = []
const stamp = randomUUID().slice(0, 8)
let actor, browser, mailMode = 'success', current = 'setup'
const mockPort = Number(process.env.ISSUE108_MOCK_PORT || 6261)
const selected = process.env.ISSUE108_CHECK_ONLY
const passed = (value, message) => assert.ok(value, message)
function sql(query) {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_platforma-fonduri', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-v', 'VERBOSITY=sqlstate'], {
      input: "set log_min_error_statement='panic'; set log_parameter_max_length_on_error=0; set statement_timeout='15s'; " + query,
      encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    throw new Error('Local SQL check failed ' + (String(error.stderr).match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] || 'unknown'))
  }
}
const jsonSql = query => JSON.parse(sql(query))
async function rpc(name, args) {
  const result = await service.rpc(name, args)
  passed(!result.error, 'RPC failed: ' + name + ' ' + (result.error?.code || ''))
  return result.data
}
async function fixture(role = 'client', level = 'junior') {
  const person = { email: 'issue108.' + stamp + '.' + fixtures.length + '@example.invalid', password: 'Original-' + randomUUID() }
  const made = await service.auth.admin.createUser({ email: person.email, password: person.password, email_confirm: true })
  passed(!made.error && made.data.user, 'Create own fixture')
  person.id = made.data.user.id
  fixtures.push(person)
  const changed = await service.from('profiles').update({ role, consultant_level: level, full_name: 'Issue108 ' + stamp + ' ' + fixtures.length }).eq('id', person.id)
  passed(!changed.error, 'Prepare own fixture profile')
  return person
}
async function login(person, password = person.password) {
  const signed = await client().auth.signInWithPassword({ email: person.email, password })
  passed(!signed.error && signed.data.session, 'Fixture password login')
  const session = signed.data.session
  return { token: session.access_token, refresh: session.refresh_token,
    sessionId: JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString()).session_id }
}
async function call(path, { token = actor?.token, body, raw, method = 'POST' } = {}) {
  const response = await fetch(base + path, { method, headers: {
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    'Content-Type': 'application/json', Origin: base,
  }, ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }), signal: AbortSignal.timeout(25000) })
  return { status: response.status, data: await response.json().catch(() => null), headers: response.headers }
}
const reset = (person, attemptId = randomUUID(), options = {}) => call('/api/users/' + person.id + '/reset-password',
  { body: { attemptId, expectedEmail: person.email }, ...options })
const args = (person, attempt = randomUUID(), password = 'New-' + randomUUID()) => ({
  p_actor_id: actor.id, p_actor_session_id: actor.sessionId, p_target_id: person.id,
  p_attempt_id: attempt, p_expected_email: person.email, p_password: password,
})
const ident = (person, attempt) => ({ p_actor_id: actor.id, p_actor_session_id: actor.sessionId, p_target_id: person.id, p_attempt_id: attempt })
const snapshot = person => jsonSql("select jsonb_build_object('hash',u.encrypted_password,'marker',p.must_change_password,'active',p.is_active,'flow',(select to_jsonb(f) from account_recovery.flows f where f.user_id=u.id),'sessions',(select count(*) from auth.sessions where user_id=u.id),'receipts',(select count(*) from account_recovery.admin_password_resets where user_id=u.id),'audit',(select count(*) from public.audit_logs where entity_id=u.id and action_type='password_reset_completed')) from auth.users u join public.profiles p on p.id=u.id where u.id=" + q(person.id))
const lifecycle = (person, active) => rpc('set_user_account_active', { p_actor_id: actor.id, p_target_id: person.id, p_active: active })
const temporaryFromMail = message => /Parola temporar[ăa]:\s*(\S+)/u.exec(message.body.text)?.[1]
function seedFlow(person) {
  const flowId = randomUUID(), secret = randomBytes(32).toString('base64url'), tokenHash = hash(secret)
  sql("insert into account_recovery.flows(user_id,flow_id,token_hash,email,state,issued_at,expires_at) values(" +
    [q(person.id), q(flowId), q(tokenHash), q(person.email), "'issued'", 'clock_timestamp()', "clock_timestamp()+interval '1 hour'"].join(',') +
    ") on conflict(user_id) do update set flow_id=excluded.flow_id,token_hash=excluded.token_hash,email=excluded.email,state='issued',issued_at=excluded.issued_at,expires_at=excluded.expires_at,attempt_id=null,completed_at=null; update public.profiles set password_reset_requested_at=clock_timestamp() where id=" + q(person.id))
  return { p_flow_id: flowId, p_token_hash: tokenHash }
}
const mock = http.createServer((request, response) => {
  let raw = ''
  request.on('data', chunk => { raw += chunk })
  request.on('end', () => {
    const body = JSON.parse(raw || '{}'), mode = mailMode
    const item = { key: request.headers['idempotency-key'], body, mode }
    messages.push(item)
    response.setHeader('Content-Type', 'application/json')
    if (mode === 'reject') { response.writeHead(422); response.end(JSON.stringify({ name: 'validation_error', message: 'Fixture rejection' })); return }
    if (mode === 'server') { response.writeHead(503); response.end('{}'); return }
    if (mode === 'missing_id') { response.end('{}'); return }
    if (mode === 'timeout') {
      const timer = setTimeout(() => { if (!response.destroyed) response.end(JSON.stringify({ id: randomUUID() })) }, 11000)
      timer.unref(); return
    }
    response.end(JSON.stringify({ id: randomUUID() }))
  })
})
async function group(name, action) {
  if (selected && !selected.split(',').includes(name)) return
  current = name
  await action()
  results.push({ name, passed: true })
  console.log('PASS ' + name)
}
function concurrentSql(query) {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_platforma-fonduri', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'], { windowsHide: true })
  let output = ''
  child.stdout.on('data', part => { output += part })
  child.stderr.on('data', () => {})
  child.stdin.end("set log_min_error_statement='panic'; set log_parameter_max_length_on_error=0; set statement_timeout='15s'; " + query)
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, output })) })
}
async function waitLock(name) {
  for (let n = 0; n < 60; n++) {
    if (sql("select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name=" + q(name) + " and l.locktype='advisory' and l.classid=105 and l.objid=1 and l.granted)") === 't') return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Concurrent transaction barrier missing')
}

try {
  await new Promise((resolve, reject) => { mock.once('error', reject); mock.listen(mockPort, '127.0.0.1', resolve) })
  actor = await fixture('admin'); Object.assign(actor, await login(actor))

  await group('private_state_and_privileged_boundaries', async () => {
    const secured = jsonSql("select jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity,'anon',has_table_privilege('anon',oid,'SELECT'),'authenticated',has_table_privilege('authenticated',oid,'SELECT'),'service',has_table_privilege('service_role',oid,'SELECT')) from pg_class where oid='account_recovery.admin_password_resets'::regclass")
    passed(secured.rls && secured.force && !secured.anon && !secured.authenticated && !secured.service, 'Private receipt is inaccessible directly')
    const unsafe = Number(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'admin_reset_password%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))"))
    passed(unsafe === 0, 'Public RPCs deny anon/authenticated')
    const person = await fixture(), attempt = randomUUID()
    const anonymous = await reset(person, attempt, { token: null })
    passed(anonymous.status === 401, 'Anonymous API denied')
    for (const [role, level] of [['client', 'junior'], ['consultant', 'junior'], ['consultant', 'senior']]) {
      const other = await fixture(role, level), session = await login(other)
      passed((await reset(person, randomUUID(), { token: session.token })).status === 403, 'Non-admin API denied')
    }
    passed((await reset(actor)).status === 409, 'Self reset denied')
    passed((await call('/api/users/not-a-uuid/reset-password', { body: { attemptId: attempt, expectedEmail: person.email } })).status === 400, 'Invalid path denied')
    for (const body of [{ attemptId: 'bad', expectedEmail: person.email }, { attemptId: attempt, expectedEmail: person.email, password: 'unsafe' }, { attemptId: attempt, expectedEmail: person.email, userId: actor.id }]) {
      passed((await call('/api/users/' + person.id + '/reset-password', { body })).status === 400, 'Bad or extra body fields denied')
    }
    passed((await call('/api/users/' + person.id + '/reset-password', { raw: '{"broken":' })).status === 400, 'Malformed JSON denied')
    const oversized = await call('/api/users/' + person.id + '/reset-password', { raw: JSON.stringify({ attemptId: attempt, expectedEmail: person.email, padding: 'x'.repeat(6000) }) })
    passed([400, 413].includes(oversized.status), 'Oversized body denied')
    const before = hash(JSON.stringify(snapshot(person)))
    passed((await reset(person, attempt, { body: { attemptId: attempt, expectedEmail: 'changed@example.invalid' } })).status === 409, 'Stale confirmation email denied')
    passed(before === hash(JSON.stringify(snapshot(person))), 'Rejected requests preserve credentials and state')
  })

  await group('roles_password_sessions_email_and_audit', async () => {
    mailMode = 'success'
    for (const role of ['client', 'consultant', 'admin']) {
      const person = await fixture(role), old = await login(person), start = messages.length
      const result = await reset(person)
      passed(result.status === 200 && result.data.status === 'completed' && result.data.deliveryStatus === 'sent', 'Reset succeeds for eligible role')
      passed(!('temporaryPassword' in result.data), 'No fallback when sent')
      passed(result.headers.get('cache-control')?.includes('no-store') && result.headers.get('referrer-policy') === 'no-referrer', 'Sensitive response headers')
      passed(messages.length === start + 1, 'One password email')
      const password = temporaryFromMail(messages.at(-1))
      passed(typeof password === 'string' && /^[A-HJ-NP-Z2-9]{20}$/.test(password), 'Shared generated password format')
      passed(messages.at(-1).key === 'admin-password-reset/' + result.data.attemptId, 'Stable per-attempt delivery key')
      passed(messages.at(-1).body.to === 'issue108@example.invalid' || messages.at(-1).body.to?.[0] === 'issue108@example.invalid', 'Development delivery override')
      passed(messages.at(-1).body.text.includes(person.email) && /administrator/i.test(messages.at(-1).body.text), 'Reset context and account identity in mail')
      passed(Boolean((await client().auth.signInWithPassword({ email: person.email, password: person.password })).error), 'Old password refused')
      await login(person, password)
      passed(snapshot(person).marker === true, 'Temporary marker set')
      const oldClient = client(old.token)
      const active = await oldClient.rpc('current_account_session_active')
      passed(active.error || active.data === false, 'Copied JWT session rejected by RPC guard')
      const me = await call('/api/me', { token: old.token, method: 'GET' })
      passed(me.status === 401, 'Copied JWT rejected by API')
      const data = await oldClient.from('profiles').select('id').eq('id', actor.id)
      passed(Boolean(data.error) || !data.data?.length, 'Copied JWT cannot read another profile through Data API')
      passed(Boolean((await client().auth.refreshSession({ refresh_token: old.refresh })).error), 'Old refresh token refused')
      const audits = jsonSql("select coalesce(jsonb_agg(jsonb_build_object('actor',user_id,'source',new_values->>'source','values',new_values,'description',description)),'[]') from public.audit_logs where entity_id=" + q(person.id) + " and action_type='password_reset_completed'")
      passed(audits.length === 1 && audits[0].actor === actor.id && audits[0].source === 'admin_reset', 'One real administrative reset audit')
      passed(!JSON.stringify(audits).includes(password), 'No password in audit')
    }
  })

  await group('fallback_retry_concurrency_and_supersession', async () => {
    mailMode = 'reject'
    const person = await fixture(), attempt = randomUUID(), start = messages.length
    const answers = await Promise.all([reset(person, attempt), reset(person, attempt)])
    passed(answers.every(answer => answer.status === 200), 'Concurrent same-attempt requests complete')
    passed(answers.filter(answer => answer.data.temporaryPassword).length === 1, 'Only initial response can reveal fallback')
    passed(messages.length === start + 1, 'Concurrent attempt sends once')
    const before = snapshot(person), replay = await reset(person, attempt)
    passed(replay.data.replayed === true && !replay.data.temporaryPassword, 'Replay confirms without password')
    passed(snapshot(person).hash === before.hash && snapshot(person).audit === 1, 'Replay preserves hash and single audit')
    const newer = await reset(person), currentHash = snapshot(person).hash
    passed(newer.data.temporaryPassword && snapshot(person).marker, 'Repeated reset while marker already true')
    const delayed = await reset(person, attempt)
    passed(delayed.data.replayed && !delayed.data.temporaryPassword && snapshot(person).hash === currentHash, 'Delayed old attempt cannot replace or reveal newer password')
    const otherActor = await fixture('admin'), otherSession = await login(otherActor)
    passed((await reset(person, attempt, { token: otherSession.token })).status === 409, 'Receipt is bound to original actor')
    passed((await reset(await fixture(), attempt)).status === 409, 'Receipt is bound to original target')
  })

  await group('unknown_delivery_never_reveals_or_resets_twice', async () => {
    for (const mode of ['server', 'missing_id', 'timeout']) {
      mailMode = mode
      const person = await fixture(), attempt = randomUUID(), start = messages.length
      const result = await reset(person, attempt)
      passed(result.status === 200 && result.data.status === 'completed' && result.data.deliveryStatus === 'unknown' && !result.data.temporaryPassword, 'Unconfirmed provider result stays unknown')
      const before = snapshot(person), replay = await reset(person, attempt)
      passed(replay.data.replayed && !replay.data.temporaryPassword && snapshot(person).hash === before.hash, 'Unknown delivery replay does not reset/reveal')
      passed(messages.length === start + 1, 'Unknown delivery is not automatically resent')
    }
  })

  await group('eligibility_and_revoked_actor', async () => {
    const person = await fixture(), before = snapshot(person)
    await lifecycle(person, false)
    passed((await reset(person)).status === 409 && snapshot(person).hash === before.hash, 'Inactive target refused without password change')
    await lifecycle(person, true)
    sql("begin; select pg_advisory_xact_lock(105,1); update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=" + q(person.id) + "; commit;")
    passed((await reset(person)).status === 409 && snapshot(person).hash === before.hash, 'Independent Auth ban refused')
    sql("begin; select pg_advisory_xact_lock(105,1); update auth.users set banned_until=null where id=" + q(person.id) + "; update public.profiles set email='divergent@example.invalid' where id=" + q(person.id) + "; commit;")
    passed((await reset(person)).status === 409, 'Divergent Auth/profile refused')
    sql("update public.profiles set email=" + q(person.email) + ",auth_sync_pending=true where id=" + q(person.id))
    passed((await reset(person)).status === 409, 'Incomplete Auth sync refused')
    sql("update public.profiles set auth_sync_pending=false where id=" + q(person.id))
    const other = await fixture('admin'), old = await login(other)
    sql("delete from auth.sessions where id=" + q(old.sessionId))
    const denied = await service.rpc('admin_reset_password', { ...args(person), p_actor_id: other.id, p_actor_session_id: old.sessionId })
    passed(denied.error?.message === 'ADMIN_SESSION_INVALID', 'Actor session revalidated in mutation')
    passed((await reset(person, randomUUID(), { token: old.token })).status === 401, 'Revoked actor rejected by API')
  })

  await group('delivery_and_fallback_generation_fences', async () => {
    for (const change of ['email_cycle', 'lifecycle_cycle', 'new_reset', 'recovery']) {
      const person = await fixture(), attempt = randomUUID()
      await rpc('admin_reset_password', args(person, attempt))
      if (change === 'email_cycle') sql("begin; select pg_advisory_xact_lock(105,1); update auth.users set email='alternate." + stamp + "@example.invalid' where id=" + q(person.id) + "; update public.profiles set email='alternate." + stamp + "@example.invalid' where id=" + q(person.id) + "; update auth.users set email=" + q(person.email) + " where id=" + q(person.id) + "; update public.profiles set email=" + q(person.email) + " where id=" + q(person.id) + "; commit;")
      if (change === 'lifecycle_cycle') { await lifecycle(person, false); await lifecycle(person, true) }
      if (change === 'new_reset') await rpc('admin_reset_password', args(person))
      if (change === 'recovery') {
        const proof = seedFlow(person)
        passed((await rpc('recovery_complete', { ...proof, p_attempt_id: randomUUID(), p_password: 'Chosen-' + randomUUID() })).status === 'completed', 'Recovery can replace temporary password')
      }
      passed((await rpc('admin_reset_password_prepare_delivery', ident(person, attempt))).status === 'skipped', 'Superseded delivery is skipped')
      passed((await rpc('admin_reset_password_claim_fallback', ident(person, attempt))).allowed === false, 'Superseded fallback denied')
    }
    const person = await fixture(), attempt = randomUUID()
    await rpc('admin_reset_password', args(person, attempt))
    const changed = await service.from('profiles').update({ full_name: 'Renamed fixture' }).eq('id', person.id)
    passed(!changed.error, 'Unrelated name edit fixture')
    passed((await rpc('admin_reset_password_prepare_delivery', ident(person, attempt))).status === 'send', 'Name-only edit does not supersede reset')
    await rpc('admin_reset_password_finish_delivery', { p_target_id: person.id, p_attempt_id: attempt, p_outcome: 'failed', p_reason: 'provider_rejected' })
    passed((await rpc('admin_reset_password_claim_fallback', ident(person, attempt))).allowed === true, 'Eligible failed attempt can claim fallback')
    passed((await rpc('admin_reset_password_claim_fallback', ident(person, attempt))).allowed === false, 'Fallback claim is one-time')
  })

  await group('old_and_new_recovery_contract', async () => {
    const person = await fixture(), old = seedFlow(person)
    mailMode = 'success'
    const resetResult = await reset(person)
    passed(resetResult.data.status === 'completed', 'Admin reset completes')
    passed((await rpc('recovery_inspect', old)).status === 'invalid', 'Old proof/form is invalid')
    passed(sql("select password_reset_requested_at is null from public.profiles where id=" + q(person.id)) === 't', 'Invalidated generation cooldown closed')
    const fresh = seedFlow(person), password = 'Chosen-' + randomUUID()
    passed((await rpc('recovery_complete', { ...fresh, p_attempt_id: randomUUID(), p_password: password })).status === 'completed', 'New recovery completes')
    passed(snapshot(person).marker === false, 'New recovery clears marker')
    await login(person, password)
  })

  await group('atomic_reset_and_postcommit_audit_reconciliation', async () => {
    const person = await fixture(), old = await login(person), proof = seedFlow(person), attempt = randomUUID()
    const before = hash(JSON.stringify(snapshot(person)))
    const guard = "create function public.issue108_audit_fault_" + stamp + "() returns trigger language plpgsql as $$ begin if current_setting('issue108.audit_fault',true)='reset' and new.action_type='password_reset_completed' or current_setting('issue108.audit_fault',true)='delivery' and new.action_type='notify' and new.new_values->>'source'='admin_reset_delivery' then raise exception 'FIXTURE_AUDIT_FAILURE'; end if; return new; end $$; create trigger issue108_audit_fault_" + stamp + " before insert on public.audit_logs for each row execute function public.issue108_audit_fault_" + stamp + "(); "
    const rolled = sql("begin; " + guard + "set local issue108.audit_fault='reset'; do $$ begin begin perform public.admin_reset_password(" + [actor.id, actor.sessionId, person.id, attempt, person.email, 'New-' + randomUUID()].map(q).join(',') + "); raise exception 'EXPECTED_AUDIT_FAILURE_NOT_SEEN'; exception when others then if sqlerrm <> 'FIXTURE_AUDIT_FAILURE' then raise; end if; end; end $$; rollback; select true;")
    passed(rolled.endsWith('t') && hash(JSON.stringify(snapshot(person))) === before, 'Mandatory audit failure rolls back all reset state')
    passed((await rpc('recovery_inspect', proof)).status === 'valid', 'Rollback preserves recovery')
    const late = sql("begin; " + guard + "do $$ declare v jsonb; v_hash text; begin perform public.admin_reset_password(" +
      [actor.id, actor.sessionId, person.id, attempt, person.email, 'New-' + randomUUID()].map(q).join(',') +
      "); perform public.admin_reset_password_prepare_delivery(" + [actor.id, actor.sessionId, person.id, attempt].map(q).join(',') +
      "); select encrypted_password into v_hash from auth.users where id=" + q(person.id) +
      "; perform set_config('issue108.audit_fault','delivery',true); v:=public.admin_reset_password_finish_delivery(" +
      [person.id, attempt, 'failed', 'provider_rejected'].map(q).join(',') +
      "); if v->>'delivery_status'<>'failed' or (v->>'delivery_audited')::boolean is distinct from false then raise exception 'LATE_AUDIT_STATE'; end if; " +
      "perform set_config('issue108.audit_fault','',true); v:=public.admin_reset_password_finish_delivery(" + [person.id, attempt].map(q).join(',') +
      "); if (v->>'delivery_audited')::boolean is distinct from true then raise exception 'DELIVERY_AUDIT_NOT_REPAIRED'; end if; " +
      "if (select encrypted_password from auth.users where id=" + q(person.id) + ") is distinct from v_hash then raise exception 'REPAIR_CHANGED_PASSWORD'; end if; " +
      "if (select count(*) from public.audit_logs where entity_id=" + q(person.id) + " and action_type='notify' and new_values->>'source'='admin_reset_delivery')<>1 then raise exception 'DELIVERY_AUDIT_NOT_UNIQUE'; end if; " +
      "v:=public.admin_reset_password_finish_delivery(" + [person.id, attempt].map(q).join(',') + "); " +
      "if (select count(*) from public.audit_logs where entity_id=" + q(person.id) + " and action_type='notify' and new_values->>'source'='admin_reset_delivery')<>1 then raise exception 'DUPLICATE_DELIVERY_AUDIT'; end if; " +
      "end $$; rollback; select true;")
    passed(late.endsWith('t'), 'Delivery audit failure retains outcome and repairs without a second mutation')
    passed(old.sessionId.length > 0, 'Session fixture exists')
  })

  await group('actor_auth_restrictions_revalidated_at_mutation', async () => {
    mailMode = 'reject'
    const person = await fixture(), alternate = await fixture('admin'), session = await login(alternate)
    const before = snapshot(person).hash, start = messages.length, tag = 'issue108_ban_' + stamp
    const ban = concurrentSql("begin; set application_name=" + q(tag) + "; select pg_advisory_xact_lock(105,1); update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=" + q(alternate.id) + "; select pg_sleep(2); commit;")
    await waitLock(tag)
    const answer = await reset(person, randomUUID(), { token: session.token })
    passed((await ban).code === 0, 'Concurrent actor ban completes')
    passed(answer.status === 401 && !answer.data?.temporaryPassword && snapshot(person).hash === before && messages.length === start, 'Ban after HTTP guard prevents reset, delivery and fallback')

    for (const stage of ['delivery', 'fallback']) {
      sql("update auth.users set banned_until=null where id=" + q(alternate.id))
      const target = await fixture(), attempt = randomUUID()
      const identity = { p_actor_id: alternate.id, p_actor_session_id: session.sessionId, p_target_id: target.id, p_attempt_id: attempt }
      await rpc('admin_reset_password', { ...args(target, attempt), ...identity })
      if (stage === 'fallback') {
        await rpc('admin_reset_password_prepare_delivery', identity)
        await rpc('admin_reset_password_finish_delivery', { p_target_id: target.id, p_attempt_id: attempt, p_outcome: 'failed', p_reason: 'provider_rejected' })
      }
      sql("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=" + q(alternate.id))
      if (stage === 'delivery') {
        const prepared = await rpc('admin_reset_password_prepare_delivery', identity)
        passed(prepared.status === 'skipped' && prepared.reason === 'actor_ineligible', 'Actor ban before handoff skips delivery')
      } else {
        passed((await rpc('admin_reset_password_claim_fallback', identity)).allowed === false, 'Actor ban before disclosure denies fallback')
      }
    }
    passed(sql("begin; update auth.users set banned_until=null,deleted_at=clock_timestamp() where id=" + q(alternate.id) + "; select not account_recovery.admin_reset_actor_session_active(" + [alternate.id, session.sessionId].map(q).join(',') + "); rollback;").endsWith('t'), 'Soft-deleted Auth actor is ineligible')
  })

  await group('abandoned_delivery_reconciliation', async () => {
    const start = messages.length
    for (const phase of ['pending', 'claimed']) {
      const person = await fixture(), attempt = randomUUID()
      await rpc('admin_reset_password', args(person, attempt))
      if (phase === 'claimed') await rpc('admin_reset_password_prepare_delivery', ident(person, attempt))
      const before = snapshot(person).hash
      const inProgress = await reset(person, attempt)
      passed(inProgress.data.replayed && inProgress.data.deliveryAuditPending === true, 'A retry leaves an active delivery attempt unfinished')
      sql("update account_recovery.admin_password_resets set created_at=clock_timestamp()-interval '2 minutes'" + (phase === 'claimed' ? ",delivery_started_at=clock_timestamp()-interval '2 minutes'" : '') + " where attempt_id=" + q(attempt))
      for (let n = 0; n < 2; n++) {
        const replay = await reset(person, attempt)
        passed(replay.status === 200 && replay.data.replayed && replay.data.deliveryStatus === 'unknown' && !replay.data.deliveryAuditPending && !replay.data.temporaryPassword, 'Retry closes an abandoned attempt and repairs its audit without disclosure')
      }
      passed((await rpc('admin_reset_password_prepare_delivery', ident(person, attempt))).status === 'skipped', 'A delayed handoff cannot send after reconciliation')
      const late = await rpc('admin_reset_password_finish_delivery', { p_target_id: person.id, p_attempt_id: attempt, p_outcome: 'failed', p_reason: 'provider_rejected' })
      passed(late.delivery_status === 'unknown' && late.delivery_audited === true, 'Late result cannot overwrite a reconciled unknown outcome')
      passed((await rpc('admin_reset_password_claim_fallback', ident(person, attempt))).allowed === false, 'Reconciliation never enables fallback')
      passed(Number(sql("select count(*) from public.audit_logs where entity_id=" + q(person.id) + " and new_values->>'source'='admin_reset_delivery'")) === 1, 'Reconciliation writes exactly one delivery audit')
      passed(snapshot(person).hash === before && snapshot(person).audit === 1 && messages.length === start, 'Reconciliation does not reset again or send another email')
    }
    const person = await fixture(), attempt = randomUUID()
    await rpc('admin_reset_password', args(person, attempt))
    const finished = await rpc('admin_reset_password_finish_delivery', { p_target_id: person.id, p_attempt_id: attempt, p_outcome: 'failed', p_reason: 'delivery_not_started' })
    passed(finished.delivery_status === 'failed' && finished.delivery_audited === true, 'A failed prepare RPC records a certain failure for its still-pending receipt')
    passed((await rpc('admin_reset_password_claim_fallback', ident(person, attempt))).allowed === true, 'A delivery that never started allows the revalidated fallback')
    const other = await fixture(), otherAttempt = randomUUID()
    await rpc('admin_reset_password', args(other, otherAttempt))
    const rejected = await rpc('admin_reset_password_finish_delivery', { p_target_id: other.id, p_attempt_id: otherAttempt, p_outcome: 'failed', p_reason: 'provider_rejected' })
    passed(rejected.delivery_status === 'pending', 'Only delivery_not_started can fail a pending receipt')
  })

  await group('deactivation_ordering_and_no_false_success', async () => {
    const person = await fixture(), original = snapshot(person).hash, tag = 'issue108_first_' + stamp
    const first = concurrentSql("begin; set application_name=" + q(tag) + "; select pg_advisory_xact_lock(105,1); select pg_sleep(1.5); select public.set_user_account_active(" + [person.id, actor.id].map(q).join(',') + ",false); commit;")
    await waitLock(tag)
    const result = await reset(person)
    passed((await first).code === 0 && result.status === 409 && snapshot(person).hash === original, 'Deactivation first prevents password change')
    await lifecycle(person, true)
    const attempt = randomUUID(), tag2 = 'issue108_reset_' + stamp
    const firstReset = concurrentSql("begin; set application_name=" + q(tag2) + "; select pg_advisory_xact_lock(105,1); select public.admin_reset_password(" + [actor.id, actor.sessionId, person.id, attempt, person.email, 'New-' + randomUUID()].map(q).join(',') + "); select pg_sleep(1.5); commit;")
    await waitLock(tag2)
    await lifecycle(person, false)
    passed((await firstReset).code === 0 && snapshot(person).hash !== original && snapshot(person).active === false, 'Reset first persists password while later deactivation blocks access')
    passed((await rpc('admin_reset_password_prepare_delivery', ident(person, attempt))).status === 'skipped', 'Post-reset deactivation skips pending mail')
  })

  await group('deletion_audit_and_operational_cleanup', async () => {
    const person = await fixture(), attempt = randomUUID()
    await rpc('admin_reset_password', args(person, attempt))
    const actorBlockers = await rpc('user_account_blockers', { p_target_id: actor.id })
    passed(actorBlockers.some(item => item.kind === 'public.audit_logs.user_id'), 'Administrative reset blocks actor deletion')
    const targetBlockers = await rpc('user_account_blockers', { p_target_id: person.id })
    passed(targetBlockers.length === 0, 'Target-only audit and operational receipt do not block deletion')
    const erased = await rpc('delete_empty_user_account', { p_actor_id: actor.id, p_target_id: person.id })
    passed(erased.deleted === true && sql("select count(*) from account_recovery.admin_password_resets where user_id=" + q(person.id)) === '0', 'Target deletion cascades transient receipt')
    person.deleted = true
    passed(Number(sql("select count(*) from public.audit_logs where entity_id=" + q(person.id) + " and action_type='password_reset_completed'")) === 1, 'Deletion preserves reset audit')
  })

  await group('storage_and_existing_realtime_session_revocation', async () => {
    mailMode = 'success'
    const person = await fixture('admin'), previous = await login(person)
    const oldClient = client(previous.token), storagePath = person.id + '/issue108-proof.txt', notificationIds = []
    const projectClient = await fixture()
    const project = await service.from('projects').insert({title:'Issue108 fixture ' + stamp,client_id:projectClient.id}).select('id').single()
    passed(!project.error && project.data?.id, 'Create own project fixture for notification FK')
    const projectId = project.data.id
    let oldEvents = 0, newEvents = 0, freshClient
    const waitUntil = async predicate => { for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('Realtime fixture event missing') }
    const subscribe = async (who, increment) => {
      const channel = who.channel('issue108-' + randomUUID()).on('postgres_changes', {event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.' + person.id}, increment)
      await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(new Error('Realtime subscription timeout')),10000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}else if(status==='CHANNEL_ERROR'){clearTimeout(timer);reject(new Error('Realtime subscription failed'))}}) })
      return channel
    }
    const notify = async () => {
      const id = randomUUID(); notificationIds.push(id)
      const result = await service.from('notifications').insert({id,user_id:person.id,project_id:projectId,type:'document_action',entity_type:'project',entity_id:projectId,title:'Issue108 fixture',event_key:'issue108:'+id,actor_id:actor.id,actor_name:'Issue108'})
      passed(!result.error, 'Insert own notification fixture')
    }
    try {
      passed(!(await service.storage.from('project-files').upload(storagePath, Buffer.from('Issue108 fixture proof'), {contentType:'text/plain'})).error, 'Upload own Storage fixture')
      passed(!(await oldClient.storage.from('project-files').download(storagePath)).error, 'Valid original JWT can read Storage fixture')
      await oldClient.realtime.setAuth(previous.token)
      await subscribe(oldClient, () => { oldEvents++ })
      await notify()
      await waitUntil(() => oldEvents === 1)
      const result = await reset(person)
      passed(result.data.status === 'completed' && result.data.deliveryStatus === 'sent', 'Reset realtime fixture account')
      passed(Boolean((await oldClient.storage.from('project-files').download(storagePath)).error), 'Revoked JWT cannot download through Storage')
      passed(Boolean((await oldClient.storage.from('project-files').createSignedUrl(storagePath,60)).error), 'Revoked JWT cannot issue another signed URL')
      const session = await login(person,temporaryFromMail(messages.at(-1)))
      freshClient = client(session.token)
      passed(!(await freshClient.storage.from('project-files').download(storagePath)).error, 'New verified session can still read Storage fixture')
      await freshClient.realtime.setAuth(session.token)
      await subscribe(freshClient, () => { newEvents++ })
      await notify()
      await waitUntil(() => newEvents === 1)
      await new Promise(resolve=>setTimeout(resolve,300))
      passed(oldEvents === 1, 'Already-open Realtime subscription receives no events after reset')
    } finally {
      await oldClient.removeAllChannels()
      if(freshClient)await freshClient.removeAllChannels()
      await service.storage.from('project-files').remove([storagePath])
      if(notificationIds.length)await service.from('notifications').delete().in('id',notificationIds)
      passed(!(await service.from('projects').delete().eq('id',projectId)).error, 'Clean own project fixture')
    }
  })

  await group('welcome_template_escaping_and_metadata', async () => {
    mailMode = 'success'
    const person = await fixture()
    const dangerous = '<img src=x onerror=alert(1)> & "quoted"'
    passed(!(await service.from('profiles').update({ full_name: dangerous, nume_firma: dangerous }).eq('id', person.id)).error, 'Prepare escaped email fields')
    const answer = await fetch(base + '/api/users/' + person.id + '/reset-password', {
      method: 'POST', headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json', 'User-Agent': 'x'.repeat(2000) },
      body: JSON.stringify({ attemptId: randomUUID(), expectedEmail: person.email }),
    })
    const data = await answer.json()
    passed(answer.status === 200 && data.deliveryStatus === 'sent', 'Long UA and absent IP headers do not block reset')
    const rendered = messages.at(-1).body
    passed(rendered.html.includes('&lt;img') && !rendered.html.includes(dangerous), 'HTML fields escaped')
    passed(rendered.text.includes('\n') && rendered.text.includes(dangerous), 'Plain text retains actual newlines and literal fields')
    const welcome = { email: 'issue108.' + stamp + '.welcome@example.invalid', password: null }
    const created = await call('/api/users', { body: { email: welcome.email, fullName: dangerous, role: 'client', numeFirma: dangerous } })
    passed(created.status === 201 && created.data.userId && created.data.emailSent === true, 'Shared welcome email still sends')
    welcome.id = created.data.userId; fixtures.push(welcome)
    const message = messages.at(-1).body
    passed(message.subject === 'Bun venit în Bonie' && message.html.includes('&lt;img') && !message.html.includes(dangerous), 'Welcome subject and escaping preserved')
    passed(message.text.includes('Ai acum acces la Bonie pentru ' + dangerous) && message.text.includes('\n'), 'Welcome content preserved')
    const password = temporaryFromMail(messages.at(-1))
    passed(password?.length === 20, 'Welcome reuses generated temporary password')
    await login(welcome, password)
  })

  await group('actor_expiry_auth_eligibility_and_posthandoff_result', async () => {
    const person = await fixture(), alternate = await fixture('admin'), session = await login(alternate)
    sql("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=" + q(session.sessionId))
    const expired = await service.rpc('admin_reset_password', { ...args(person), p_actor_id: alternate.id, p_actor_session_id: session.sessionId })
    passed(expired.error?.message === 'ADMIN_SESSION_INVALID', 'Expired actor session denied inside DB')
    const freshSession = await login(alternate)
    passed(!(await service.from('profiles').update({ role: 'consultant' }).eq('id', alternate.id)).error, 'Demote own fixture actor')
    const demoted = await service.rpc('admin_reset_password', { ...args(person), p_actor_id: alternate.id, p_actor_session_id: freshSession.sessionId })
    passed(demoted.error?.message === 'ACTIVE_ADMIN_REQUIRED', 'Current actor role enforced')
    sql("update auth.users set email_confirmed_at=null where id=" + q(person.id))
    passed((await reset(person)).status === 409, 'Unconfirmed Auth target denied')
    sql("update auth.users set email_confirmed_at=clock_timestamp() where id=" + q(person.id))
    const attempt = randomUUID()
    await rpc('admin_reset_password', args(person, attempt))
    passed((await rpc('admin_reset_password_prepare_delivery', ident(person, attempt))).status === 'send', 'Eligible handoff claimed')
    await lifecycle(person, false)
    const finished = await rpc('admin_reset_password_finish_delivery', { p_target_id: person.id, p_attempt_id: attempt, p_outcome: 'sent', p_provider_id: randomUUID() })
    passed(finished.delivery_status === 'sent' && finished.is_current === false && finished.delivery_audited === true, 'Later deactivation does not rewrite an accepted handoff as omitted')
    passed((await rpc('admin_reset_password_claim_fallback', ident(person, attempt))).allowed === false, 'No fallback after later deactivation')
  })

  if (process.env.ISSUE108_CONFIG_PROBE === '1') await group('missing_configuration_fallback', async () => {
    const person = await fixture(), attempt = randomUUID(), start = messages.length
    const answer = await reset(person, attempt)
    passed(answer.status === 200 && answer.data.status === 'completed' && answer.data.deliveryStatus === 'failed' && answer.data.temporaryPassword?.length === 20, 'Missing sender configuration returns initial safe fallback ' + JSON.stringify({http:answer.status,status:answer.data?.status,delivery:answer.data?.deliveryStatus,hasFallback:Boolean(answer.data?.temporaryPassword),code:answer.data?.code}))
    passed(messages.length === start, 'Configuration refusal does not call email provider')
    const replay = await reset(person, attempt)
    passed(replay.data.replayed && !replay.data.temporaryPassword, 'Configuration fallback is not returned on retry')
    await login(person, answer.data.temporaryPassword)
  })

  await group('browser_dialogs_fallback_close_refresh_and_mobile', async () => {
    mailMode = 'reject'
    const person = await fixture(), inactive = await fixture()
    await lifecycle(inactive, false)
    browser = await chromium.launch()
    let page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
    await page.goto(base + '/login')
    await page.getByLabel('Email', { exact: true }).fill(actor.email)
    await page.getByLabel('Parolă', { exact: true }).fill(actor.password)
    await page.getByRole('button', { name: 'Intră în cont', exact: true }).click()
    await page.waitForURL(url => !url.pathname.includes('/login'))
    await page.goto(base + '/admin/users/' + person.id)
    await page.getByRole('button', { name: 'Resetează parola', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    passed((await dialog.innerText()).includes(person.email), 'Confirmation shows saved email')
    await dialog.getByRole('button', { name: 'Confirmă resetarea', exact: true }).click()
    const passwordField = dialog.getByRole('textbox', { name: /parol[ăa] temporară/i })
    await passwordField.waitFor()
    const revealed = await passwordField.inputValue()
    passed(revealed.length === 20, 'Initial failed mail fallback visible')
    await page.keyboard.press('Escape')
    passed(await page.getByRole('dialog').count() === 0, 'Escape closes result')
    passed(!(await page.locator('body').innerText()).includes(revealed), 'Closing removes password')
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    passed(!storage.includes(revealed), 'Password not retained in browser storage')
    await page.reload()
    passed(!(await page.locator('body').innerText()).includes(revealed), 'Refresh removes password')
    const endpoint = '**/api/users/' + person.id + '/reset-password'
    const attempts = []
    let intercepted = 0
    const start = messages.length
    await page.route(endpoint, async route => {
      attempts.push(JSON.parse(route.request().postData()).attemptId)
      if (intercepted++ === 0) { await route.fetch(); await route.abort('failed') }
      else await route.continue()
    })
    await page.getByRole('button', { name: 'Resetează parola', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmă resetarea', exact: true }).click()
    await page.getByRole('button', { name: 'Verifică rezultatul', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Verifică rezultatul', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Gata', exact: true }).waitFor()
    passed(attempts.length === 2 && attempts[0] === attempts[1] && messages.length === start + 1, 'Browser retry reuses attempt without another delivery')
    passed(await page.getByRole('textbox', { name: /parol[ăa] temporară/i }).count() === 0, 'Lost response retry does not reveal fallback again')
    await page.keyboard.press('Escape')
    await page.unroute(endpoint)

    let releaseResponse, notifyResponseReady
    const released = new Promise(resolve => { releaseResponse = resolve })
    const responseReady = new Promise(resolve => { notifyResponseReady = resolve })
    await page.route(endpoint, async route => {
      const answer = await route.fetch()
      notifyResponseReady()
      await released
      await route.fulfill({ response: answer }).catch(() => {})
    })
    await page.getByRole('button', { name: 'Resetează parola', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmă resetarea', exact: true }).click()
    await responseReady
    await page.getByRole('dialog').getByRole('button', { name: 'Închide', exact: true }).first().click()
    await page.getByRole('button', { name: 'Resetează parola', exact: true }).click()
    releaseResponse()
    await new Promise(resolve => setTimeout(resolve, 200))
    passed(await page.getByRole('dialog').getByRole('button', { name: 'Confirmă resetarea', exact: true }).isVisible(), 'Late response cannot replace a reopened confirmation')
    passed(await page.getByRole('textbox', { name: /parol[ăa] temporară/i }).count() === 0, 'Late response cannot resurrect password after close')
    await page.keyboard.press('Escape')
    await page.unroute(endpoint)

    await page.goto(base + '/admin/users/' + actor.id)
    passed(await page.getByRole('button', { name: 'Resetează parola', exact: true }).count() === 0, 'Own detail hides reset')
    await page.goto(base + '/admin/users/' + inactive.id)
    passed(await page.getByRole('button', { name: 'Resetează parola', exact: true }).count() === 0, 'Inactive detail hides reset')
    const mobileState = await page.context().storageState(); await page.close(); page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: mobileState })
    await page.goto(base + '/admin/users/' + person.id)
    const action = page.getByRole('button', { name: 'Resetează parola', exact: true })
    await action.waitFor()
    passed((await action.boundingBox()).height >= 44, 'Touch target height')
    await action.click()
    passed(await page.getByRole('dialog').isVisible(), 'Mobile dialog usable')
    const bounds = await page.getByRole('dialog').boundingBox()
    passed(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Mobile dialog fits viewport')
    await page.keyboard.press('Escape')
    await page.goto(base + '/admin/users')
    await page.getByRole('button', { name: 'Resetează parola', exact: true }).first().waitFor(); passed(await page.getByRole('button', { name: 'Resetează parola', exact: true }).count() > 0, 'List reset placement exists')
    const listActions = page.getByLabel('Rolul lui ' + person.email, { exact: true }).locator('..')
    await listActions.getByRole('button', { name: 'Resetează parola', exact: true }).click()
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/users' && response.request().method() === 'GET' && response.status() === 200)
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmă resetarea', exact: true }).click()
    const listPassword = page.getByRole('textbox', { name: /parol[ăa] temporară/i })
    await listPassword.waitFor()
    await refreshed
    await page.waitForTimeout(200)
    passed(await listPassword.isVisible() && (await listPassword.inputValue()).length === 20, 'List refresh preserves the initial fallback')
    await page.keyboard.press('Escape')

    await listActions.getByRole('button', { name: 'Resetează parola', exact: true }).click()
    const changedEmail = 'issue108.' + stamp + '.changed@example.invalid'
    passed(!(await service.auth.admin.updateUserById(person.id, { email: changedEmail, email_confirm: true })).error, 'Change own fixture Auth email')
    passed(!(await service.from('profiles').update({ email: changedEmail }).eq('id', person.id)).error, 'Change own fixture saved email')
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmă resetarea', exact: true }).click()
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'Adresa contului s-a schimbat. Reîncarcă pagina' }).waitFor()
    await browser.close(); browser = null
  })
} catch (error) {
  results.push({ name: current, passed: false, error: error instanceof Error ? error.message.split('\n')[0] : 'Acceptance failed' })
  console.error('FAIL ' + current + ': ' + (error instanceof Error ? error.message.split('\n')[0] : 'Acceptance failed'))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  const cleaner = await service.from('profiles').select('id').eq('email', env.E2E_STAFF_EMAIL).eq('role', 'admin').eq('is_active', true).maybeSingle()
  if (cleaner.data?.id) {
    for (const person of fixtures.filter(item => !item.deleted).reverse()) {
      try {
        const deleted = await service.rpc('delete_empty_user_account', { p_actor_id: cleaner.data.id, p_target_id: person.id })
        if (deleted.error) await service.rpc('set_user_account_active', { p_actor_id: cleaner.data.id, p_target_id: person.id, p_active: false })
      } catch { results.push({ name: 'fixture_cleanup', passed: false }) }
    }
  } else results.push({ name: 'fixture_cleanup_admin_missing', passed: false })
  await new Promise(resolve => mock.close(resolve))
  fs.mkdirSync('playwright-report', { recursive: true })
  fs.writeFileSync('playwright-report/issue-108-results.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  console.log(JSON.stringify({ passed: results.filter(item => item.passed).length, total: results.length }))
}
