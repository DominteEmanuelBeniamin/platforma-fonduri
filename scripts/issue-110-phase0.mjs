// E2E_ENV_FILE=.env.e2e.localdb node scripts/issue-110-phase0.mjs
// Phase 2: node --experimental-strip-types scripts/issue-110-phase0.mjs --phase2
// Phase 3: node --experimental-strip-types scripts/issue-110-phase0.mjs --phase3
// Creates a disposable local database and Auth/REST containers; never uses hosted.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomUUID, createHmac } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const phase5 = process.argv.includes('--phase5')
assert.ok(!process.argv.includes('--phase5-only') || phase5, '--phase5-only requires --phase5')
const phase3 = phase5 || process.argv.includes('--phase3')
const phase2 = phase3 || process.argv.includes('--phase2')
const phase = phase5 ? 'phase5' : phase3 ? 'phase3' : phase2 ? 'phase2' : 'phase0'
const finalizeName = phase2 ? 'finalize_new_user_account' : 'phase0_finalize_new_user'
const cancelName = phase2 ? 'cancel_new_user_account' : 'phase0_cancel_new_user'
const finalizeSignature = `public.${finalizeName}(uuid,uuid,timestamptz,text,text${phase2 ? ',jsonb' : ''})`
const cancelSignature = `public.${cancelName}(uuid,uuid)`
const readEnv = file => Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=') && !line.trim().startsWith('#'))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')] }))
const env = readEnv(process.env.E2E_ENV_FILE || '.env.e2e.localdb')
assert.equal(env.E2E_WRITES, '1', 'Explicit local E2E writes required')
assert.equal(env.E2E_TEST_PROJECT, '1', 'Dedicated test configuration required')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.E2E_SUPABASE_URL).hostname), 'Local source only')
const stamp = randomUUID().replaceAll('-', '').slice(0, 12)
const database = 'issue110_' + phase + '_' + stamp
const dbContainer = 'supabase_db_platforma-fonduri'
const authName = 'issue110_' + phase + '_auth_' + stamp
const restName = 'issue110_' + phase + '_rest_' + stamp
const createdContainers = []
const extraServices = {}
const temp = path.join(root, 'supabase', '.temp', 'issue110-' + stamp)
const results = []
const password = 'Local-probe-' + randomUUID()
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
let databaseCreated = false, proxy, service, actor, lostReplyFor, rejectReadsFor, stage = 'setup'
let cifSequence = 9000000
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
function sql(query, selected = database, role = 'postgres') {
  assert.ok(selected === 'postgres' || selected === database)
  assert.ok(['postgres', 'supabase_admin'].includes(role))
  try {
    return execFileSync('docker', ['exec', '-i', dbContainer, 'psql', '-U', role, '-d', selected, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
      input: "SET log_min_error_statement='panic'; SET statement_timeout='15s'; " + query,
      encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    throw new Error(String(error.stderr).split('\n').find(line => line.startsWith('ERROR:'))?.slice(0, 250) || 'SQL failed')
  }
}
function concurrentSql(query) {
  const child = spawn('docker', ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
  child.stdout.resume(); child.stderr.resume()
  child.stdin.end("SET statement_timeout='30s'; " + query)
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)) })
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(check, label) {
  for (let i = 0; i < 120; i++) { if (await check()) return; await sleep(100) }
  throw new Error(label)
}
function data(result, label) { assert.equal(result.error, null, label + ': ' + (result.error?.code || '')); return result.data }
function expectError(result, message) { assert.equal(result.error?.message, message); return result.error }
const rpc = (name, args) => service.rpc(name, args)
const cancel = (person, author = actor) => rpc(cancelName, { p_target_id: person.id, p_actor_id: author.id })
const active = (person, value) => rpc('set_user_account_active', { p_target_id: person.id, p_actor_id: actor.id, p_active: value })
// Auth's Go driver truncates sub-microseconds on persistence; a SQL cast rounds.
const persistedAuthTimestamp = value => value.replace(/(\.\d{6})\d+(Z|[+-]\d{2}:\d{2})$/, '$1$2')
function cif() {
  const body = String(++cifSequence), padded = body.padStart(9, '0')
  const sum = [...padded].reduce((total, digit, index) => total + Number(digit) * Number('753217532'[index]), 0)
  const check = (sum * 10) % 11
  return 'RO' + body + (check === 10 ? 0 : check)
}
async function fixture(metadata) {
  const email = 'issue110.' + randomUUID() + '@example.invalid'
  const user = data(await service.auth.admin.createUser({ email, password, email_confirm: true, ban_duration: '87600h', ...(metadata ? { user_metadata: metadata } : {}) }), 'Create blocked Auth').user
  assert.ok(user?.id && user.banned_until, 'Created UUID and initial ban required')
  const ban = persistedAuthTimestamp(user.banned_until)
  assert.equal(sql('SELECT (banned_until=' + q(ban) + '::timestamptz)::text FROM auth.users WHERE id=' + q(user.id)), 'true', 'Auth response identifies the exact persisted initial ban')
  return { id: user.id, email, ban }
}
const finalArgs = (person, role = 'client', selectedCif = cif(), author = actor) => ({ p_target_id: person.id, p_actor_id: author.id, p_expected_ban: person.ban, p_role: role, p_cif: role === 'client' ? selectedCif : null })
const finalize = args => rpc(finalizeName, args)
const state = person => JSON.parse(sql('SELECT jsonb_build_object(\'pending\',p.creation_pending,\'active\',p.is_active,\'role\',p.role,\'cif\',p.cif,\'temporary\',p.must_change_password,\'ban\',u.banned_until) FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=' + q(person.id)))
async function reconcile(person) {
  const result = await service.from('profiles').select('creation_pending,is_active').eq('id', person.id).maybeSingle()
  if (result.error) return 'unknown'
  if (!result.data) return 'absent'
  return result.data.creation_pending ? 'pending' : result.data.is_active ? 'finalized_active' : 'finalized_inactive'
}
async function probe(name, run) {
  stage = name
  try {
    const details = await run()
    results.push({ name, passed: true, ...(details ? { details } : {}) })
    console.log('PASS ' + name)
  } catch (error) {
    const reason = String(error.message).slice(0, 350)
    results.push({ name, passed: false, reason })
    console.error('FAIL ' + name + ': ' + reason)
    process.exitCode = 1
  }
}
function writeResults(extra = {}) {
  fs.writeFileSync('docs/issue-110-' + phase + '-results.json', JSON.stringify({ date: new Date().toISOString(), authVersion: 'v2.197.0', database: 'PostgreSQL 17.6', isolated: true, hostedWrites: false, realEmailDelivery: false, ...extra, cases: results }, null, 2) + '\n')
}
function inspect(name) { return JSON.parse(docker(['inspect', name]))[0] }
const envMap = container => Object.fromEntries(container.Config.Env.map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))
function startContainer(name, image, values, port, internalPort, network) {
  const file = path.join(temp, name + '.env')
  assert.ok(Object.values(values).every(value => !/[\r\n]/.test(value)), 'Single-line container configuration')
  fs.writeFileSync(file, Object.entries(values).map(([key, value]) => key + '=' + value).join('\n'))
  try {
    docker(['run', '--pull=never', '-d', '--name', name, '--label', 'bonie.issue110.phase0=' + stamp, '--network', network,
      '-p', '127.0.0.1:' + port + ':' + internalPort, '--env-file', file, image])
    createdContainers.push(name)
  } finally { fs.rmSync(file, { force: true }) }
}
// Load the actual API guard and its local imports, stripping types only.
function compileGuard() {
  const seen = new Set()
  function compile(source) {
    const destination = path.join(temp, 'compiled', path.relative(root, source).replace(/\.[cm]?[jt]s$/, '.mjs'))
    if (seen.has(source)) return destination
    seen.add(source)
    let output = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    output = output.replace(/(from\s*['"])([^'"]+)(['"])/g, (match, before, specifier, after) => {
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return match
      const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(source), specifier)
      const found = [base, base + '.ts', base + '.js'].find(file => fs.existsSync(file) && fs.statSync(file).isFile())
      assert.ok(found, 'Resolvable API guard dependency')
      const relative = path.relative(path.dirname(destination), compile(found)).replaceAll('\\', '/')
      return before + (relative.startsWith('.') ? relative : './' + relative) + after
    })
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, output)
    return destination
  }
  return compile(path.join(root, 'app', 'api', '_utils', 'auth.ts'))
}
async function firstWithLock(name, query, second) {
  sql('INSERT INTO issue110_probe.barriers(name) VALUES(' + q(name) + ')')
  const first = concurrentSql('BEGIN; SET LOCAL application_name=' + q(name) + '; SELECT pg_advisory_xact_lock(105,1); DO $barrier$ BEGIN WHILE NOT EXISTS(SELECT 1 FROM issue110_probe.barriers WHERE name=' + q(name) + ' AND released) LOOP PERFORM pg_sleep(0.05); END LOOP; END $barrier$; ' + query + '; COMMIT;')
  const lockQuery = "SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.datname=" + q(database) + " AND l.locktype='advisory' AND l.classid=105 AND l.objid=1"
  let pending
  try {
    await waitFor(() => sql(lockQuery + ' AND a.application_name=' + q(name) + ' AND l.granted)') === 't', 'First concurrent lock acquired')
    pending = Promise.resolve(second())
    await waitFor(() => sql(lockQuery + ' AND NOT l.granted)') === 't', 'Second mutation actually waits for the lock')
    sql('UPDATE issue110_probe.barriers SET released=true WHERE name=' + q(name))
    const result = await pending
    assert.equal(await first, 0, 'First concurrent mutation committed')
    return result
  } finally {
    sql('UPDATE issue110_probe.barriers SET released=true WHERE name=' + q(name))
    await Promise.allSettled([first, pending])
    sql('DELETE FROM issue110_probe.barriers WHERE name=' + q(name))
  }
}
const finalizeSql = args => 'SELECT public.' + finalizeName + '(' + [args.p_target_id, args.p_actor_id, args.p_expected_ban, args.p_role, args.p_cif].map(value => value === null ? 'NULL' : q(value)).join(',') + ')'

