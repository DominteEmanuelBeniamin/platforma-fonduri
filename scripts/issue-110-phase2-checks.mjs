import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { CIF_COUNTRIES, normalizeCif } from '../lib/cif.ts'
import { inspectCifProfiles } from '../lib/cif-preflight.ts'

const snapshotSql = `SELECT jsonb_build_object(
  'profiles',coalesce(jsonb_agg(jsonb_build_object('role',role,'cif',cif) ORDER BY id),'[]'::jsonb),
  'fingerprint',md5(coalesce(jsonb_agg(jsonb_build_array(id,role,cif) ORDER BY id),'[]'::jsonb)::text)) FROM public.profiles`
let advisorBaseline = new Set()

function localCli(database, args) {
  assert.match(database, /^issue110_phase[235]_[a-f0-9]{12}$/)
  const container = JSON.parse(execFileSync('docker', ['inspect', 'supabase_db_platforma-fonduri'], { encoding: 'utf8', windowsHide: true }))[0]
  const passwordLine = container.Config.Env.find(line => line.startsWith('POSTGRES_PASSWORD='))
  assert.ok(passwordLine, 'Local DB password available without logging it')
  const url = new URL('postgresql://postgres@127.0.0.1:54322/' + database)
  url.password = passwordLine.slice('POSTGRES_PASSWORD='.length)
  let output
  try {
    output = execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', ...args, '--db-url', url.href, '--output-format', 'json'], { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['pipe','pipe','pipe'], maxBuffer: 4 * 1024 * 1024 })
  } catch (failure) {
    // CLI errors may echo connection details; never copy them into the report.
    throw new Error('Local ' + args[1] + ' failed (exit ' + (failure.status ?? 'unknown') + ')')
  }
  const report = JSON.parse(output)
  return Array.isArray(report) ? report : Object.values(report).find(Array.isArray) || []
}

const advisorArgs = ['db','advisors','--type','all','--level','warn','--fail-on','error']
const advisorKey = item => item.cache_key || JSON.stringify(item)

export async function installPhase2({ sql, probe, q, rpc, actor, fixture, data, database }) {
  const migrations = fs.readdirSync('supabase/migrations').filter(file => file.endsWith('_issue_110_cif_account_creation.sql'))
  assert.equal(migrations.length, 1, 'Exactly one phase 2 migration')
  const migration = fs.readFileSync(path.join('supabase/migrations', migrations[0]), 'utf8')
  advisorBaseline = new Set(localCli(database, advisorArgs).map(advisorKey))
  const snapshot = () => JSON.parse(sql(snapshotSql))
  const apply = fingerprint => sql('SET app.issue110_cif_preflight=' + q(fingerprint) + ';' + migration)
  const install = () => {
    const current = snapshot()
    assert.ok(inspectCifProfiles(current.profiles).valid, 'CIF_PREFLIGHT_FAILED')
    apply(current.fingerprint)
  }
  await probe('migration_requires_explicit_preflight_and_rolls_back', async () => {
    assert.throws(() => sql(migration), /CIF_PREFLIGHT_REQUIRED/)
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='creation_pending'"), '0')
  })
  await probe('migration_refuses_changed_snapshot_under_lock', async () => {
    const before = snapshot()
    sql("UPDATE public.profiles SET cif='RO5258486' WHERE id=" + q(actor.id))
    assert.throws(() => apply(before.fingerprint), /CIF_PREFLIGHT_REQUIRED/)
    sql('UPDATE public.profiles SET cif=NULL WHERE id=' + q(actor.id))
  })
  await probe('migration_refuses_noncanonical_data_without_repairing_it', async () => {
    sql("UPDATE public.profiles SET cif='ro 0005.258.486' WHERE id=" + q(actor.id))
    const current = snapshot()
    assert.equal(inspectCifProfiles(current.profiles).nonCanonical, 1)
    assert.throws(() => apply(current.fingerprint), /CIF_PREFLIGHT_INVALID/)
    assert.equal(sql('SELECT cif FROM public.profiles WHERE id=' + q(actor.id)), 'ro 0005.258.486')
    sql('UPDATE public.profiles SET cif=NULL WHERE id=' + q(actor.id))
  })
  await probe('preflight_refuses_checksum_missing_and_duplicate_values', async () => {
    sql("UPDATE public.profiles SET cif='RO12345678' WHERE id=" + q(actor.id))
    assert.throws(install, /CIF_PREFLIGHT_FAILED/)
    sql('UPDATE public.profiles SET cif=NULL WHERE id=' + q(actor.id))
    const legacy = await fixture()
    assert.equal(inspectCifProfiles(snapshot().profiles).missing, 1)
    assert.throws(install, /CIF_PREFLIGHT_FAILED/)
    sql("UPDATE public.profiles SET cif='RO5258486' WHERE id IN (" + q(actor.id) + ',' + q(legacy.id) + ')')
    const current = snapshot()
    assert.equal(inspectCifProfiles(current.profiles).duplicates, 1)
    assert.throws(() => apply(current.fingerprint), /CIF_PREFLIGHT_DUPLICATE/)
    sql('UPDATE public.profiles SET cif=NULL WHERE id=' + q(actor.id))
    data(await rpc('delete_empty_user_account', { p_target_id: legacy.id, p_actor_id: actor.id }), 'Remove disposable preflight fixture')
  })
  install()
  assert.equal(sql('SELECT creation_pending::text FROM public.profiles WHERE id=' + q(actor.id)), 'false', 'Existing account remains finalized')
}

