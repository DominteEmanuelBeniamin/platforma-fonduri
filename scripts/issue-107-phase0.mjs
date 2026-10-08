// Local evidence for #107, not the recovery implementation.
// E2E_ENV_FILE=.env.e2e.localdb ISSUE107_BASE_URL=http://127.0.0.1:3107 node scripts/issue-107-phase0.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(fs.readFileSync(process.env.E2E_ENV_FILE || '.env.e2e.localdb', 'utf8').split('\n')
  .filter(line => line.includes('=') && !line.trim().startsWith('#'))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')] }))
for (const [key, value] of Object.entries(process.env)) if (key.startsWith('E2E_') && value) env[key] = value
assert.equal(env.E2E_WRITES, '1', 'Dedicated local writes must be enabled')
assert.equal(env.E2E_TEST_PROJECT, '1', 'A dedicated test project is required')
const baseUrl = process.env.ISSUE107_BASE_URL || 'http://127.0.0.1:3107'
for (const url of [baseUrl, env.E2E_SUPABASE_URL]) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Local URLs only')
const settings = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
const service = createClient(env.E2E_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, settings)
const client = token => createClient(env.E2E_SUPABASE_URL, env.E2E_SUPABASE_ANON_KEY, {
  ...settings, ...(token ? { global: { headers: { Authorization: 'Bearer ' + token } } } : {}),
})
const stamp = randomUUID().slice(0, 8), originalPassword = 'Issue107-' + randomUUID() + '!'
const fixtures = [], results = [], cleanup = []
let actor, proofSchemaInstalled = false, hookContainerStarted = false
function sql(query) {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_platforma-fonduri', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'],
      { encoding: 'utf8', input: "set log_min_error_statement='panic'; set log_parameter_max_length_on_error=0; " + query, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch { throw new Error('Local SQL probe failed; raw input/output withheld') }
}
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const jwt = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
function expectOk(result, label) { assert.ok(!result.error, label); return result.data }
async function fixture(role = 'client', reuseEmail) {
  const email = reuseEmail || 'issue107.' + stamp + '.' + fixtures.length + '@example.invalid'
  const { user } = expectOk(await service.auth.admin.createUser({ email, password: originalPassword, email_confirm: true }), 'Fixture creation')
  assert.ok(user?.id, 'Fixture UUID required')
  const person = { id: user.id, email }; fixtures.push(person)
  expectOk(await service.from('profiles').update({ role, full_name: 'Issue 107 probe ' + stamp }).eq('id', person.id), 'Fixture profile')
  return person
}
async function login(person, password = originalPassword) {
  const authClient = client()
  const data = expectOk(await authClient.auth.signInWithPassword({ email: person.email, password }), 'Fixture login')
  assert.ok(data.session, 'Session required')
  return { authClient, session: data.session }
}
async function link(person) {
  const data = expectOk(await service.auth.admin.generateLink({ type: 'recovery', email: person.email }), 'Generate recovery')
  assert.equal(data.user.id, person.id, 'Recovery identity')
  return data.properties.hashed_token
}
async function verify(token) {
  const authClient = client()
  return { ...await authClient.auth.verifyOtp({ type: 'recovery', token_hash: token }), authClient }
}
async function lifecycle(person, active) {
  return expectOk(await service.rpc('set_user_account_active', {
    p_target_id: person.id, p_actor_id: actor.id, p_active: active, p_user_agent: 'issue107-phase0',
  }), 'Lifecycle RPC')
}
async function me(token) {
  const response = await fetch(baseUrl + '/api/me', { headers: { Authorization: 'Bearer ' + token } })
  return { status: response.status, body: await response.json() }
}
async function active(token) { return expectOk(await client(token).rpc('current_account_session_active'), 'Session guard RPC') }

