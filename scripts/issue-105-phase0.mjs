import { createClient } from '@supabase/supabase-js';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const container = 'supabase_db_platforma-fonduri';
const bucket = 'project-files';
const runId = randomUUID();
const knownUsers = [];
const uploadedPaths = [];
const fixtureIds = [];
const runningChildren = new Set();
let seedAdmin;
let actorFixture;
let auditBlockerFixture;
let prototypeApplied = false;
let storageMime = 'application/pdf';
let storageExtension = '.pdf';
let apiUrl;
let anonKey;
let serviceKey;
let admin;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function quote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
}
function getLocalConfig() {
  let output;
  try {
    output = run('cmd.exe', ['/d', '/s', '/c', 'npx.cmd --yes supabase@2.118.0 status -o env']);
  } catch {
    throw new Error('Local Supabase CLI status failed; command output suppressed.');
  }
  const env = Object.create(null);
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  apiUrl = env.API_URL || env.SUPABASE_URL;
  anonKey = env.ANON_KEY || env.SUPABASE_ANON_KEY;
  serviceKey = env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const dbUrl = env.DB_URL || env.DATABASE_URL;
  assert(apiUrl && anonKey && serviceKey && dbUrl, 'Local CLI did not provide required endpoints/keys.');
  const api = new URL(apiUrl);
  const db = new URL(dbUrl);
  assert(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname),
    'Refusing non-local API endpoint.');
  assert(['127.0.0.1', 'localhost'].includes(db.hostname) && db.port === '54322',
    'Refusing non-local database endpoint.');
  return api.origin;
}
function psql(sql) {
  try {
    return run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-c', sql]).trim();
  } catch (error) {
    const details = [error.stderr, error.stdout].map((part) => part ? String(part) : '').join('\n');
    throw new Error('Local SQL failed: ' + details.trim().slice(-1800));
  }
}
function tryPsql(sql) {
  try {
    return { ok: true, stdout: run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-c', sql]).trim(), text: '' };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout) : '',
      text: [error.stderr, error.stdout].map((part) => part ? String(part) : '').join('\n')
    };
  }
}
function spawnPsql(sql) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const handle = { child, done: null };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  runningChildren.add(handle);
  handle.done = new Promise((resolve) => {
    const finish = (code) => {
      if (settled) return;
      settled = true;
      runningChildren.delete(handle);
      resolve({ code, stdout, stderr });
    };
    child.on('close', finish);
    child.on('error', () => finish(-1));
  });
  child.stdin.end(sql + '\n');
  return handle;
}
async function waitUntil(query, message, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (psql(query) === 't') return;
    await delay(100);
  }
  throw new Error(message);
}
function expectSqlError(sql, message, detailNeedle) {
  const result = tryPsql(sql);
  assert(!result.ok, 'Expected SQL error ' + message + ' but the statement succeeded.');
  assert(result.text.includes(message), 'Expected SQL error ' + message + '; actual output: ' + result.text.slice(-1000));
  if (detailNeedle) assert(result.text.includes(detailNeedle), 'Expected blocker detail containing ' + detailNeedle);
  return result.text;
}
function jsonResult(sql) {
  const output = psql(sql);
  const jsonLines = output.split(/\r?\n/).filter((line) => line.trim().startsWith('{') || line.trim().startsWith('['));
  assert(jsonLines.length === 1, 'Expected exactly one JSON result line from local SQL.');
  return JSON.parse(jsonLines[0]);
}
async function createUser(role, label) {
  const email = 'issue105-' + randomUUID() + '@example.invalid';
  const password = randomBytes(30).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { issue105_phase0_run: runId }
  });
  if (error || !data?.user?.id) {
    throw new Error('Creating a temporary local Auth user failed (' + (error?.code || error?.status || 'unknown') + ').');
  }
  const user = { id: data.user.id, email, password, role, label };
  knownUsers.push(user);
  psql(
    'INSERT INTO public.profiles (id,email,full_name,role,is_active) VALUES (' +
    quote(user.id) + ',' + quote(email) + ',' + quote('[issue105_phase0] ' + label) + ',' +
    quote(role) + ',true) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, ' +
    'full_name=EXCLUDED.full_name, role=EXCLUDED.role, is_active=true, updated_at=clock_timestamp()'
  );
  return user;
}
function anonClient() {
  return createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}