export async function checkPhase2(ctx) {
  const { sql, probe, q, rpc, actor, fixture, data, finalize, finalArgs, cif, state, cancel, active, expectError, firstWithLock, database } = ctx
  const patch = (person, changes, author = actor) => rpc('update_user_profile_guarded', { p_target_id: person.id, p_actor_id: author.id, p_changes: changes })
  const patchSql = (person, changes) => 'public.update_user_profile_guarded(' + q(person.id) + ',' + q(actor.id) + ',' + q(JSON.stringify(changes)) + '::jsonb)'
  const client = async () => { const person = await fixture(); data(await finalize(finalArgs(person)), 'Create disposable client'); return person }

  await probe('sql_identity_matches_typescript_all_27_countries', async () => {
    const values = CIF_COUNTRIES.flatMap(country => [country.example, country.example.toLowerCase().split('').join('. '), '\u00a0\u2009' + country.example + '\ufeff'])
    values.push('5258486', 'RO000005258486', 'GR123456789', 'FRDE123456789', 'FRFR123456789', 'IE1+23456A', 'IE1*23456A')
    const rows = JSON.parse(sql('SELECT jsonb_agg(jsonb_build_array(value,account_creation.normalize_cif(value),account_creation.normalize_cif(account_creation.normalize_cif(value)))) FROM (VALUES ' + values.map(value => '(' + q(value) + ')').join(',') + ') inputs(value)'))
    for (const [value, canonical, repeated] of rows) {
      const expected = normalizeCif(value)
      assert.equal(expected.ok, true)
      assert.equal(canonical, expected.cif)
      assert.equal(repeated, canonical)
    }
  })
  await probe('finalizer_accepts_all_27_validated_country_formats', async () => {
    for (const country of CIF_COUNTRIES) {
      const person = await fixture()
      data(await finalize(finalArgs(person, 'client', country.example)), 'Finalize country ' + country.code)
      assert.equal(state(person).cif, country.example)
    }
  })
  await probe('finalizer_saves_profile_temporary_password_and_allows_no_control_fields', async () => {
    const person = await fixture()
    const p_profile = { full_name: 'Synthetic company', telefon: '+40000000000', nume_firma: 'Synthetic', adresa_firma: 'Test', persoana_contact: 'Test contact' }
    data(await finalize({ ...finalArgs(person), p_profile }), 'Full finalization')
    const saved = JSON.parse(sql('SELECT to_jsonb(p) FROM public.profiles p WHERE id=' + q(person.id)))
    for (const [key, value] of Object.entries(p_profile)) assert.equal(saved[key], value)
    assert.equal(saved.must_change_password, true)
    for (const bad of [null, [], 42, 'text', { is_active: true }, { creation_pending: false }, { role: 'admin' }, { full_name: 1 }, { full_name: null }, { consultant_level: null }]) {
      const pending = await fixture()
      expectError(await finalize({ ...finalArgs(pending), p_profile: bad }), 'INVALID_PROFILE_PATCH')
      assert.equal(state(pending).pending, true)
      data(await cancel(pending), 'Remove rejected profile')
    }
  })
  await probe('cif_edit_requires_admin_even_for_null_unchanged_or_wrong_type', async () => {
    const person = await client()
    for (const value of [null, '', state(person).cif, 123, false]) expectError(await patch(person, { cif: value }, person), 'CIF_FORBIDDEN')
    const senior = await fixture()
    data(await finalize({ ...finalArgs(senior, 'consultant'), p_profile: { consultant_level: 'senior' } }), 'Create senior')
    expectError(await patch(senior, { cif: null }, senior), 'CIF_FORBIDDEN')
    data(await patch(person, { full_name: 'Own permitted edit' }, person), 'Existing self-edit still works')
  })
  await probe('client_required_and_role_change_preserves_historical_cif', async () => {
    const person = await client(), original = state(person).cif
    for (const value of [null, '', ' . ']) expectError(await patch(person, { cif: value }), 'CIF_REQUIRED')
    assert.throws(() => sql('UPDATE public.profiles SET cif=NULL WHERE id=' + q(person.id)), /23514/)
    data(await patch(person, { role: 'consultant' }), 'Leave client role')
    assert.equal(state(person).cif, original)
    expectError(await patch(person, { cif: cif() }), 'CIF_FORBIDDEN')
    data(await patch(person, { role: 'client' }), 'Return using reserved CIF')
    const consultant = await fixture()
    data(await finalize(finalArgs(consultant, 'consultant')), 'Consultant without CIF')
    expectError(await patch(consultant, { role: 'client' }), 'CIF_REQUIRED')
    data(await patch(consultant, { role: 'client', cif: cif() }), 'Role and CIF saved together')
  })
  await probe('normalized_noop_has_no_false_audit_or_timestamp_change', async () => {
    const person = await client(), before = state(person)
    const timestamp = sql('SELECT updated_at FROM public.profiles WHERE id=' + q(person.id))
    const result = data(await patch(person, { cif: 'ro 000' + before.cif.slice(2) }), 'Normalized no-op')
    assert.equal(result.changed, false)
    assert.deepEqual(result.oldValues, {}); assert.deepEqual(result.newValues, {})
    assert.equal(sql('SELECT updated_at FROM public.profiles WHERE id=' + q(person.id)), timestamp)
  })
  await probe('uniqueness_covers_inactive_and_historical_other_role', async () => {
    const person = await client(), reserved = state(person).cif
    data(await active(person, false), 'Deactivate client')
    const duplicate = await fixture()
    const conflict = await finalize(finalArgs(duplicate, 'client', reserved))
    assert.equal(conflict.error?.code, '23505'); assert.match(conflict.error.message, /profiles_cif_unique/)
    data(await active(person, true), 'Reactivate retaining CIF')
    data(await patch(person, { role: 'consultant' }), 'Reserve historical CIF')
    assert.equal((await finalize(finalArgs(duplicate, 'client', reserved))).error?.code, '23505')
    data(await cancel(duplicate), 'Remove duplicate pending')
  })
  await probe('privileged_direct_writes_are_normalized_before_unique_index', async () => {
    const first = await client(), second = await client(), reserved = state(first).cif
    assert.throws(() => sql('UPDATE public.profiles SET cif=' + q('ro 000' + reserved.slice(2)) + ' WHERE id=' + q(second.id)), /23505/)
    sql("UPDATE public.profiles SET cif='fr.fr.123456789' WHERE id=" + q(second.id))
    assert.equal(state(second).cif, 'FRFR123456789')
  })
  await probe('eligible_hard_delete_releases_cif', async () => {
    const person = await client(), released = state(person).cif
    data(await rpc('delete_empty_user_account', { p_target_id: person.id, p_actor_id: actor.id }), 'Eligible final account deletion')
    const replacement = await fixture()
    data(await finalize(finalArgs(replacement, 'client', released)), 'Reuse released CIF')
  })
  await probe('create_edit_and_edit_edit_races_have_exactly_one_winner', async () => {
    const first = await client(), pending = await fixture(), wanted = cif()
    const outcomes = await Promise.all([patch(first, { cif: wanted }), finalize(finalArgs(pending, 'client', wanted))])
    assert.equal(outcomes.filter(result => !result.error).length, 1)
    assert.equal(outcomes.find(result => result.error).error.code, '23505')
    if (state(pending).pending) data(await cancel(pending), 'Remove concurrent duplicate')
    const second = await client(), next = cif()
    const edits = await Promise.all([patch(first, { cif: next }), patch(second, { cif: next })])
    assert.equal(edits.filter(result => !result.error).length, 1)
    assert.equal(edits.find(result => result.error).error.code, '23505')
  })
  await probe('same_target_concurrent_edits_return_transactional_old_values', async () => {
    const person = await client(), initial = state(person).cif, middle = cif(), final = cif()
    sql('CREATE TABLE issue110_probe.patch_results(result jsonb)')
    const result = await firstWithLock('issue110_patch_order', 'INSERT INTO issue110_probe.patch_results SELECT ' + patchSql(person, { cif: middle }), () => patch(person, { cif: final }))
    const first = JSON.parse(sql('SELECT result FROM issue110_probe.patch_results'))
    assert.deepEqual(first.oldValues, { cif: initial }); assert.deepEqual(first.newValues, { cif: middle })
    const second = data(result, 'Second ordered edit')
    assert.deepEqual(second.oldValues, { cif: middle }); assert.deepEqual(second.newValues, { cif: final })
    assert.equal(state(person).cif, final)
  })
  await probe('role_and_admin_rights_rechecked_after_waiting_for_edit_lock', async () => {
    const person = await client(), initial = state(person).cif
    const result = await firstWithLock('issue110_role_before_edit', 'SELECT ' + patchSql(person, { role: 'consultant' }), () => patch(person, { cif: cif() }))
    expectError(result, 'CIF_FORBIDDEN'); assert.equal(state(person).cif, initial)
    const author = await fixture(); data(await finalize(finalArgs(author, 'admin')), 'Second editing admin')
    const target = await client()
    const denied = await firstWithLock('issue110_actor_before_edit', "UPDATE public.profiles SET role='consultant' WHERE id=" + q(author.id), () => patch(target, { cif: cif() }, author))
    expectError(denied, 'ACTIVE_ADMIN_REQUIRED')
  })
  await probe('last_admin_guard_remains_intact', async () => {
    assert.throws(() => sql("BEGIN; UPDATE public.profiles SET role='consultant' WHERE role='admin' AND id<>" + q(actor.id) + '; SELECT ' + patchSql(actor, { role: 'consultant' }) + '; ROLLBACK;'), /LAST_ACTIVE_ADMIN/)
    assert.equal(state(actor).role, 'admin')
  })
  await probe('all_new_rpc_privileges_and_private_schema_are_restricted', async () => {
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['public.finalize_new_user_account(uuid,uuid,timestamptz,text,text,jsonb)','public.cancel_new_user_account(uuid,uuid)','public.update_user_profile_guarded(uuid,uuid,jsonb)','account_creation.normalize_cif(text)']) f WHERE has_function_privilege(r,f,'EXECUTE'))"), 'f')
    assert.equal(sql("SELECT has_schema_privilege('anon','account_creation','USAGE') OR has_schema_privilege('authenticated','account_creation','USAGE')"), 'f')
    assert.equal(sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='account_creation' AND p.prosecdef"), '0', 'Private normalizers need no elevated privileges')
    assert.equal(sql("SELECT relrowsecurity::text FROM pg_class WHERE oid='public.profiles'::regclass"), 'true')
  })
  await probe('local_sql_lint_and_advisors', async () => {
    const summary = {}
    for (const args of [
      ['db','lint','--schema','public,account_creation','--level','error','--fail-on','error'],
      advisorArgs,
    ]) {
      const items = localCli(database, args)
      const introduced = args[1] === 'advisors' ? items.filter(item => !advisorBaseline.has(advisorKey(item))) : items
      assert.equal(introduced.length, 0, 'No new findings from ' + args[1])
      summary[args[1]] = { findings: items.length, introduced: introduced.length }
    }
    return summary
  })
}