let sourceCounts
try {
  fs.mkdirSync(temp, { recursive: true })
  const authSource = inspect('supabase_auth_platforma-fonduri'), restSource = inspect('supabase_rest_platforma-fonduri')
  assert.match(authSource.Config.Image, /:v2\.197\.0$/, 'Reviewed Auth version')
  const authEnv = envMap(authSource), restEnv = envMap(restSource)
  const network = Object.keys(authSource.NetworkSettings.Networks).find(name => name === 'supabase_network_platforma-fonduri')
  assert.ok(network, 'Expected local Docker network')
  const authDb = new URL(authEnv.GOTRUE_DB_DATABASE_URL), restDb = new URL(restEnv.PGRST_DB_URI)
  assert.equal(authDb.hostname, dbContainer); assert.equal(restDb.hostname, dbContainer)
  assert.equal(authDb.pathname, '/postgres'); assert.equal(restDb.pathname, '/postgres')
  sourceCounts = sql("SELECT jsonb_build_object('users',(SELECT count(*) FROM auth.users),'profiles',(SELECT count(*) FROM public.profiles))", 'postgres')
  assert.equal(sql('SELECT count(*) FROM pg_database WHERE datname=' + q(database), 'postgres'), '0', 'Fresh database name')
  stage = 'setup_create_database'
  sql('CREATE DATABASE ' + database + ' OWNER postgres', 'postgres', 'supabase_admin'); databaseCreated = true
  stage = 'setup_copy_schema'
  const schema = docker(['exec', dbContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only'])
  sql(schema, database, 'supabase_admin')
  stage = 'setup_copy_auth_migration_versions'
  sql(docker(['exec', dbContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only', '--table=auth.schema_migrations']), database, 'supabase_admin')
  assert.equal(sql('SELECT count(*) FROM auth.users'), '0', 'No existing users copied')
  sql('INSERT INTO account_recovery.settings(singleton,enabled) VALUES(true,false)')
  console.log('SETUP disposable database copied without account data')
  stage = 'setup_isolated_auth_rest'
  authDb.pathname = '/' + database; restDb.pathname = '/' + database
  const authPort = Number(process.env.ISSUE110_AUTH_PORT || 32110), restPort = authPort + 1
  assert.ok(Number.isInteger(authPort) && authPort > 1024 && restPort <= 65535, 'Local test ports')
  for (const key of Object.keys(authEnv)) if (key.startsWith('GOTRUE_HOOK_')) delete authEnv[key]
  Object.assign(authEnv, { GOTRUE_DB_DATABASE_URL: authDb.href, GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_LOG_LEVEL: 'error',
    GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: '1', GOTRUE_HOOK_SEND_EMAIL_ENABLED: 'true',
    GOTRUE_HOOK_SEND_EMAIL_URI: 'pg-functions://postgres/account_recovery/send_email_hook' })
  startContainer(authName, authSource.Config.Image, authEnv, authPort, 9999, network)
  startContainer(restName, restSource.Config.Image, { ...restEnv, PGRST_DB_URI: restDb.href }, restPort, 3000, network)
  await waitFor(async () => { try { return (await fetch('http://127.0.0.1:' + authPort + '/health')).ok } catch { return false } }, 'Isolated Auth healthy')
  proxy = http.createServer(async (request, response) => {
    try {
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,range')
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD')
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
      let body = ''; for await (const chunk of request) body += chunk
      const prefix = ['/auth/v1', '/storage/v1', '/rest/v1'].find(value => request.url.startsWith(value + '/'))
      assert.ok(prefix, 'Known isolated service route')
      const port = prefix === '/auth/v1' ? authPort : prefix === '/rest/v1' ? restPort : extraServices.storage
      assert.ok(port, 'Isolated service enabled')
      if (rejectReadsFor && request.method === 'GET' && request.url.includes(rejectReadsFor)) {
        response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"message":"probe read unavailable"}'); return
      }
      const headers = { ...request.headers, connection: 'close' }; delete headers.host
      const upstream = await fetch('http://127.0.0.1:' + port + request.url.slice(prefix.length), {
        method: request.method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(15000),
      })
      const output = Buffer.from(await upstream.arrayBuffer())
      if (lostReplyFor && request.url === '/rest/v1/rpc/' + finalizeName && JSON.parse(body).p_target_id === lostReplyFor && upstream.ok) {
        lostReplyFor = null; response.destroy(); return
      }
      response.writeHead(upstream.status, { ...Object.fromEntries([...upstream.headers].filter(([key]) => !['content-encoding', 'transfer-encoding', 'content-length'].includes(key))), Connection: 'close' })
      response.end(output)
    } catch { if (!response.destroyed) { response.writeHead(502); response.end() } }
  })
  proxy.on('upgrade', (request, socket, head) => {
    if (!extraServices.realtime || !request.url.startsWith('/realtime/v1/')) { socket.destroy(); return }
    const upstream = http.request({ hostname: '127.0.0.1', port: extraServices.realtime,
      path: '/socket' + request.url.slice('/realtime/v1'.length), headers: { ...request.headers, host: 'realtime-dev.localhost' } })
    upstream.on('upgrade', (reply, other, initial) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(reply.headers).map(([key, value]) => key + ': ' + value).join('\r\n') + '\r\n\r\n')
      if (head.length) other.write(head)
      if (initial.length) socket.write(initial)
      other.on('error', () => socket.destroy()); socket.on('error', () => other.destroy())
      socket.pipe(other).pipe(socket)
    })
    upstream.on('response', () => socket.destroy()); upstream.on('error', () => socket.destroy()); upstream.end()
  })
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve) })
  const baseUrl = 'http://127.0.0.1:' + proxy.address().port
  service = createClient(baseUrl, env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: authOptions })
  await waitFor(async () => !(await service.from('profiles').select('id').limit(1)).error, 'Isolated REST healthy')
  const bootstrap = data(await service.auth.admin.createUser({ email: 'issue110.bootstrap@example.invalid', password, email_confirm: true }), 'Bootstrap admin').user
  actor = { id: bootstrap.id, email: bootstrap.email }
  sql("UPDATE public.profiles SET role='admin',is_active=true WHERE id=" + q(actor.id))
  stage = 'setup_prototype'
  const prototype = fs.readFileSync('scripts/issue-110-phase0.sql', 'utf8')
  if (phase2) {
    const { installPhase2 } = await import('./issue-110-phase2-checks.mjs')
    await installPhase2({ sql, probe, q, rpc, actor, fixture, data, database })
    const faults = prototype.indexOf('-- Fault injection')
    assert.ok(faults > 0, 'Shared local-only fault injection found')
    sql(prototype.slice(faults))
  } else sql(prototype)
  await waitFor(async () => (await finalize({ p_target_id: randomUUID(), p_actor_id: actor.id, p_expected_ban: null, p_role: 'admin' })).error?.message === 'USER_NOT_FOUND', 'Prototype RPC schema reloaded')
  data(await rpc('activate_account_recovery', { p_verified_auth_version: 'v2.197.0' }), 'Isolated recovery activated')
  Object.assign(process.env, { SUPABASE_URL: baseUrl, SUPABASE_ANON_KEY: env.E2E_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: env.E2E_SUPABASE_SERVICE_ROLE_KEY })
  const { requireProfile } = await import(pathToFileURL(compileGuard()).href)
  const userClient = token => createClient(baseUrl, env.E2E_SUPABASE_ANON_KEY, { auth: authOptions, ...(token ? { global: { headers: { Authorization: 'Bearer ' + token } } } : {}) })
  const guard = token => requireProfile(new Request('http://127.0.0.1/api/users', { headers: { Authorization: 'Bearer ' + token } }))
  if (!process.argv.includes('--phase5-only')) {
  const pending = await fixture({ role: 'admin', cif: cif(), is_active: true, creation_pending: false })
  console.log('SETUP isolated schema, Auth, REST and application guard ready')

  await probe('auth_ban_precision_matches_persisted_microseconds', async () => {
    for (const suffix of ['123456001', '123456499', '123456999']) {
      assert.equal(persistedAuthTimestamp('2036-10-22T10:00:00.' + suffix + 'Z'), '2036-10-22T10:00:00.123456Z')
    }
    assert.equal(persistedAuthTimestamp('2036-10-22T10:00:00.123456+03:00'), '2036-10-22T10:00:00.123456+03:00')
  })
  await probe('pending_metadata_login_api_rest_rpc', async () => {
    assert.deepEqual({ ...state(pending), ban: null }, { pending: true, active: false, role: 'client', cif: null, temporary: false, ban: null })
    assert.ok((await userClient().auth.signInWithPassword({ email: pending.email, password })).error, 'Pending password login refused')
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const claims = Buffer.from(JSON.stringify({ sub: pending.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600, session_id: randomUUID() })).toString('base64url')
    const unsigned = header + '.' + claims, token = unsigned + '.' + createHmac('sha256', authEnv.GOTRUE_JWT_SECRET).update(unsigned).digest('base64url')
    assert.equal((await guard(token)).ok, false, 'Actual application guard refuses pending')
    // #105 intentionally lets an inactive account read its own profile.
    assert.deepEqual(data(await userClient(token).from('profiles').select('id'), 'Pending own-profile lookup'), [{ id: pending.id }])
    assert.deepEqual(data(await userClient(token).from('profiles').select('id').eq('id', actor.id), 'Pending other-profile lookup'), [])
    assert.deepEqual(data(await userClient(token).from('projects').select('id'), 'Pending business REST lookup'), [])
    assert.equal(data(await userClient(token).rpc('current_account_session_active'), 'Pending session RPC'), false)
    const before = state(pending)
    assert.ok((await userClient(token).from('profiles').update({ is_active: true }).eq('id', pending.id)).error, 'Direct profile write refused')
    assert.deepEqual(state(pending), before, 'Rejected direct write changes nothing')
    assert.equal((await userClient(token).rpc(finalizeName, finalArgs(pending))).error?.code, '42501', 'Finalize RPC is service-only')
    assert.equal((await userClient(token).rpc(cancelName, { p_target_id: pending.id, p_actor_id: actor.id })).error?.code, '42501', 'Cancel RPC is service-only')
  })
  await probe('pending_reactivation_patch_and_check_refused', async () => {
    expectError(await active(pending, true), 'ACCOUNT_CREATION_PENDING')
    expectError(await rpc('update_user_profile_guarded', { p_target_id: pending.id, p_actor_id: actor.id, p_changes: { full_name: 'Changed' } }), 'ACCOUNT_CREATION_PENDING')
    assert.throws(() => sql('UPDATE public.profiles SET is_active=true WHERE id=' + q(pending.id)), /23514/)
  })
  async function recoveryStatus(person) {
    const id = randomUUID(), lease = randomUUID()
    assert.equal(data(await rpc('recovery_enqueue', { p_job_id: id, p_payload_cipher: 'local-proof-no-delivery', p_ip_hash: id }), 'Recovery enqueue'), true)
    const job = data(await rpc('recovery_take_delivery', { p_lease_id: lease }), 'Recovery lease')
    assert.equal(job.id, id)
    const prepared = data(await rpc('recovery_prepare_delivery', { p_job_id: id, p_lease_id: lease, p_email: person.email, p_token_hash: 'a'.repeat(64) }), 'Recovery eligibility')
    data(await rpc('recovery_finish_delivery', { p_job_id: id, p_lease_id: lease, p_outcome: 'skipped' }), 'Recovery skip cleanup')
    return prepared.status
  }
  await probe('pending_recovery_skipped_with_enabled_recovery', async () => { assert.equal(await recoveryStatus(pending), 'skip') })
  await probe('all_roles_finalize_and_gain_real_access', async () => {
    for (const role of ['client', 'consultant', 'admin']) {
      const person = await fixture(), args = finalArgs(person, role)
      data(await finalize(args), 'Finalize ' + role)
      const saved = state(person)
      assert.equal(saved.pending, false); assert.equal(saved.active, true); assert.equal(saved.role, role); assert.equal(saved.temporary, true); assert.equal(saved.ban, null)
      assert.equal(saved.cif, args.p_cif)
      const session = data(await userClient().auth.signInWithPassword({ email: person.email, password }), 'Finalized login').session
      assert.equal((await guard(session.access_token)).ok, true, 'Actual application guard allows finalized account')
      assert.equal(data(await userClient(session.access_token).rpc('current_account_session_active'), 'Finalized session'), true)
      assert.ok(data(await userClient(session.access_token).from('profiles').select('id').eq('id', person.id), 'Finalized REST').some(row => row.id === person.id))
      if (role === 'client') assert.equal(await recoveryStatus(person), 'send', 'Positive recovery control')
    }
  })
  await probe('duplicate_create_create_one_finalized_one_cancelled', async () => {
    const left = await fixture(), right = await fixture(), selectedCif = cif()
    const outcomes = await Promise.all([finalize(finalArgs(left, 'client', selectedCif)), finalize(finalArgs(right, 'client', selectedCif))])
    assert.equal(outcomes.filter(result => !result.error).length, 1)
    const failed = outcomes.findIndex(result => result.error)
    assert.equal(outcomes[failed].error.code, '23505'); assert.match(outcomes[failed].error.message, /profiles_cif_unique/)
    const loser = [left, right][failed]
    assert.equal(state(loser).pending, true); assert.equal(state(loser).active, false)
    data(await cancel(loser), 'Cancel duplicate UUID'); assert.equal(await reconcile(loser), 'absent')
  })
  await probe('pre_finalization_failure_cancels_only_pending_uuid', async () => {
    const person = await fixture()
    data(await cancel(person), 'Cancel unfinalized UUID'); assert.equal(await reconcile(person), 'absent')
    expectError(await cancel(actor), 'ACCOUNT_CREATION_NOT_PENDING')
  })
  await probe('unban_failure_rolls_back_whole_finalization', async () => {
    const person = await fixture(), before = state(person)
    sql('INSERT INTO issue110_probe.faults VALUES(' + q(person.id) + ",'unban')")
    expectError(await finalize(finalArgs(person)), 'PROBE_INJECTED_FAILURE')
    assert.deepEqual(state(person), before, 'Profile, marker and ban rolled back together')
    sql('DELETE FROM issue110_probe.faults WHERE target_id=' + q(person.id)); data(await cancel(person), 'Cleanup rollback fixture')
  })
  await probe('cleanup_failure_remains_blocked_and_visible', async () => {
    const person = await fixture()
    sql('INSERT INTO issue110_probe.faults VALUES(' + q(person.id) + ",'cleanup')")
    expectError(await cancel(person), 'PROBE_INJECTED_FAILURE')
    assert.equal(await reconcile(person), 'pending')
    assert.ok((await userClient().auth.signInWithPassword({ email: person.email, password })).error)
    sql('DELETE FROM issue110_probe.faults WHERE target_id=' + q(person.id)); data(await cancel(person), 'Retry cleanup')
  })
  await probe('lost_success_response_reconciles_by_uuid_no_second_finalize', async () => {
    const person = await fixture(), args = finalArgs(person)
    lostReplyFor = person.id
    assert.ok((await finalize(args)).error, 'HTTP result intentionally lost after upstream commit')
    assert.equal(await reconcile(person), 'finalized_active')
    const before = state(person)
    expectError(await finalize(args), 'ACCOUNT_CREATION_NOT_PENDING')
    expectError(await cancel(person), 'ACCOUNT_CREATION_NOT_PENDING')
    assert.deepEqual(state(person), before)
    rejectReadsFor = person.id
    try { assert.equal(await reconcile(person), 'unknown', 'Unavailable read is neither failure nor success') }
    finally { rejectReadsFor = null }
    assert.deepEqual(state(person), before)
  })
  await probe('concurrent_finalization_same_uuid_runs_once', async () => {
    const person = await fixture(), args = finalArgs(person)
    const outcomes = await Promise.all([finalize(args), finalize(args)])
    assert.equal(outcomes.filter(result => !result.error).length, 1)
    expectError(outcomes.find(result => result.error), 'ACCOUNT_CREATION_NOT_PENDING')
  })
  await probe('delete_before_finalize_never_recreates_account', async () => {
    const person = await fixture()
    const result = await firstWithLock('issue110_delete_first', 'SELECT public.' + cancelName + '(' + q(person.id) + ',' + q(actor.id) + ')', () => finalize(finalArgs(person)))
    expectError(result, 'USER_NOT_FOUND'); assert.equal(await reconcile(person), 'absent')
  })
  await probe('finalize_before_cleanup_prevents_stale_delete', async () => {
    const person = await fixture(), args = finalArgs(person)
    const result = await firstWithLock('issue110_finalize_first', finalizeSql(args), () => cancel(person))
    expectError(result, 'ACCOUNT_CREATION_NOT_PENDING'); assert.equal(await reconcile(person), 'finalized_active')
  })
  await probe('admin_rights_revalidated_after_waiting_for_lock', async () => {
    const author = await fixture(); data(await finalize(finalArgs(author, 'admin')), 'Second admin')
    const person = await fixture(), args = finalArgs(person, 'client', cif(), author)
    const result = await firstWithLock('issue110_actor_first', "UPDATE public.profiles SET role='consultant' WHERE id=" + q(author.id), () => finalize(args))
    expectError(result, 'ACTIVE_ADMIN_REQUIRED'); assert.equal(await reconcile(person), 'pending')
    data(await cancel(person), 'Cleanup after author downgrade')
  })
  await probe('changed_ban_is_never_removed', async () => {
    const person = await fixture()
    data(await service.auth.admin.updateUserById(person.id, { ban_duration: '24h' }), 'Replacement ban')
    const before = state(person)
    expectError(await finalize(finalArgs(person)), 'ACCOUNT_CREATION_BAN_CHANGED')
    assert.deepEqual(state(person), before); data(await cancel(person), 'Cleanup replaced-ban fixture')
  })
  await probe('delayed_retry_does_not_reactivate_deactivated_account', async () => {
    const person = await fixture(), args = finalArgs(person)
    data(await finalize(args), 'Finalize before deactivation'); data(await active(person, false), 'Deactivate finalized account')
    const before = state(person)
    expectError(await finalize(args), 'ACCOUNT_CREATION_NOT_PENDING')
    assert.deepEqual(state(person), before); assert.equal(await reconcile(person), 'finalized_inactive')
  })
  await probe('cleanup_preserves_existing_related_data_blockers', async () => {
    const person = await fixture()
    sql('INSERT INTO public.audit_logs(user_id,action_type,entity_type,entity_id,description) VALUES(' + q(person.id) + ",'update','user'," + q(person.id) + ",'Local blocker probe')")
    expectError(await cancel(person), 'USER_HAS_RELATED_DATA')
    assert.equal(await reconcile(person), 'pending')
  })
  await probe('prototype_privileges_and_invariants', async () => {
    assert.equal(sql("SELECT has_function_privilege('anon'," + q(finalizeSignature) + ",'EXECUTE') OR has_function_privilege('authenticated'," + q(cancelSignature) + ",'EXECUTE')"), 'f')
    assert.equal(sql('SELECT count(*) FROM public.profiles WHERE creation_pending AND is_active'), '0')
    assert.equal(sql("SELECT count(*) FROM public.profiles WHERE NOT creation_pending AND role='client' AND nullif(btrim(cif),'') IS NULL"), '0')
    assert.equal(sql('SELECT count(*) FROM (SELECT cif FROM public.profiles WHERE cif IS NOT NULL GROUP BY cif HAVING count(*)>1) d'), '0')
    assert.equal(sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (" + q(finalizeName) + ',' + q(cancelName) + ") AND NOT ('search_path=pg_catalog'=ANY(p.proconfig))"), '0')
    assert.equal(sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (" + q(finalizeName) + ',' + q(cancelName) + ") AND pg_get_userbyid(p.proowner)<>'postgres'"), '0', 'Prototype uses real application function owner')
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE']) p WHERE has_table_privilege(r,'public.profiles',p))"), 'f', 'Direct profile writes remain revoked')
  })
  if (phase2) {
    const { checkPhase2 } = await import('./issue-110-phase2-checks.mjs')
    await checkPhase2({ sql, probe, q, rpc, actor, fixture, data, finalize, finalArgs, cif, state, cancel, active, expectError, firstWithLock, finalizeSql, database })
  }
  if (phase3) {
    const { checkPhase3 } = await import('./issue-110-phase3-checks.mjs')
    await checkPhase3({ sql, probe, q, service, actor, fixture, data, finalize, finalArgs, cif, state, cancel, active, userClient, password,
      setLostReply: id => { lostReplyFor = id }, setRejectReads: id => { rejectReadsFor = id } })
  }
  }
  if (phase5 && !process.exitCode) {
    const { checkPhase5 } = await import('./issue-110-phase5-checks.mjs')
    await checkPhase5({ sql, probe, q, service, baseUrl, env, database, root, temp, docker, inspect, envMap, startContainer, network, authPort, extraServices,
      onManualReady: () => {
        assert.equal(sql("SELECT jsonb_build_object('users',(SELECT count(*) FROM auth.users),'profiles',(SELECT count(*) FROM public.profiles))", 'postgres'), sourceCounts)
        writeResults({ manualEnvironmentActive: true, cleanupPending: true })
      } })
  }
} catch (error) {
  results.push({ name: stage, passed: false, reason: error instanceof assert.AssertionError ? error.message : String(error.message).slice(0, 250) })
  console.error('FAIL ' + stage + ': ' + results.at(-1).reason)
  process.exitCode = 1
} finally {
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) }
  let cleanupPassed = true
  for (const name of createdContainers.reverse()) {
    try {
      assert.equal(inspect(name).Config.Labels['bonie.issue110.phase0'], stamp)
      docker(['rm', '-f', name])
    } catch { cleanupPassed = false }
  }
  if (databaseCreated) {
    try {
      assert.match(database, /^issue110_phase[0235]_[a-f0-9]{12}$/)
      sql('DROP DATABASE ' + database + ' WITH (FORCE)', 'postgres')
    } catch { cleanupPassed = false }
  }
  if (sourceCounts) {
    try { assert.equal(sql("SELECT jsonb_build_object('users',(SELECT count(*) FROM auth.users),'profiles',(SELECT count(*) FROM public.profiles))", 'postgres'), sourceCounts) }
    catch { cleanupPassed = false }
  }
  try {
    assert.equal(path.dirname(temp), path.join(root, 'supabase', '.temp'))
    assert.match(path.basename(temp), /^issue110-[a-f0-9]{12}$/)
    fs.rmSync(temp, { recursive: true, force: true })
    assert.equal(fs.existsSync(temp), false)
  } catch { cleanupPassed = false }
  results.push({ name: 'isolated_resources_removed_source_counts_preserved', passed: cleanupPassed })
  if (!cleanupPassed) { console.error('Local cleanup requires attention: ' + database); process.exitCode = 1 }
  fs.mkdirSync('docs', { recursive: true })
  writeResults({ manualEnvironmentActive: false, cleanupPending: false })
  console.log(results.filter(result => result.passed).length + '/' + results.length + ' ' + phase + ' checks passed')
}