async function signIn(user) {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: user.email,
    password: user.password
  });
  if (error || !data?.session) {
    throw new Error('Local password sign-in failed (' + (error?.code || error?.status || 'unknown') + ').');
  }
  const payload = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString('utf8'));
  assert(payload.session_id, 'Access JWT did not contain session_id.');
  return { session: data.session, sessionId: payload.session_id };
}
async function signInMustFail(user) {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: user.email,
    password: user.password
  });
  assert(Boolean(error) && !data?.session, 'Password sign-in unexpectedly succeeded for a banned account.');
}
async function refreshMustFail(refreshToken) {
  const { data, error } = await anonClient().auth.refreshSession({ refresh_token: refreshToken });
  assert(Boolean(error) && !data?.session, 'Refresh unexpectedly succeeded for a deleted auth.sessions row.');
}
function eligible(userId, sessionId) {
  const sql = 'BEGIN; SET LOCAL request.jwt.claim.sub = ' + quote(userId) +
    '; SET LOCAL request.jwt.claims = ' + quote(JSON.stringify({ sub: userId, session_id: sessionId })) +
    '; SELECT issue105_phase0.current_session_eligible(); ROLLBACK;';
  const lines = psql(sql).split(/\r?\n/);
  const result = lines.find((line) => line === 't' || line === 'f');
  assert(result !== undefined, 'Eligibility helper did not return a boolean.');
  return result === 't';
}
function callTransition(user, actor, active) {
  return jsonResult(
    'SELECT issue105_phase0.transition_profile(' + quote(user.id) + ',' + quote(actor.id) + ',' +
    (active ? 'true' : 'false') + ',' + quote(runId) + ')'
  );
}
async function injectAuthFailure(user, actor, active, label) {
  const appName = 'issue105_auth_' + label + '_' + runId.replaceAll('-', '').slice(0, 8);
  const holder = spawnPsql(
    'SET application_name=' + quote(appName) + '; BEGIN; LOCK TABLE auth.sessions IN ACCESS EXCLUSIVE MODE; ' +
    'SELECT pg_sleep(4); COMMIT;'
  );
  await waitUntil(
    "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation " +
    "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='sessions' " +
    "AND l.mode='AccessExclusiveLock' AND l.granted)",
    'Could not confirm auth.sessions failure-injection lock.'
  );
  const result = jsonResult(
    'BEGIN; SET LOCAL statement_timeout=' + quote('700ms') + '; SELECT issue105_phase0.transition_profile(' +
    quote(user.id) + ',' + quote(actor.id) + ',' + (active ? 'true' : 'false') + ',' + quote(runId) + '); COMMIT;'
  );
  const held = await holder.done;
  assert(held.code === 0, 'Auth failure-injection lock holder failed (' + label + ').');
  assert(result.authSynced === false && result.authSyncPending === true,
    'Auth failure injection did not return pending state (' + label + ').');
  return result;
}
async function injectAuditFailure(sql, label) {
  const appName = 'issue105_audit_' + label + '_' + runId.replaceAll('-', '').slice(0, 8);
  const holder = spawnPsql(
    'SET application_name=' + quote(appName) + '; BEGIN; LOCK TABLE public.audit_logs IN SHARE MODE; ' +
    'SELECT pg_sleep(4); COMMIT;'
  );
  await waitUntil(
    "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation " +
    "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='audit_logs' " +
    "AND l.mode='ShareLock' AND l.granted)",
    'Could not confirm audit_logs failure-injection lock (' + label + ').'
  );
  const result = tryPsql(
    'BEGIN; SET LOCAL statement_timeout=' + quote('700ms') + '; ' + sql + '; COMMIT;'
  );
  const held = await holder.done;
  assert(held.code === 0, 'Audit failure-injection lock holder failed (' + label + ').');
  assert(!result.ok && result.text.includes('57014') && result.text.includes('statement timeout'),
    'Audit failure injection did not abort the transaction at the audit insert (' + label + ').');
  return result.text;
}
function callDelete(user, actor) {
  return jsonResult(
    'SELECT issue105_phase0.hard_delete_user(' + quote(user.id) + ',' + quote(actor.id) + ',' +
    quote(runId) + ')'
  );
}
async function upload(path) {
  const body = storageMime === 'application/pdf'
    ? '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
    : 'issue105 phase0 fixture';
  const { error } = await admin.storage.from(bucket).upload(path, new Blob([body]), {
    contentType: storageMime,
    upsert: false
  });
  if (error) throw new Error('Local Storage fixture upload failed (' + (error.code || error.statusCode || 'unknown') + ').');
  uploadedPaths.push(path);
}
async function removeUpload(path) {
  const { error } = await admin.storage.from(bucket).remove([path]);
  if (error) throw new Error('Local Storage fixture cleanup failed (' + (error.code || error.statusCode || 'unknown') + ').');
  const index = uploadedPaths.indexOf(path);
  if (index >= 0) uploadedPaths.splice(index, 1);
}
function setStorageOwner(path, ownerId) {
  return psql(
    'UPDATE storage.objects SET owner=' + (ownerId ? quote(ownerId) : 'NULL') +
    ', owner_id=' + (ownerId ? quote(ownerId) : 'NULL') +
    ' WHERE bucket_id=' + quote(bucket) + ' AND name=' + quote(path)
  );
}
function deleteAuditCount(userId, actorId) {
  return Number(psql(
    'SELECT count(*) FROM public.audit_logs WHERE user_id=' + quote(actorId) +
    ' AND entity_id=' + quote(userId) + " AND new_values->>'operation' IN ('deactivate','reactivate')"
  ));
}
async function cleanupUser(user, actor) {
  if (!user) return;
  const exists = psql('SELECT count(*) FROM auth.users WHERE id=' + quote(user.id));
  if (exists === '1') {
    callDelete(user, actor);
    user.deleted = true;
  }
}
async function cleanupAll() {
  const warnings = [];
  for (const handle of [...runningChildren]) handle.child.kill();
  await Promise.all([...runningChildren].map((handle) => handle.done));
  if (!prototypeApplied) return;

  for (const id of fixtureIds) {
    try {
      if (psql("SELECT to_regnamespace('issue105_phase0') IS NOT NULL") === 't') {
        psql('DELETE FROM issue105_phase0.profile_reference_fixture WHERE id=' + quote(id));
      }
    } catch (error) {
      warnings.push('fixture ' + id + ': ' + error.message);
    }
  }
  for (const path of [...uploadedPaths]) {
    try { await removeUpload(path); }
    catch (error) { warnings.push('Storage path ' + path + ': ' + error.message); }
  }

  const preserved = new Set(
    [actorFixture?.id, auditBlockerFixture?.id].filter(Boolean)
  );
  const defaultActor = actorFixture || seedAdmin;
  for (const user of knownUsers) {
    if (preserved.has(user.id)) continue;
    try {
      const exists = psql('SELECT count(*) FROM auth.users WHERE id=' + quote(user.id));
      if (exists !== '1') continue;
      const authored = Number(psql('SELECT count(*) FROM public.audit_logs WHERE user_id=' + quote(user.id)));
      if (authored > 0) {
        preserved.add(user.id);
        if (psql('SELECT is_active IS TRUE FROM public.profiles WHERE id=' + quote(user.id)) === 't') {
          callTransition(user, seedAdmin, false);
        }
      } else {
        await cleanupUser(user, defaultActor);
      }
    } catch (error) {
      warnings.push('user ' + user.id + ': ' + error.message);
    }
  }
  for (const id of [...preserved]) {
    try {
      if (psql('SELECT count(*) FROM auth.users WHERE id=' + quote(id)) !== '1') continue;
      if (psql('SELECT is_active IS TRUE FROM public.profiles WHERE id=' + quote(id)) === 't') {
        const user = knownUsers.find((candidate) => candidate.id === id);
        if (user) {
          const result = callTransition(user, seedAdmin, false);
          if (result.active !== false || result.authSynced !== true) throw new Error('Preserved fixture did not deactivate/sync.');
          if (psql('SELECT is_active IS FALSE FROM public.profiles WHERE id=' + quote(id)) !== 't') {
            throw new Error('Preserved fixture remained active.');
          }
        }
      }
    } catch (error) {
      warnings.push('preserved account ' + id + ': ' + error.message);
    }
  }

  try {
    const exists = psql("SELECT to_regnamespace('issue105_phase0') IS NOT NULL");
    if (exists === 't') {
      const ownedOnly = psql(
        "SELECT (SELECT count(*) FROM pg_class WHERE relnamespace=to_regnamespace('issue105_phase0') AND relkind='r' " +
        "AND relname IN ('auth_state','profile_reference_fixture'))=2 " +
        "AND (SELECT count(*) FROM pg_class WHERE relnamespace=to_regnamespace('issue105_phase0') AND relkind='r')=2 " +
        "AND (SELECT count(*) FROM pg_proc WHERE pronamespace=to_regnamespace('issue105_phase0') " +
        "AND proname IN ('current_session_eligible','transition_profile','hard_delete_user','guard_storage_owner'))=4 " +
        "AND (SELECT count(*) FROM pg_proc WHERE pronamespace=to_regnamespace('issue105_phase0'))=4"
      );
      psql('DROP TRIGGER IF EXISTS issue105_phase0_storage_owner_guard ON storage.objects');
      if (ownedOnly === 't') {
        psql('DROP SCHEMA issue105_phase0 CASCADE');
        if (psql("SELECT to_regnamespace('issue105_phase0') IS NULL") !== 't') {
          warnings.push('Isolated schema remained after cleanup.');
        }
      } else {
        warnings.push('Isolated schema contained unexpected objects and was preserved.');
      }
      if (psql("SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='issue105_phase0_storage_owner_guard' AND NOT tgisinternal)") !== 't') {
        warnings.push('Temporary Storage owner trigger remained after cleanup.');
      }
    }
  } catch (error) {
    warnings.push('prototype schema/trigger cleanup: ' + error.message);
  }
  if (actorFixture) console.log('Retained inactive actor fixture: ' + actorFixture.id + '.');
  if (auditBlockerFixture) console.log('Retained inactive audit-blocker fixture: ' + auditBlockerFixture.id + '.');
  for (const warning of warnings) console.error('CLEANUP_WARNING: ' + warning);
  if (warnings.length > 0) throw new Error('Cleanup incomplete; see CLEANUP_WARNING lines.');
}
async function applyPrototype() {
  const schemaAbsent = psql(
    "SELECT to_regnamespace('issue105_phase0') IS NULL AND NOT EXISTS (" +
    "SELECT 1 FROM pg_trigger WHERE tgname='issue105_phase0_storage_owner_guard' AND NOT tgisinternal)"
  );
  assert(schemaAbsent === 't', 'Prototype schema/trigger already exists; preserving it without overwrite.');
  const sqlPath = fileURLToPath(new URL('./issue-105-phase0-prototype.sql', import.meta.url));
  const sql = readFileSync(sqlPath, 'utf8');
  try {
    run('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '--single-transaction', '-f', '-'], { input: sql });
  } catch (error) {
    const details = [error.stderr, error.stdout].map((part) => part ? String(part) : '').join('\n');
    throw new Error('Local prototype DDL failed; transaction rolled back: ' + details.trim().slice(-1800));
  }
}
async function main() {
  const localOrigin = getLocalConfig();
  const dockerRunning = run('docker', ['inspect', '--format', '{{.State.Running}}', container]).trim();
  assert(dockerRunning === 'true', 'Expected existing local Supabase DB container to be running.');
  admin = createClient(apiUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  seedAdmin = { id: psql("SELECT id FROM public.profiles WHERE role='admin' AND is_active IS TRUE ORDER BY id LIMIT 1") };
  assert(/^[0-9a-f-]{36}$/i.test(seedAdmin.id), 'Expected one existing active local admin for cleanup.');
  const allowedMimeJson = psql("SELECT coalesce(to_json(allowed_mime_types)::text, 'null') FROM storage.buckets WHERE id='project-files'");
  assert(allowedMimeJson.length > 0, 'Expected local project-files bucket metadata.');
  const allowedMime = JSON.parse(allowedMimeJson);
  if (allowedMime === null || allowedMime.includes('application/pdf')) {
    storageMime = 'application/pdf';
    storageExtension = '.pdf';
  } else if (allowedMime.includes('text/plain')) {
    storageMime = 'text/plain';
    storageExtension = '.txt';
  } else {
    throw new Error('Local project-files bucket allows neither application/pdf nor text/plain.');
  }
  console.log('Local target verified: ' + localOrigin + ' and existing Postgres container.');
  await applyPrototype();
  prototypeApplied = true;
  console.log('Isolated prototype DDL applied transactionally to local Postgres.');
  let runFailure;
  try {
    const actor = actorFixture = await createUser('admin', 'temporary actor');
  const lifecycle = await createUser('client', 'lifecycle');
  const sameAccount = expectSqlError(
    'SELECT issue105_phase0.transition_profile(' + quote(actor.id) + ',' + quote(actor.id) + ',false,' + quote(runId) + ')',
    'SELF_ACCOUNT_ACTION'
  );
  assert(sameAccount.includes('P0001'), 'Self-action did not use SQLSTATE P0001.');

  const original = await signIn(lifecycle);
  assert(eligible(lifecycle.id, original.sessionId), 'New Auth session was not eligible.');
  assert(psql('SELECT count(*) FROM auth.sessions WHERE id=' + quote(original.sessionId) +
    ' AND user_id=' + quote(lifecycle.id)) === '1', 'GoTrue session did not match JWT session_id.');

  const authLockName = 'issue105_auth_lock_' + runId.replaceAll('-', '').slice(0, 12);
  const authLock = spawnPsql(
    "SET application_name=" + quote(authLockName) + "; BEGIN; LOCK TABLE auth.sessions IN ACCESS EXCLUSIVE MODE; " +
    'SELECT pg_sleep(5); COMMIT;'
  );
  await waitUntil(
    "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation " +
    "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='sessions' " +
    "AND l.mode='AccessExclusiveLock' AND l.granted)",
    'Could not confirm the local auth.sessions failure-injection lock.'
  );
  const injected = jsonResult(
    'BEGIN; SET LOCAL statement_timeout = ' + quote('750ms') + '; SELECT issue105_phase0.transition_profile(' +
    quote(lifecycle.id) + ',' + quote(actor.id) + ',false,' + quote(runId) + '); COMMIT;'
  );
  const authLockResult = await authLock.done;
  assert(authLockResult.code === 0, 'auth.sessions lock-holder process failed.');
  assert(injected.active === false && injected.authSynced === false && injected.authSyncPending === true,
    'Auth DML failure did not leave the profile inactive and pending.');
  assert(psql('SELECT is_active IS FALSE FROM public.profiles WHERE id=' + quote(lifecycle.id)) === 't',
    'Auth failure path did not keep profile inactive.');
  assert(psql('SELECT auth_sync_pending FROM issue105_phase0.auth_state WHERE user_id=' + quote(lifecycle.id)) === 't',
    'Auth failure path did not persist pending state.');
  assert(psql('SELECT banned_until IS NULL FROM auth.users WHERE id=' + quote(lifecycle.id)) === 't',
    'Auth savepoint failed to roll back a partial ban.');
  assert(!eligible(lifecycle.id, original.sessionId), 'Inactive profile remained eligible during Auth sync failure.');
  const auditAfterFailure = deleteAuditCount(lifecycle.id, actor.id);
  assert(auditAfterFailure === 1, 'Failed deactivation must produce exactly one lifecycle audit row.');

  const retried = callTransition(lifecycle, actor, false);
  assert(retried.authSynced === true && retried.active === false && retried.authSyncPending === false,
    'Auth retry did not synchronize deactivation.');
  assert(psql("SELECT banned_until > now() AND banned_until <> 'infinity'::timestamptz FROM auth.users WHERE id=" +
    quote(lifecycle.id)) === 't', 'Deactivation did not apply a finite active ban.');
  assert(psql('SELECT count(*) FROM auth.sessions WHERE user_id=' + quote(lifecycle.id)) === '0',
    'Deactivation did not remove every Auth session.');
  assert(deleteAuditCount(lifecycle.id, actor.id) === auditAfterFailure, 'Retry duplicated the lifecycle audit event.');
  await signInMustFail(lifecycle);
  await refreshMustFail(original.session.refresh_token);
  const reactivated = callTransition(lifecycle, actor, true);
  assert(reactivated.authSynced === true && reactivated.active === true, 'Reactivation did not complete.');
  assert(psql('SELECT banned_until IS NULL FROM auth.users WHERE id=' + quote(lifecycle.id)) === 't',
    'Reactivation did not restore the prior unbanned state.');
  assert(psql('SELECT count(*) FROM auth.sessions WHERE user_id=' + quote(lifecycle.id)) === '0',
    'Reactivation recreated or retained an old Auth session.');
  assert(!eligible(lifecycle.id, original.sessionId), 'Old JWT became eligible after reactivation.');
  await refreshMustFail(original.session.refresh_token);
  const newSession = await signIn(lifecycle);
  assert(eligible(lifecycle.id, newSession.sessionId), 'Fresh login after reactivation was not eligible.');

  const serialApp = 'issue105_serial_' + runId.replaceAll('-', '').slice(0, 10);
  const serial = spawnPsql(
    'SET application_name=' + quote(serialApp) + '; BEGIN; ' +
    'SELECT issue105_phase0.transition_profile(' + quote(lifecycle.id) + ',' + quote(actor.id) +
    ',false,' + quote(runId) + '); SELECT pg_sleep(2); COMMIT;'
  );
  await waitUntil(
    'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=' + quote(serialApp) +
    " AND state='active' AND query LIKE '%pg_sleep%')",
    'Could not confirm first lifecycle transition held the per-account transaction.'
  );
  const queuedReactivate = callTransition(lifecycle, actor, true);
  const serialResult = await serial.done;
  assert(serialResult.code === 0, 'First serialized transition failed.');
  assert(queuedReactivate.active === true && queuedReactivate.authSynced === true,
    'Queued reactivation did not win after the preceding transaction committed.');
  assert(psql('SELECT is_active IS TRUE FROM public.profiles WHERE id=' + quote(lifecycle.id)) === 't',
    'Serialized transition ended inactive.');
  assert(psql('SELECT banned_until IS NULL FROM auth.users WHERE id=' + quote(lifecycle.id)) === 't',
    'Serialized transition left the lifecycle ban applied.');

  const auditFailureTarget = await createUser('client', 'deactivation audit rollback');
  const auditFailureSession = await signIn(auditFailureTarget);
  await injectAuditFailure(
    'SELECT issue105_phase0.transition_profile(' + quote(auditFailureTarget.id) + ',' +
    quote(actor.id) + ',false,' + quote(runId) + ')',
    'deactivation'
  );
  assert(psql('SELECT is_active IS TRUE FROM public.profiles WHERE id=' + quote(auditFailureTarget.id)) === 't',
    'Audit failure did not roll back the profile deactivation.');
  assert(psql('SELECT banned_until IS NULL FROM auth.users WHERE id=' + quote(auditFailureTarget.id)) === 't',
    'Audit failure did not roll back the Auth ban.');
  assert(psql('SELECT count(*) FROM auth.sessions WHERE user_id=' + quote(auditFailureTarget.id)) === '1',
    'Audit failure did not roll back session deletion.');
  assert(eligible(auditFailureTarget.id, auditFailureSession.sessionId),
    'Audit failure did not restore pre-transition session eligibility.');
  assert(deleteAuditCount(auditFailureTarget.id, actor.id) === 0,
    'Audit failure unexpectedly left a lifecycle audit row.');
  await cleanupUser(auditFailureTarget, actor);

  const reactivateFailure = await createUser('client', 'reactivation Auth failure');
  const reactivateOld = await signIn(reactivateFailure);
  const initialDeactivate = callTransition(reactivateFailure, actor, false);
  assert(initialDeactivate.authSynced && initialDeactivate.active === false,
    'Setup deactivation for Auth reactivation-failure test did not complete.');
  await refreshMustFail(reactivateOld.session.refresh_token);
  const failedReactivate = await injectAuthFailure(reactivateFailure, actor, true, 'reactivate');
  assert(failedReactivate.active === false, 'Failed reactivation did not remain inactive.');
  assert(psql('SELECT is_active IS FALSE FROM public.profiles WHERE id=' + quote(reactivateFailure.id)) === 't',
    'Auth failure during reactivation activated the profile.');
  assert(psql('SELECT auth_sync_pending FROM issue105_phase0.auth_state WHERE user_id=' + quote(reactivateFailure.id)) === 't',
    'Auth failure during reactivation did not persist pending state.');
  assert(deleteAuditCount(reactivateFailure.id, actor.id) === 1,
    'Failed reactivation created a duplicate lifecycle audit event.');
  const reactivateRetry = callTransition(reactivateFailure, actor, true);
  assert(reactivateRetry.active && reactivateRetry.authSynced, 'Reactivation retry did not complete.');
  assert(!eligible(reactivateFailure.id, reactivateOld.sessionId),
    'Old JWT became eligible after a successful reactivation retry.');
  assert(psql('SELECT count(*) FROM auth.sessions WHERE user_id=' + quote(reactivateFailure.id)) === '0',
    'Reactivation retry retained an old session.');
  await cleanupUser(reactivateFailure, actor);

  const failedDeactivate = await createUser('client', 'failed deactivation then reactivation');
  const failedDeactivateOld = await signIn(failedDeactivate);
  await injectAuthFailure(failedDeactivate, actor, false, 'deactivate-reactivate');
  assert(psql('SELECT applied_banned_until IS NULL AND auth_sync_pending FROM issue105_phase0.auth_state WHERE user_id=' +
    quote(failedDeactivate.id)) === 't', 'Failed deactivation did not keep the applied-ban marker empty and pending.');
  assert(psql('SELECT count(*) FROM auth.sessions WHERE user_id=' + quote(failedDeactivate.id)) === '1',
    'Injected deactivation failure did not roll back session deletion.');
  const directReactivate = callTransition(failedDeactivate, actor, true);
  assert(directReactivate.active && directReactivate.authSynced,
    'Reactivation after failed deactivation did not complete.');
  assert(psql('SELECT count(*) FROM auth.sessions WHERE user_id=' + quote(failedDeactivate.id)) === '0',
    'Reactivation after a failed deactivation did not revoke the old session.');
  assert(!eligible(failedDeactivate.id, failedDeactivateOld.sessionId),
    'Old JWT became eligible after reactivation from applied_banned_until NULL.');
  await refreshMustFail(failedDeactivateOld.session.refresh_token);
  await cleanupUser(failedDeactivate, actor);

  const independentRetry = await createUser('client', 'independent ban during retry');
  await injectAuthFailure(independentRetry, actor, false, 'independent-ban');
  psql('UPDATE auth.users SET banned_until=clock_timestamp() + interval ' + quote('30 days') +
    ' WHERE id=' + quote(independentRetry.id));
  const independentBan = psql("SELECT to_char(banned_until, 'YYYY-MM-DD HH24:MI:SS.USOF') FROM auth.users WHERE id=" +
    quote(independentRetry.id));
  const independentRetryResult = callTransition(independentRetry, actor, false);
  assert(independentRetryResult.authSynced, 'Pending deactivation retry did not complete.');
  callTransition(independentRetry, actor, true);
  const independentRestored = psql("SELECT to_char(banned_until, 'YYYY-MM-DD HH24:MI:SS.USOF') FROM auth.users WHERE id=" +
    quote(independentRetry.id));
  assert(independentBan === independentRestored,
    'Pending retry overwrote an independent Auth ban before reactivation.');
  await cleanupUser(independentRetry, actor);

  const inactiveWithoutState = await createUser('client', 'inactive without metadata');
  psql('UPDATE public.profiles SET is_active=false WHERE id=' + quote(inactiveWithoutState.id));
  const repairedInactive = callTransition(inactiveWithoutState, actor, false);
  assert(repairedInactive.authSynced && repairedInactive.active === false,
    'Existing inactive profile without phase-0 state was not synchronized.');
  assert(psql('SELECT auth_sync_pending IS FALSE AND applied_banned_until > now() FROM issue105_phase0.auth_state WHERE user_id=' +
    quote(inactiveWithoutState.id)) === 't',
    'Existing inactive profile did not receive finite Auth ban and cleared pending state.');
  callTransition(inactiveWithoutState, actor, true);
  await cleanupUser(inactiveWithoutState, actor);
  const preBanned = await createUser('client', 'pre-existing ban');
  psql('UPDATE auth.users SET banned_until=clock_timestamp() + interval ' + quote('30 days') +
    ' WHERE id=' + quote(preBanned.id));
  const priorBan = psql("SELECT to_char(banned_until, 'YYYY-MM-DD HH24:MI:SS.USOF') FROM auth.users WHERE id=" + quote(preBanned.id));
  callTransition(preBanned, actor, false);
  callTransition(preBanned, actor, true);
  const restoredBan = psql("SELECT to_char(banned_until, 'YYYY-MM-DD HH24:MI:SS.USOF') FROM auth.users WHERE id=" + quote(preBanned.id));
  assert(priorBan === restoredBan, 'Reactivation changed an independent pre-existing ban.');

  const fkTarget = await createUser('client', 'FK blocker');
  const refId = randomUUID();
  fixtureIds.push(refId);
  psql('INSERT INTO issue105_phase0.profile_reference_fixture(id,profile_id) VALUES (' +
    quote(refId) + ',' + quote(fkTarget.id) + ')');
  const fkBlock = expectSqlError(
    'SELECT issue105_phase0.hard_delete_user(' + quote(fkTarget.id) + ',' + quote(actor.id) + ',' + quote(runId) + ')',
    'USER_HAS_RELATED_DATA',
    'profile_reference_fixture'
  );
  assert(fkBlock.includes('P0001'), 'FK blocker did not use SQLSTATE P0001.');
  psql('DELETE FROM issue105_phase0.profile_reference_fixture WHERE id=' + quote(refId));
  await cleanupUser(fkTarget, actor);

  const auditTarget = await createUser('client', 'audit blocker');
  psql(
    'INSERT INTO public.audit_logs(id,user_id,action_type,entity_type,entity_id,description,created_at) VALUES (' +
    quote(randomUUID()) + ',' + quote(auditTarget.id) + ",'create','user'," + quote(auditTarget.id) +
    ',' + quote('[issue105_phase0 run=' + runId + '] explicit audit blocker') + ',clock_timestamp())'
  );
  auditBlockerFixture = auditTarget;
  const auditBlock = expectSqlError(
    'SELECT issue105_phase0.hard_delete_user(' + quote(auditTarget.id) + ',' + quote(actor.id) + ',' + quote(runId) + ')',
    'USER_HAS_RELATED_DATA',
    'public.audit_logs'
  );
  assert(auditBlock.includes('P0001'), 'Audit blocker did not use SQLSTATE P0001.');

  const storageTarget = await createUser('client', 'storage blocker');
  const storagePath = 'issue105-phase0/' + runId + '/storage-blocker' + storageExtension;
  await upload(storagePath);
  assert(psql("SELECT count(*) FROM storage.objects WHERE bucket_id='project-files' AND name=" +
    quote(storagePath)) === '1', 'Storage API did not create the recorded fixture object.');
  setStorageOwner(storagePath, storageTarget.id);
  const storageBlock = expectSqlError(
    'SELECT issue105_phase0.hard_delete_user(' + quote(storageTarget.id) + ',' + quote(actor.id) + ',' + quote(runId) + ')',
    'USER_HAS_RELATED_DATA',
    'storage.objects'
  );
  assert(storageBlock.includes('P0001'), 'Storage blocker did not use SQLSTATE P0001.');
  const missingOwner = randomUUID();
  const ownerGuard = expectSqlError(
    'UPDATE storage.objects SET owner=' + quote(missingOwner) + ',owner_id=' + quote(missingOwner) +
    ' WHERE bucket_id=' + quote(bucket) + ' AND name=' + quote(storagePath),
    'STORAGE_OWNER_PROFILE_REQUIRED'
  );
  assert(ownerGuard.includes('P0001'), 'Storage owner guard did not use SQLSTATE P0001.');
  setStorageOwner(storagePath, null);
  await removeUpload(storagePath);
  await cleanupUser(storageTarget, actor);

  const auditRollbackTarget = await createUser('client', 'audit rollback');
  const auditLockName = 'issue105_audit_lock_' + runId.replaceAll('-', '').slice(0, 12);
  const auditLock = spawnPsql(
    'SET application_name=' + quote(auditLockName) + '; BEGIN; LOCK TABLE public.audit_logs IN SHARE MODE; ' +
    'SELECT pg_sleep(5); COMMIT;'
  );
  await waitUntil(
    "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation " +
    "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='audit_logs' " +
    "AND l.mode='ShareLock' AND l.granted)",
    'Could not confirm the local audit failure-injection lock.'
  );
  const auditFailure = tryPsql(
    'BEGIN; SET LOCAL statement_timeout=' + quote('750ms') + '; SELECT issue105_phase0.hard_delete_user(' +
    quote(auditRollbackTarget.id) + ',' + quote(actor.id) + ',' + quote(runId) + '); COMMIT;'
  );
  assert(!auditFailure.ok && auditFailure.text.includes('statement timeout'),
    'Audit failure injection did not fail at the blocked audit insert.');
  const auditLockResult = await auditLock.done;
  assert(auditLockResult.code === 0, 'Audit lock-holder process failed.');
  assert(psql('SELECT count(*) FROM auth.users WHERE id=' + quote(auditRollbackTarget.id)) === '1',
    'Audit failure did not roll back the Auth hard delete.');
  assert(psql('SELECT count(*) FROM public.profiles WHERE id=' + quote(auditRollbackTarget.id)) === '1',
    'Audit failure did not roll back profile deletion.');
  assert(psql("SELECT count(*) FROM public.audit_logs WHERE action_type='delete' AND entity_id=" +
    quote(auditRollbackTarget.id)) === '0', 'Audit failure unexpectedly left a delete audit row.');
  await cleanupUser(auditRollbackTarget, actor);

  const fkRaceTarget = await createUser('client', 'FK concurrency');
  const raceRefId = randomUUID();
  fixtureIds.push(raceRefId);
  const fkRaceApp = 'issue105_fk_race_' + runId.replaceAll('-', '').slice(0, 10);
  const fkHolder = spawnPsql(
    'SET application_name=' + quote(fkRaceApp) + '; BEGIN; INSERT INTO issue105_phase0.profile_reference_fixture(id,profile_id) VALUES (' +
    quote(raceRefId) + ',' + quote(fkRaceTarget.id) + '); SELECT pg_sleep(2); COMMIT;'
  );
  await waitUntil(
    'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=' + quote(fkRaceApp) +
    " AND state='active' AND query LIKE '%pg_sleep%')",
    'Could not confirm FK reference transaction acquired its profile lock.'
  );
  const fkRaceDelete = tryPsql(
    'SELECT issue105_phase0.hard_delete_user(' + quote(fkRaceTarget.id) + ',' + quote(actor.id) + ',' + quote(runId) + ')'
  );
  assert(!fkRaceDelete.ok && fkRaceDelete.text.includes('USER_HAS_RELATED_DATA'),
    'Hard delete did not observe the concurrently committed FK relationship.');
  const fkRaceResult = await fkHolder.done;
  assert(fkRaceResult.code === 0, 'FK race fixture transaction failed.');
  psql('DELETE FROM issue105_phase0.profile_reference_fixture WHERE id=' + quote(raceRefId));
  await cleanupUser(fkRaceTarget, actor);

  const storageRaceTarget = await createUser('client', 'Storage concurrency');
  const racePath = 'issue105-phase0/' + runId + '/storage-race' + storageExtension;
  await upload(racePath);
  setStorageOwner(racePath, actor.id);
  const storageRaceApp = 'issue105_storage_race_' + runId.replaceAll('-', '').slice(0, 10);
  const storageDelete = spawnPsql(
    'SET application_name=' + quote(storageRaceApp) + '; BEGIN; SELECT pg_advisory_xact_lock(105,1); ' +
    'SELECT id FROM public.profiles WHERE id=' + quote(storageRaceTarget.id) + ' FOR UPDATE; ' +
    'SELECT pg_sleep(2); SELECT issue105_phase0.hard_delete_user(' + quote(storageRaceTarget.id) + ',' +
    quote(actor.id) + ',' + quote(runId) + '); COMMIT;'
  );
  await waitUntil(
    'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=' + quote(storageRaceApp) +
    " AND state='active' AND query LIKE '%pg_sleep%')",
    'Could not confirm hard-delete transaction holds the target profile lock.'
  );
  const storageUpdate = spawnPsql(
    'UPDATE storage.objects SET owner=' + quote(storageRaceTarget.id) + ',owner_id=' +
    quote(storageRaceTarget.id) + ' WHERE bucket_id=' + quote(bucket) + ' AND name=' + quote(racePath) + ';'
  );
  const [storageDeleteResult, storageUpdateResult] = await Promise.all([storageDelete.done, storageUpdate.done]);
  assert(storageDeleteResult.code === 0 && storageDeleteResult.stdout.includes('"deleted": true'),
    'Concurrent hard delete failed before commit.');
  assert(storageUpdateResult.code !== 0 && storageUpdateResult.stderr.includes('STORAGE_OWNER_PROFILE_REQUIRED'),
    'Storage owner race was not rejected after the profile deletion.');
  assert(psql('SELECT count(*) FROM auth.users WHERE id=' + quote(storageRaceTarget.id)) === '0',
    'Concurrent Auth hard delete did not remove the target.');
  await removeUpload(racePath);

  await cleanupUser(lifecycle, actor);
  await cleanupUser(preBanned, actor);

  const retainedAuditRows = Number(psql('SELECT count(*) FROM public.audit_logs WHERE user_id=' + quote(actor.id)));
  assert(retainedAuditRows > 0, 'Expected the temporary actor audit to remain append-only.');
  } catch (error) {
    runFailure = error;
    throw error;
  } finally {
    try { await cleanupAll(); }
    catch (cleanupError) {
      if (runFailure) console.error('CLEANUP_FAILED: ' + cleanupError.message);
      else throw cleanupError;
    }
  }
  console.log('PASS: password login, refresh revocation, session_id eligibility, and old JWT rejection after unban.');
  console.log('PASS: Auth DML failure savepoint leaves inactive/pending state; retry completes without duplicate audit.');
  console.log('PASS: serialized local lifecycle transactions; previous independent ban preserved.');
  console.log('PASS: hard-delete FK/audit/Storage blockers, real Auth deletion, and same-transaction audit rollback.');
  console.log('PASS: FK and Storage profile-lock races; Storage owner trigger rejects deleted owner.');
}
main().catch((error) => {
  console.error('FAILED: ' + error.message);
  process.exitCode = 1;
});