const secret = () => randomBytes(32).toString('base64url')
const digest = token => createHash('sha256').update(token).digest('hex')
const reserve = (person, token) => JSON.parse(sql('set role service_role; select issue107_probe.reserve(' + q(person.id) + ',' + q(digest(token)) + ');'))
const finalQuery = (token, password, attempt) => 'select issue107_probe.finalize(' + q(digest(token)) + ',' + q(password) + ',' + q(attempt) + ');'
const finalize = (token, password, attempt = randomUUID()) => JSON.parse(sql('set role service_role; ' + finalQuery(token, password, attempt)))
function concurrentSql(query) {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_platforma-fonduri', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'], { windowsHide: true })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', () => {}) // No SQL/password material in diagnostics.
  child.stdin.end("set log_min_error_statement='panic'; set log_parameter_max_length_on_error=0; set statement_timeout='10s'; " + query)
  return new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('Local concurrent SQL failed')))
    child.on('close', code => resolve({ code, output }))
  })
}
async function barrier(label) {
  const until = Date.now() + 8000
  while (Date.now() < until) {
    if (sql("select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name=" + q(label) + " and l.locktype='advisory' and l.classid=105 and l.objid=1 and l.granted);") === 't') return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('SQL barrier was not reached')
}
const statusFromConcurrent = result => {
  assert.equal(result.code, 0, 'Concurrent SQL exit status')
  return JSON.parse(result.output.split('\n').find(line => line.startsWith('{'))).status
}
const state = person => JSON.parse(sql("select jsonb_build_object('password',u.encrypted_password,'marker',p.must_change_password,'flow',f.state,'attempt',f.attempt,'sessions',(select count(*) from auth.sessions where user_id=u.id),'tokens',(select count(*) from auth.one_time_tokens where user_id=u.id),'audit',(select count(*) from public.audit_logs where user_id=u.id and action_type='password_reset_completed')) from auth.users u join public.profiles p on p.id=u.id join issue107_probe.flows f on f.user_id=u.id where u.id=" + q(person.id) + ';'))

async function probe(name, run) {
  if (process.env.ISSUE107_ONLY && !name.includes(process.env.ISSUE107_ONLY)) return
  try {
    results.push({ name, passed: true, ...await run() })
  } catch (error) {
    // Never output provider responses, SQL input, credentials, or assertion values.
    results.push({ name, passed: false, error: error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Probe failed; credentials withheld' })
  }
  console.log(JSON.stringify(results.at(-1)))
}

try {
  if (sql("select to_regclass('account_recovery.settings') is null") !== 't') assert.equal(sql("select enabled from account_recovery.settings limit 1"), 'f', 'Historical phase0 requires recovery disabled')
  assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='current_account_session_active';"), '1', '#105 migration required')
  assert.equal((await fetch(baseUrl + '/api/me')).status, 401, 'PR server must be ready')
  actor = await fixture('admin')
  await probe('native_recovery_grants_access_before_password_save', async () => {
    const person = await fixture(), token = await link(person), verified = await verify(token)
    assert.ok(!verified.error && verified.data.session, 'Native verification must create session')
    const access = verified.data.session.access_token
    assert.equal((await me(access)).status, 200, 'Recovery session currently passes API')
    assert.equal(await active(access), true, 'Recovery session currently passes RLS guard')
    const rows = expectOk(await client(access).from('profiles').select('id').eq('id', person.id), 'Recovery Data API')
    assert.equal(rows.length, 1, 'Recovery session can read profile')
    assert.ok((await verify(token)).error, 'Native token is one-use')
    return { apiStatus: 200, dataApiRows: 1, guard: true, amr: jwt(access).amr.map(item => item.method), repeatedVerifyRejected: true, contractSatisfied: false }
  })
  await probe('pending_link_survives_deactivate_reactivate', async () => {
    const person = await fixture(), token = await link(person)
    await lifecycle(person, false)
    const blocked = await verify(token)
    assert.ok(blocked.error, 'Banned verification must be refused')
    await lifecycle(person, true)
    const restored = await verify(token)
    assert.ok(!restored.error && restored.data.session, 'Pending native credential survives current lifecycle')
    return { inactiveError: blocked.error.code, afterReactivationValid: true, contractSatisfied: false }
  })
  await probe('opened_recovery_session_does_not_survive_lifecycle', async () => {
    const person = await fixture(), verified = await verify(await link(person))
    assert.ok(verified.data.session, 'Recovery session required')
    const old = verified.data.session
    await lifecycle(person, false)
    assert.equal(await active(old.access_token), false, 'Inactive guard')
    await lifecycle(person, true)
    assert.equal(await active(old.access_token), false, 'Old session never restored')
    assert.equal((await me(old.access_token)).status, 401, 'Old JWT rejected by API after reactivation')
    assert.ok((await client().auth.refreshSession({ refresh_token: old.refresh_token })).error, 'Old refresh rejected')
    return { oldJwtApiStatus: 401, oldRefreshRejected: true, contractSatisfied: true }
  })
  await probe('native_password_update_revokes_other_sessions_keeps_current', async () => {
    const person = await fixture(), old = await login(person), recovered = await verify(await link(person))
    assert.ok(recovered.data.session, 'Recovery session required')
    const password = 'Changed-' + randomUUID() + '!'
    expectOk(await recovered.authClient.auth.updateUser({ password }), 'Native password update')
    assert.equal(await active(old.session.access_token), false, 'Old session revoked')
    assert.equal(await active(recovered.data.session.access_token), true, 'Current recovery session retained')
    assert.ok((await client().auth.refreshSession({ refresh_token: old.session.refresh_token })).error, 'Old refresh revoked')
    const copied = await client().auth.getUser(old.session.access_token)
    assert.equal((await me(old.session.access_token)).status, 401, 'App guard rejects copied JWT')
    await login(person, password)
    return { nativeOtherSessionsRevoked: true, currentRetained: true, getUserAcceptsOldJwt: !!copied.data.user, getUserError: copied.error?.code, appRejectsOldJwt: true }
  })
  await probe('native_hour_expiry_does_not_bound_opened_session', async () => {
    const person = await fixture(), recovered = await verify(await link(person))
    assert.ok(recovered.data.session, 'Recovery session required')
    const id = jwt(recovered.data.session.access_token).session_id
    sql('update auth.sessions set created_at=now()-interval \'61 minutes\' where id=' + q(id) + '; update auth.users set recovery_sent_at=now()-interval \'61 minutes\' where id=' + q(person.id) + ';')
    const refreshed = expectOk(await recovered.authClient.auth.refreshSession({ refresh_token: recovered.data.session.refresh_token }), 'Opened session refresh beyond issuance hour')
    assert.equal(jwt(refreshed.session.access_token).session_id, id, 'Refresh retains original recovery session')
    expectOk(await recovered.authClient.auth.updateUser({ password: 'Expired-flow-' + randomUUID() + '!' }), 'Native update has no issue-hour deadline')
    return { openedSessionBeyondIssuanceHourCanSave: true, refreshBeyondHourAccepted: true, contractSatisfied: false }
  })
  await probe('unconsumed_native_link_expires_at_hour', async () => {
    const person = await fixture(), token = await link(person)
    sql('update auth.users set recovery_sent_at=now()-interval \'61 minutes\' where id=' + q(person.id) + '; update auth.one_time_tokens set created_at=now()-interval \'61 minutes\' where user_id=' + q(person.id) + ';')
    assert.ok((await verify(token)).error, 'Expired native link rejected')
    return { expiredPendingLinkRejected: true }
  })
  await probe('new_native_link_invalidates_previous', async () => {
    const person = await fixture(), first = await link(person), latest = await link(person)
    assert.ok((await verify(first)).error, 'Prior native link replaced')
    assert.ok(!(await verify(latest)).error, 'Latest native link valid')
    return { previousRejected: true, latestValid: true }
  })
  await probe('native_admin_password_reset_revokes_pending_and_sessions', async () => {
    const person = await fixture(), old = await login(person), pending = await link(person)
    expectOk(await service.auth.admin.updateUserById(person.id, { password: 'Admin-' + randomUUID() + '!' }), 'Admin password reset')
    assert.ok((await verify(pending)).error, 'Pending link revoked by admin password update')
    assert.equal(await active(old.session.access_token), false, 'All sessions revoked by admin update')
    return { pendingRejected: true, sessionsRevoked: true }
  })
  await probe('check_then_admin_http_can_write_after_deactivation', async () => {
    const person = await fixture()
    const profile = expectOk(await service.from('profiles').select('is_active').eq('id', person.id).single(), 'Before check')
    assert.equal(profile.is_active, true, 'Eligibility checked before deactivation')
    await lifecycle(person, false)
    const password = 'After-deactivation-' + randomUUID() + '!'
    expectOk(await service.auth.admin.updateUserById(person.id, { password }), 'Admin HTTP can write banned account')
    await lifecycle(person, true)
    await login(person, password)
    return { deactivationWonButPasswordStillChanged: true, contractSatisfied: false }
  })
  await probe('native_email_a_b_a_can_restore_old_link', async () => {
    const person = await fixture(), token = await link(person), originalEmail = person.email
    const replacement = 'issue107.' + stamp + '.changed@example.invalid'
    expectOk(await service.auth.admin.updateUserById(person.id, { email: replacement }), 'Admin email update B')
    expectOk(await service.from('profiles').update({ email: replacement }).eq('id', person.id), 'Profile email B')
    const whileChanged = await verify(token)
    expectOk(await service.auth.admin.updateUserById(person.id, { email: originalEmail }), 'Admin email restore A')
    expectOk(await service.from('profiles').update({ email: originalEmail }).eq('id', person.id), 'Profile email A')
    const restored = await verify(token)
    return { invalidWhileChanged: !!whileChanged.error, validAfterRestoringEmail: !!restored.data.session, contractSatisfied: !!whileChanged.error && !!restored.error }
  })
  await probe('native_public_recover_and_otp_are_open', async () => {
    const person = await fixture()
    expectOk(await client().auth.resetPasswordForEmail(person.email), 'Native recover endpoint')
    expectOk(await client().auth.signInWithOtp({ email: (await fixture()).email, options: { shouldCreateUser: false } }), 'Native OTP endpoint')
    return { recoverAccepted: true, otpAccepted: true, mailDestination: 'local Mailpit fixture only', configurationGateRequired: true }
  })
  await probe('native_email_update_does_not_revoke_opened_session', async () => {
    const person = await fixture(), recovered = await verify(await link(person))
    assert.ok(recovered.data.session, 'Opened recovery session')
    const replacement = 'issue107.' + stamp + '.opened@example.invalid'
    expectOk(await service.auth.admin.updateUserById(person.id, { email: replacement }), 'Email mutation')
    expectOk(await service.from('profiles').update({ email: replacement }).eq('id', person.id), 'Profile email mutation')
    const remainsActive = await active(recovered.data.session.access_token)
    const updated = await recovered.authClient.auth.updateUser({ password: 'After-email-' + randomUUID() + '!' })
    return { priorRecoverySessionActive: remainsActive, priorRecoveryCanChangePassword: !updated.error, contractSatisfied: !remainsActive && !!updated.error }
  })
  await probe('auth_sync_pending_native_recovery_can_still_change_password', async () => {
    const person = await fixture(), token = await link(person)
    sql("create function public.issue107_probe_auth_fault() returns trigger language plpgsql set search_path=pg_catalog as $fn$ begin if new.id=" + q(person.id) + "::uuid and new.banned_until is distinct from old.banned_until then raise exception 'ISSUE107_FIXTURE_ONLY_AUTH_FAULT'; end if; return new; end $fn$; create trigger issue107_probe_auth_fault before update of banned_until on auth.users for each row execute function public.issue107_probe_auth_fault();")
    try {
      await lifecycle(person, false)
      const profile = expectOk(await service.from('profiles').select('is_active,auth_sync_pending').eq('id', person.id).single(), 'Partial lifecycle state')
      assert.equal(profile.is_active, false, 'Profile deactivated')
      assert.equal(profile.auth_sync_pending, true, 'Auth failure captured')
      const recovered = await verify(token)
      assert.ok(recovered.data.session, 'Native Auth still accepts pending link without ban')
      assert.equal(await active(recovered.data.session.access_token), false, 'App guard denies inactive profile')
      const update = await recovered.authClient.auth.updateUser({ password: 'Partial-lifecycle-' + randomUUID() + '!' })
      expectOk(update, 'Native password write bypasses profile state')
      return { profileInactive: true, authSyncPending: true, nativeVerificationCreatesSession: true, appGuard: false, nativePasswordChanged: true, contractSatisfied: false }
    } finally {
      sql('drop trigger issue107_probe_auth_fault on auth.users; drop function public.issue107_probe_auth_fault();')
    }
  })
  await probe('same_password_and_bcrypt_byte_limit', async () => {
    const person = await fixture(), signed = await login(person)
    const same = await signed.authClient.auth.updateUser({ password: originalPassword })
    const long = await signed.authClient.auth.updateUser({ password: 'a'.repeat(73) })
    const unicode = await signed.authClient.auth.updateUser({ password: 'é'.repeat(37) })
    assert.ok(same.error && long.error && unicode.error, 'Native password rules must reject same password and >72 UTF8 bytes')
    return { samePasswordError: same.error.code, longAsciiError: long.error.code, longUnicodeError: unicode.error.code, bcryptMaxBytes: 72 }
  })
  await probe('self_reset_audit_currently_blocks_safe_deletion', async () => {
    const person = await fixture(), signed = await login(person)
    expectOk(await signed.authClient.auth.updateUser({ password: 'Own-' + randomUUID() + '!' }), 'Own reset')
    expectOk(await service.from('audit_logs').insert({ user_id: person.id, action_type: 'password_reset_completed', entity_type: 'user', entity_id: person.id,
      entity_name: person.email, new_values: { source: 'self_recovery' }, description: 'Issue 107 local completed reset probe' }), 'Completed self reset audit')
    const blockers = expectOk(await service.rpc('user_account_blockers', { p_target_id: person.id }), 'Deletion blockers')
    assert.ok(blockers.some(row => row.kind === 'public.audit_logs.user_id'), 'Own reset needs explicit Auth exemption')
    return { ownResetIsCurrentlyBlocker: true, contractSatisfied: false }
  })
  if (process.env.ISSUE107_ATOMIC === '1') {
    assert.equal(sql("select to_regnamespace('issue107_probe') is null;"), 't', 'Probe schema must not already exist')
    const container = JSON.parse(execFileSync('docker', ['inspect', 'supabase_auth_platforma-fonduri'], { encoding: 'utf8', windowsHide: true }))[0]
    assert.ok(!container.Config.Env.includes('GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT=true'), 'Proof does not support encrypted Auth passwords')
    assert.equal(sql("select to_regprocedure('extensions.crypt(text,text)') is not null;"), 't', 'pgcrypto required')
    sql('begin; ' + fs.readFileSync('scripts/issue-107-atomic-probe.sql', 'utf8') + ' commit;')
    proofSchemaInstalled = true
    await probe('atomic_opaque_proof_has_no_auth_session_before_save', async () => {
      const person = await fixture(), token = secret()
      assert.equal(reserve(person, token).status, 'issued', 'Private reservation')
      assert.equal(sql('select count(*) from auth.sessions where user_id=' + q(person.id) + ';'), '0', 'No Auth session from issuance')
      assert.ok((await verify(token)).error, 'Application secret cannot be exchanged at native Auth')
      assert.equal(sql('select count(*) from auth.sessions where user_id=' + q(person.id) + ';'), '0', 'No Auth session from inspection')
      const password = '  Spații-é-' + randomUUID() + '  '
      assert.equal(finalize(token, password).status, 'completed', 'Atomic finalization')
      const saved = state(person)
      assert.equal(saved.marker, false, 'Temporary marker cleared')
      assert.equal(saved.audit, 1, 'One completed reset audit')
      assert.equal(saved.sessions, 0, 'Session only created after DB commit')
      assert.equal(saved.tokens, 0, 'Native one-time tokens cleared')
      const signed = await login(person, password)
      assert.equal((await me(signed.session.access_token)).status, 200, 'New password logs in with original characters')
      return { noSessionBeforeSave: true, nativeExchangeRejected: true, bcryptAcceptedByAuth: true, spacesAndUnicodePreserved: true, afterCommitApiStatus: 200 }
    })
    await probe('atomic_cooldown_latest_link_and_lifecycle_invalidation', async () => {
      const person = await fixture(), first = secret(), denied = secret(), latest = secret()
      assert.equal(reserve(person, first).status, 'issued', 'First issued')
      assert.equal(reserve(person, denied).status, 'cooldown', 'Cooldown refused')
      assert.equal(sql('select token_hash=' + q(digest(first)) + ' from issue107_probe.flows where user_id=' + q(person.id) + ';'), 't', 'Cooldown preserves current link')
      sql("update public.profiles set password_reset_requested_at=clock_timestamp()-interval '15 minutes' where id=" + q(person.id) + ';')
      assert.equal(reserve(person, latest).status, 'issued', 'At fifteen minutes issuance allowed')
      assert.equal(finalize(first, 'Rejected-' + randomUUID()).status, 'invalid', 'Old generation invalid')
      await lifecycle(person, false)
      await lifecycle(person, true)
      assert.equal(finalize(latest, 'Rejected-' + randomUUID()).status, 'invalid', 'Reactivation never restores link')
      assert.equal(reserve(person, secret()).status, 'issued', 'Lifecycle clears old generation cooldown')
      return { cooldownPreservesLink: true, latestOnly: true, reactivationRequiresNewLink: true, freshRequestImmediatelyAllowed: true }
    })
    await probe('atomic_email_roundtrip_and_admin_reset_invalidate', async () => {
      const person = await fixture(), token = secret(), initial = person.email
      assert.equal(reserve(person, token).status, 'issued', 'Issued before email change')
      sql('begin; select pg_advisory_xact_lock(105,1); update public.profiles set email=' + q('issue107.' + stamp + '.atomic@example.invalid') + ' where id=' + q(person.id) + '; update auth.users set email=' + q('issue107.' + stamp + '.atomic@example.invalid') + ' where id=' + q(person.id) + '; update public.profiles set email=' + q(initial) + ' where id=' + q(person.id) + '; update auth.users set email=' + q(initial) + ' where id=' + q(person.id) + '; commit;')
      assert.equal(finalize(token, 'Rejected-' + randomUUID()).status, 'invalid', 'Email roundtrip invalidates generation')
      const next = secret(); assert.equal(reserve(person, next).status, 'issued', 'Fresh post-email flow')
      const temporary = 'Temporary-' + randomUUID()
      sql('begin; select pg_advisory_xact_lock(105,1); select issue107_probe.invalidate(' + q(person.id) + '); update auth.users set encrypted_password=extensions.crypt(' + q(temporary) + ",extensions.gen_salt('bf',10)) where id=" + q(person.id) + '; delete from auth.sessions where user_id=' + q(person.id) + '; update public.profiles set must_change_password=true where id=' + q(person.id) + '; commit;')
      assert.equal(finalize(next, 'Rejected-' + randomUUID()).status, 'invalid', 'Admin invalidation is unconditional')
      const newest = secret(); assert.equal(reserve(person, newest).status, 'issued', 'New recovery after admin reset')
      assert.equal(finalize(newest, 'Chosen-' + randomUUID()).status, 'completed', 'New recovery clears temporary marker')
      assert.equal(state(person).marker, false, 'Marker cleared')
      return { emailRoundtripRejected: true, adminInvalidatesEvenOpenFlow: true, freshRecoveryAfterAdminReset: true }
    })
    await probe('atomic_one_hour_deadline_including_time_waiting_for_lock', async () => {
      const person = await fixture(), token = secret()
      assert.equal(reserve(person, token).status, 'issued', 'Issued flow')
      sql("update issue107_probe.flows set expires_at=clock_timestamp()+interval '500 milliseconds' where user_id=" + q(person.id) + ';')
      const label = 'issue107-expiry-' + stamp
      const hold = concurrentSql('set application_name=' + q(label) + '; begin; select pg_advisory_xact_lock(105,1); select pg_sleep(1.5); commit;')
      await barrier(label)
      const saving = concurrentSql(finalQuery(token, 'Expired-' + randomUUID(), randomUUID()))
      assert.equal((await hold).code, 0, 'Lock holder finishes')
      assert.equal(statusFromConcurrent(await saving), 'invalid', 'Deadline checked after waiting for lock')
      assert.equal(state(person).audit, 0, 'No completion after expiry')
      return { expirationCheckedAfterLock: true, expiredSaveRejected: true }
    })
    await probe('atomic_audit_failure_rolls_back_entire_reset', async () => {
      const person = await fixture(), token = secret(), old = await login(person), pending = await link(person)
      expectOk(await service.from('profiles').update({ must_change_password: true }).eq('id', person.id), 'Temporary marker')
      assert.equal(reserve(person, token).status, 'issued', 'Issued flow')
      sql("insert into auth.one_time_tokens(id,user_id,token_type,token_hash,relates_to,created_at,updated_at) values("+q(randomUUID())+","+q(person.id)+",'reauthentication_token',"+q(digest(secret()))+","+q(person.email)+",now(),now());")
      sql('update issue107_probe.flows set fail_audit=true where user_id=' + q(person.id) + ';')
      const before = state(person)
      let rejected = false
      try { finalize(token, 'Rollback-' + randomUUID()) } catch { rejected = true }
      assert.equal(rejected, true, 'Audit failure must fail completion')
      assert.deepEqual(state(person), before, 'Password marker sessions tokens consumption and audit all roll back')
      assert.equal(await active(old.session.access_token), true, 'Old session remains on failed save')
      sql('update issue107_probe.flows set fail_audit=false where user_id=' + q(person.id) + ';')
      assert.equal(finalize(token, 'Retry-' + randomUUID()).status, 'completed', 'Failed transaction can be retried')
      assert.equal(await active(old.session.access_token), false, 'Old session revoked only on success')
      assert.ok((await verify(pending)).error, 'Old native credential revoked on success')
      return { fullRollback: true, safeRetry: true, sessionsAndTokensRevokedOnCommit: true }
    })
    await probe('atomic_double_submit_and_lost_response_retry', async () => {
      const person = await fixture(), token = secret(), attempt = randomUUID(), firstPassword = 'First-' + randomUUID()
      assert.equal(reserve(person, token).status, 'issued', 'Issued flow')
      const answers = await Promise.all([concurrentSql(finalQuery(token, firstPassword, attempt)),
        concurrentSql(finalQuery(token, 'Second-' + randomUUID(), randomUUID()))])
      assert.deepEqual(answers.map(statusFromConcurrent).sort(), ['completed','invalid'], 'Exactly one save succeeds')
      const finalState = state(person)
      assert.equal(finalState.audit, 1, 'Exactly one completion audit')
      const winningAttempt = finalState.attempt
      assert.equal(finalize(token, 'Replay-' + randomUUID(), winningAttempt).status, 'already_completed', 'Lost response returns receipt only')
      assert.equal(state(person).password, finalState.password, 'Receipt cannot change password again')
      assert.equal(state(person).sessions, 0, 'Replay never creates a session')
      return { oneCommit: true, oneAudit: true, idempotentReceiptOnly: true, noReplayLogin: true }
    })
    await probe('atomic_deactivation_wins_before_finalize', async () => {
      const person = await fixture(), token = secret()
      assert.equal(reserve(person, token).status, 'issued', 'Issued flow')
      const before = state(person), label = 'issue107-deactivate-first-' + stamp
      const deactivation = concurrentSql('set application_name=' + q(label) + '; begin; select public.set_user_account_active(' + q(person.id) + ',' + q(actor.id) + ',false); select pg_sleep(1.5); commit;')
      await barrier(label)
      const saving = concurrentSql(finalQuery(token, 'Must-not-save-' + randomUUID(), randomUUID()))
      assert.equal((await deactivation).code, 0, 'Deactivation commits')
      assert.equal(statusFromConcurrent(await saving), 'invalid', 'Waiting save is refused')
      assert.equal(state(person).password, before.password, 'Password remains original')
      assert.equal(state(person).audit, 0, 'No completed reset audit')
      return { deactivationWins: true, passwordUnchanged: true, completionAuditAbsent: true }
    })
    await probe('atomic_finalize_wins_before_deactivation', async () => {
      const person = await fixture(), token = secret(), password = 'Wins-' + randomUUID(), label = 'issue107-finalize-first-' + stamp
      assert.equal(reserve(person, token).status, 'issued', 'Issued flow')
      const saving = concurrentSql('set application_name=' + q(label) + '; begin; ' + finalQuery(token, password, randomUUID()) + ' select pg_sleep(1.5); commit;')
      await barrier(label)
      const deactivation = lifecycle(person, false)
      assert.equal(statusFromConcurrent(await saving), 'completed', 'First completion commits')
      await deactivation
      assert.ok((await client().auth.signInWithPassword({ email: person.email, password })).error, 'Subsequent deactivation denies auto login')
      assert.equal(state(person).audit, 1, 'Completed reset remains audited')
      return { resetCommittedFirst: true, subsequentDeactivationDeniesAccess: true }
    })
    await probe('atomic_state_private_and_precise_self_auth_exemption', async () => {
      const person = await fixture(), token = secret()
      assert.equal(reserve(person, token).status, 'issued', 'Issued flow')
      assert.equal(finalize(token, 'Auth-only-' + randomUUID()).status, 'completed', 'Own completion')
      let denied = false
      try { sql('set role authenticated; select * from issue107_probe.flows;') } catch { denied = true }
      assert.equal(denied, true, 'Authenticated cannot access private flow')
      const original = sql("select pg_get_functiondef('public.user_account_blockers(uuid)'::regprocedure);")
      const needle = "action_type IN ('login', 'logout')"
      assert.ok(original.includes(needle), 'Known #105 blocker predicate required')
      const extended = original.replace(needle, "(action_type IN ('login', 'logout') OR (action_type='password_reset_completed' AND entity_id=p_target_id AND new_values->>'source'='self_recovery'))")
      const outcome = sql('begin; ' + extended + '; select public.delete_empty_user_account(' + q(person.id) + ',' + q(actor.id) + "); select jsonb_build_object('deleted',not exists(select 1 from auth.users where id=" + q(person.id) + "),'auditRetained',exists(select 1 from public.audit_logs where user_id=" + q(person.id) + " and action_type='password_reset_completed')); rollback;")
      const evidence = JSON.parse(outcome.split('\n').filter(line => line.startsWith('{')).at(-1))
      assert.equal(evidence.deleted, true, 'Own recovery audit permits safe deletion')
      assert.equal(evidence.auditRetained, true, 'Historical audit retained')
      assert.equal(sql("select pg_get_functiondef('public.user_account_blockers(uuid)'::regprocedure);"), original, 'Production blocker function restored by rollback')
      return { privateStateDeniedToAuthenticated: true, exactSelfRecoveryExemptionWorks: true, deletionKeepsAudit: true, temporaryChangeRolledBack: true }
    })

    await probe('atomic_password_validation_does_not_consume_proof', async () => {
      const person = await fixture(), token = secret()
      assert.equal(reserve(person, token).status, 'issued', 'Issued flow')
      const before = state(person)
      assert.equal(finalize(token, originalPassword).status, 'same_password', 'Same password is controlled error')
      for (const password of ['short','a'.repeat(73),'é'.repeat(37)]) {
        assert.equal(finalize(token, password).status, 'invalid_password', 'Invalid password refused')
      }
      assert.equal(JSON.parse(sql('set role service_role; select issue107_probe.finalize(' + q(digest(token)) + ',null,' + q(randomUUID()) + ');')).status, 'invalid_password', 'Null password refused')
      assert.deepEqual(state(person), before, 'Validation cannot consume or mutate flow')
      return { samePasswordRejected: true, shortAndLongUtf8Rejected: true, nullRejected: true, proofUnconsumed: true }
    })
    await probe('atomic_concurrent_reservations_allow_single_issue', async () => {
      const person = await fixture(), tokens = [secret(),secret()]
      const answers = await Promise.all(tokens.map(token => concurrentSql('set role service_role; select issue107_probe.reserve(' + q(person.id) + ',' + q(digest(token)) + ');')))
      assert.deepEqual(answers.map(statusFromConcurrent).sort(), ['cooldown','issued'], 'Exactly one request reserves cooldown')
      return { issued: 1, cooldown: 1 }
    })
    await probe('atomic_auth_sync_failure_keeps_old_flow_invalid', async () => {
      const person = await fixture(), token = secret()
      assert.equal(reserve(person, token).status, 'issued', 'Issued flow')
      const before = state(person)
      sql("create function public.issue107_probe_auth_fault() returns trigger language plpgsql set search_path=pg_catalog as $fn$ begin if new.id=" + q(person.id) + "::uuid and new.banned_until is distinct from old.banned_until then raise exception 'ISSUE107_FIXTURE_ONLY_AUTH_FAULT'; end if; return new; end $fn$; create trigger issue107_probe_auth_fault before update of banned_until on auth.users for each row execute function public.issue107_probe_auth_fault();")
      try {
        await lifecycle(person, false)
        assert.equal(expectOk(await service.from('profiles').select('auth_sync_pending').eq('id',person.id).single(), 'Sync state').auth_sync_pending,true,'Auth sync failure retained')
        assert.equal(finalize(token,'Must-not-save-' + randomUUID()).status,'invalid','Inactive private flow refused even without Auth ban')
        assert.equal(state(person).password,before.password,'Auth sync failure cannot permit password update')
      } finally {
        sql('drop trigger issue107_probe_auth_fault on auth.users; drop function public.issue107_probe_auth_fault();')
      }
      await lifecycle(person,true)
      assert.equal(finalize(token,'Must-not-save-' + randomUUID()).status,'invalid','Successful reactivation cannot restore old flow')
      assert.equal(reserve(person,secret()).status,'issued','New flow immediately available')
      return { authSyncPendingCovered: true, passwordUnchanged: true, reactivationRequiresNewFlow: true }
    })
    await probe('atomic_delete_and_email_reuse_cannot_restore_flow', async () => {
      const person = await fixture(), token = secret()
      assert.equal(reserve(person, token).status,'issued','Issued before delete')
      const deletion = expectOk(await service.rpc('delete_empty_user_account', {p_target_id:person.id,p_actor_id:actor.id}), 'Safe empty account deletion')
      assert.equal(deletion.deleted,true,'Empty account deleted')
      assert.equal(sql('select count(*) from issue107_probe.flows where user_id=' + q(person.id) + ';'),'0','Private state removed by FK cascade')
      assert.equal(finalize(token,'Must-not-save-' + randomUUID()).status,'invalid','Deleted-account flow refused')
      const replacement = await fixture('client',person.email)
      assert.notEqual(replacement.id,person.id,'Reused email has a new identity')
      assert.equal(finalize(token,'Must-not-save-' + randomUUID()).status,'invalid','Email reuse cannot restore old proof')
      assert.equal(reserve(replacement,secret()).status,'issued','New identity has fresh eligible flow')
      return { deletionCleansPrivateState: true, deletedLinkRejected: true, reusedEmailOldProofRejected: true }
    })


    await probe('atomic_auto_login_must_recheck_inactive_profile_after_commit', async () => {
      const person = await fixture(), token = secret(), password = 'Committed-' + randomUUID()
      assert.equal(reserve(person,token).status,'issued','Issued flow')
      assert.equal(finalize(token,password).status,'completed','Password committed before deactivation')
      sql("create function public.issue107_probe_auth_fault() returns trigger language plpgsql set search_path=pg_catalog as $fn$ begin if new.id=" + q(person.id) + "::uuid and new.banned_until is distinct from old.banned_until then raise exception 'ISSUE107_FIXTURE_ONLY_AUTH_FAULT'; end if; return new; end $fn$; create trigger issue107_probe_auth_fault before update of banned_until on auth.users for each row execute function public.issue107_probe_auth_fault();")
      try {
        await lifecycle(person,false)
        const minted = await login(person,password)
        assert.equal(await active(minted.session.access_token),false,'Post-commit Auth session fails app guard')
        assert.equal((await me(minted.session.access_token)).status,401,'API rejects fresh JWT for inactive profile')
        sql('delete from auth.sessions where id=' + q(jwt(minted.session.access_token).session_id) + ';')
        return { resetCompleted: true, authSyncPending: true, nativeLoginCanStillMint: true, postCommitAppCheckDeniesAccess: true, freshJwtApiStatus: 401 }
      } finally {
        sql('drop trigger issue107_probe_auth_fault on auth.users; drop function public.issue107_probe_auth_fault();')
      }
    })


    await probe('native_token_persistence_gate_denies_recovery_and_magiclink', async () => {
      const person = await fixture(), token=secret()
      assert.equal(reserve(person,token).status,'issued','Private app flow issued')
      for (const type of ['recovery','magiclink']) {
        const generated=expectOk(await service.auth.admin.generateLink({type,email:person.email}),'Native link generation under persistence gate')
        assert.ok(generated.properties.hashed_token,'Native generated credential is available only to this test')
        assert.ok((await client().auth.verifyOtp({type,token_hash:generated.properties.hashed_token})).error,'Generated native credential cannot create a session')
        assert.ok((await client().auth.verifyOtp({type,email:person.email,token:generated.properties.email_otp})).error,'Native email OTP cannot create a session')
      }
      assert.equal(sql('select coalesce(recovery_token,\'\')=\'\' and coalesce(confirmation_token,\'\')=\'\' from auth.users where id='+q(person.id)+';'),'t','Legacy native credentials blank')
      assert.equal(sql('select count(*) from auth.one_time_tokens where user_id='+q(person.id)+';'),'0','No native one-time credential persisted')
      assert.equal(sql('select count(*) from auth.sessions where user_id='+q(person.id)+';'),'0','No session from native recovery or magiclink')
      assert.equal(finalize(token,'Selected-'+randomUUID()).status,'completed','Private app proof remains usable')
      const signed=await login(person,'wrong-password').catch(()=>null)
      assert.equal(signed,null,'Native guard does not change password validation')
      return { nativeRecoveryRejected:true,nativeMagiclinkRejected:true,nativeEmailOtpRejected:true,legacyCredentialsEmpty:true,oneTimeTokens:0,nativeSessions:0,privateProofCompleted:true }
    })

    await probe('native_email_hook_suppresses_recovery_and_otp_credentials', async () => {
      const containerName = 'issue107_auth_hook_probe', envPath = 'supabase/.temp/issue107-auth-probe.env'
      const existingNames = execFileSync('docker', ['ps','-a','--format','{{.Names}}'], { encoding:'utf8', windowsHide:true }).trim().split('\n')
      assert.ok(!existingNames.includes(containerName), 'Unused container name')
      // Existing Auth is left running. The second instance shares only the dedicated local DB.
      const filtered = container.Config.Env.filter(line => !line.startsWith('GOTRUE_HOOK_SEND_EMAIL_'))
      fs.writeFileSync(envPath, filtered.join('\n') + '\n')
      try {
        execFileSync('docker', ['run', '-d', '--name', containerName, '--network', 'supabase_network_platforma-fonduri',
          '-p', '127.0.0.1:3108:9999', '--env-file', envPath, '-e', 'GOTRUE_HOOK_SEND_EMAIL_ENABLED=true',
          '-e', 'GOTRUE_HOOK_SEND_EMAIL_URI=pg-functions://postgres/issue107_probe/email_hook',
          container.Config.Image], { encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'] })
        hookContainerStarted = true
      } finally { fs.rmSync(envPath, { force: true }) }
      let healthy = false
      for (let i=0; i<40; i++) {
        try { healthy = (await fetch('http://127.0.0.1:3108/health')).ok } catch {}
        if (healthy) break
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      assert.equal(healthy, true, 'Isolated Auth with Postgres email hook must start')
      const beforeMail = (await (await fetch('http://127.0.0.1:54324/api/v1/messages')).json()).total
      const headers = { apikey: env.E2E_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.E2E_SUPABASE_ANON_KEY, 'Content-Type':'application/json' }
      const person = await fixture(), otpPerson = await fixture(), inactive = await fixture()
      assert.equal(reserve(person,secret()).status,'issued','Protected recover account')
      assert.equal(reserve(otpPerson,secret()).status,'issued','Protected OTP account')
      assert.equal(reserve(inactive,secret()).status,'issued','Protected inactive account')
      await lifecycle(inactive, false)
      const recover = await fetch('http://127.0.0.1:3108/recover', { method:'POST', headers, body:JSON.stringify({ email:person.email }) })
      const otp = await fetch('http://127.0.0.1:3108/otp', { method:'POST', headers, body:JSON.stringify({ email:otpPerson.email, create_user:false }) })
      const missing = await fetch('http://127.0.0.1:3108/recover', { method:'POST', headers, body:JSON.stringify({ email:'issue107.' + stamp + '.missing@example.invalid' }) })
      const banned = await fetch('http://127.0.0.1:3108/recover', { method:'POST', headers, body:JSON.stringify({ email:inactive.email }) })
      assert.equal(recover.status, 200, 'Hook accepts native recover without delivery')
      assert.equal(otp.status, 200, 'Hook accepts native OTP without delivery')
      const events = JSON.parse(sql("select coalesce(jsonb_agg(action order by action),'[]') from issue107_probe.hook_events;"))
      assert.ok(events.includes('recovery') && events.includes('magiclink'), 'Both native email paths reach hook')
      assert.equal(sql('select count(*) from auth.users where id in ('+[person.id,otpPerson.id,inactive.id].map(q).join(',')+') and (coalesce(recovery_token,\'\')<>\'\' or coalesce(confirmation_token,\'\')<>\'\');'),'0','Public native requests leave no credential')
      assert.equal(sql('select count(*) from auth.one_time_tokens where user_id in ('+[person.id,otpPerson.id,inactive.id].map(q).join(',')+');'),'0','Public native requests leave no one-time token')
      const passwordLogin = await fetch('http://127.0.0.1:3108/token?grant_type=password', { method:'POST', headers, body:JSON.stringify({ email:person.email, password:originalPassword }) })
      assert.equal(passwordLogin.status, 200, 'Email hook must preserve password login')
      const afterMail = (await (await fetch('http://127.0.0.1:54324/api/v1/messages')).json()).total
      assert.equal(afterMail, beforeMail, 'No native SMTP email delivered')
      return { recoveryStatus: recover.status, otpStatus: otp.status, missingStatus: missing.status, inactiveStatus: banned.status,
        hookActions: events, smtpEmailsAdded: 0, nativeCredentialsPersisted: 0, passwordLoginStatus: passwordLogin.status, existingAuthUntouched: true }
    })
  }

} finally {
  if (hookContainerStarted) execFileSync('docker', ['rm','-f','issue107_auth_hook_probe'], { windowsHide:true, stdio:'pipe' })
  if (proofSchemaInstalled) sql('drop trigger issue107_probe_profile_changed on public.profiles; drop trigger issue107_probe_reject_audit on public.audit_logs; drop trigger issue107_probe_native_user_tokens on auth.users; drop trigger issue107_probe_native_one_time_tokens on auth.one_time_tokens; drop schema issue107_probe cascade;')
  for (const person of fixtures.toReversed()) {
    assert.ok(person.email.startsWith('issue107.' + stamp + '.') && person.email.endsWith('@example.invalid'), 'Cleanup fixture scope')
    const deletion = await service.auth.admin.deleteUser(person.id)
    if (!deletion.error || deletion.error.status === 404) { cleanup.push({ id: person.id, deleted: true }); continue }
    // Keep immutable audit intact if lifecycle intentionally prevents direct cleanup.
    sql('update public.profiles set is_active=false where id=' + q(person.id) + '; update auth.users set banned_until=now()+interval \'10 years\' where id=' + q(person.id) + '; delete from auth.sessions where user_id=' + q(person.id) + ';')
    cleanup.push({ id: person.id, deleted: false, retainedInactiveWithAudit: true })
  }
  const reportPath = 'docs/issue-107-phase0-results.json'
  const previous = process.env.ISSUE107_ONLY && fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath,'utf8')) : null
  const merged = previous ? previous.results.filter(row => !results.some(next => next.name===row.name)).concat(results) : results
  fs.writeFileSync(reportPath, JSON.stringify({ executedAt: new Date().toISOString(), baseUrl: previous?.baseUrl || baseUrl, supabaseUrl: env.E2E_SUPABASE_URL,
    environment: previous?.environment, existingE2E: previous?.existingE2E,
    results: merged, cleanup: (previous?.cleanup || []).concat(cleanup) }, null, 2) + '\n')
  console.log(JSON.stringify({ total: merged.length, passed: merged.filter(row => row.passed).length,
    executedThisRun: results.length, cleanupDeletedThisRun: cleanup.filter(row => row.deleted).length,
    cleanupRetainedInactive: cleanup.filter(row => !row.deleted).length, report: reportPath }))

}
process.exitCode = results.some(row => !row.passed) ? 1 : 0
