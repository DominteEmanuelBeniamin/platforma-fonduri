import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

// Called only by the isolated migration validator; these fixtures die with its DB.
export async function checkRoleChangeConcurrency(container, sql) {
  assert.match(container, /^supabase_db_fonduri-ci-[a-f0-9]{12}$/)
  assert.equal(sql('SELECT count(*) FROM public.profiles'), '0')
  const [admin, admin2, junior, senior, senior2, project, phase, activity] = Array.from({ length: 8 }, randomUUID)
  const q = value => "'" + value.replaceAll("'", "''") + "'"
  sql(`INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    SELECT id, 'concurrency-'||id||'@example.invalid', '{"full_name":"Concurrency fixture"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb
    FROM unnest(ARRAY[${[admin, admin2, junior, senior, senior2].map(q).join(',')}]::uuid[]) id;
    UPDATE public.profiles SET role='admin',full_name='Concurrency admin',creation_pending=false,is_active=true
      WHERE id IN (${q(admin)},${q(admin2)});
    UPDATE public.profiles SET role='consultant',full_name='Concurrency consultant',specializare='Test',
      creation_pending=false,is_active=true,consultant_level=CASE WHEN id=${q(junior)} THEN 'junior' ELSE 'senior' END
      WHERE id IN (${q(junior)},${q(senior)},${q(senior2)});
    INSERT INTO public.projects(id,title,lifecycle_status) VALUES(${q(project)},'Concurrency fixture','active');
    INSERT INTO public.project_members(project_id,consultant_id)
      SELECT ${q(project)}::uuid,unnest(ARRAY[${q(junior)},${q(senior)},${q(senior2)}]::uuid[]);
    INSERT INTO public.project_phases(id,project_id,name,slug,order_index)
      VALUES(${q(phase)},${q(project)},'Concurrency phase','concurrency',1);
    INSERT INTO public.project_activities(id,phase_id,name,order_index,visibility)
      VALUES(${q(activity)},${q(phase)},'Concurrency draft',1,'draft');`)

  function session(query) {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    let output = '', errors = '', readyResolve, readyReject
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    // Attach immediately: a failed first session must not cause an unhandled rejection.
    ready.catch(() => {})
    child.stdout.on('data', data => { output += data; if (output.includes('ROLE_TEST_READY')) readyResolve() })
    child.stderr.on('data', data => { errors += data })
    const done = new Promise((resolve, reject) => {
      child.once('error', error => { readyReject(error); reject(error) })
      child.once('close', code => { readyReject(new Error('SQL session ended before synchronization')); resolve({ code, output, errors }) })
    })
    child.stdin.end("SET lock_timeout='8s'; SET statement_timeout='12s';\n" + query)
    return { ready, done }
  }
  async function race(first, second, expectedError) {
    const holder = session(`BEGIN; ${first};\n\\echo ROLE_TEST_READY\nSELECT pg_sleep(0.4); COMMIT;`)
    await holder.ready
    const contender = session(second)
    const [a, b] = await Promise.all([holder.done, contender.done])
    assert.equal(a.code, 0, a.errors)
    assert.notEqual(b.code, 0, 'Concurrent incompatible write must fail')
    assert.ok(b.errors.includes(expectedError), b.errors)
  }
  await race(
    `SELECT public.update_user_profile_guarded(${q(junior)},${q(admin)},'{"role":"admin"}')`,
    `UPDATE public.project_activities SET assigned_to=${q(junior)} WHERE id=${q(activity)};`,
    'INELIGIBLE_CONSULTANT',
  )
  assert.equal(sql(`SELECT assigned_to IS NULL FROM public.project_activities WHERE id=${q(activity)}`), 't')
  sql(`SELECT public.update_user_profile_guarded(${q(junior)},${q(admin)},'{"role":"consultant","consultant_level":"junior"}');`)
  await race(
    `DELETE FROM public.project_members WHERE project_id=${q(project)} AND consultant_id=${q(senior)}`,
    `DELETE FROM public.project_members WHERE project_id=${q(project)} AND consultant_id=${q(senior2)};`,
    'PROJECT_SENIOR_REQUIRED',
  )
  assert.equal(sql(`SELECT count(*) FROM public.project_members WHERE project_id=${q(project)} AND consultant_id IN (${q(senior)},${q(senior2)})`), '1')
  sql(`INSERT INTO public.project_members(project_id,consultant_id) VALUES(${q(project)},${q(senior)});`)
  await race(
    `SELECT public.update_user_profile_guarded(${q(senior)},${q(admin)},'{"consultant_level":"junior"}')`,
    `UPDATE public.profiles SET is_active=false WHERE id=${q(senior2)};`,
    'USER_ROLE_CHANGE_BLOCKED',
  )
  assert.equal(sql(`SELECT is_active FROM public.profiles WHERE id=${q(senior2)}`), 't')
  await race(
    `SELECT public.update_user_profile_guarded(${q(admin)},${q(admin2)},'{"role":"consultant","consultant_level":"junior","specializare":"Test"}')`,
    `SELECT public.update_user_profile_guarded(${q(admin2)},${q(admin2)},'{"role":"consultant","consultant_level":"junior","specializare":"Test"}');`,
    'LAST_ACTIVE_ADMIN',
  )
  assert.equal(sql("SELECT count(*) FROM public.profiles WHERE role='admin' AND is_active IS TRUE"), '1')
  console.log('Passed 4 two-session role/senior/assignment/admin concurrency checks.')
}
