import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'

// Uses the phase 0 disposable DB/Auth/REST harness; source and hosted stay untouched.
export async function checkPhase5(ctx) {
  const { sql, probe, service, baseUrl, env, database, root, temp, docker, inspect, envMap, startContainer, network, authPort, extraServices } = ctx
  const children = []
  const logs = path.join(root, 'playwright-report', 'issue110-phase5')
  fs.mkdirSync(logs, { recursive: true })
  const app = path.join(temp, 'app-copy')
  const recoveryApp = path.join(temp, 'recovery-copy')
  const appPort = Number(process.env.ISSUE110_APP_PORT || 3005)
  assert.ok(Number.isInteger(appPort) && appPort > 1024 && appPort < 65535)
  const base = 'http://127.0.0.1:' + appPort
  const recoveryBase = 'http://127.0.0.1:' + (appPort + 1)
  const runEnv = { ...process.env, ...env, E2E_ENV_FILE: path.join(temp, '.env.e2e'), E2E_DB_NAME: database,
    E2E_BASE_URL: base, E2E_SUPABASE_URL: baseUrl, E2E_ADMIN_EMAIL: 'admin@test.local', E2E_ADMIN_PASSWORD: 'Parola123!',
    E2E_RECOVERY_BASE_URL: recoveryBase,
    E2E_STAFF_EMAIL: 'admin@test.local', E2E_STAFF_PASSWORD: 'Parola123!',
    E2E_CLIENT_EMAIL: 'client.agroverde@test.local', E2E_CLIENT_PASSWORD: 'Parola123!',
    E2E_CLIENT2_EMAIL: 'client.brutaria@test.local', E2E_CLIENT2_PASSWORD: 'Parola123!',
    NEXT_PUBLIC_SUPABASE_URL: baseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: env.E2E_SUPABASE_ANON_KEY,
    SUPABASE_URL: baseUrl, SUPABASE_ANON_KEY: env.E2E_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: env.E2E_SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_URL: base, RESEND_API_KEY: 're_test_local', RESEND_BASE_URL: 'http://127.0.0.1:' + (authPort + 4),
    REMINDER_EMAIL_OVERRIDE_TO: 'local@example.invalid', VERCEL_ENV: 'development',
    E2E_RESEND_LOG: path.join(temp, 'resend.jsonl'), SEED_APP_URL: base,
    LOCAL_SUPABASE_URL: baseUrl, LOCAL_SUPABASE_SERVICE_ROLE_KEY: env.E2E_SUPABASE_SERVICE_ROLE_KEY,
  }
  // Do not inherit hosted recovery secrets or delivery settings into the isolated app.
  for (const key of Object.keys(runEnv)) if (/^RECOVERY_|^RESEND_.*FROM/.test(key)) delete runEnv[key]
  runEnv.RECOVERY_SECRET = randomBytes(32).toString('base64')
  runEnv.CRON_SECRET = runEnv.E2E_CRON_SECRET = randomUUID()
  fs.writeFileSync(runEnv.E2E_ENV_FILE, Object.entries(runEnv).filter(([key]) => key.startsWith('E2E_')).map(([key, value]) => key + '=' + value).join('\n'))
  function child(args, cwd = root, overrides = {}) {
    const process = spawn(globalThis.process.execPath, args, { cwd, env: { ...runEnv, ...overrides }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const record = { process, output: '', exited: false, code: null, log: path.join(logs, 'process-' + children.length + '.log') }
    children.push(record)
    fs.writeFileSync(record.log, '')
    const output = chunk => { record.output = (record.output + chunk).slice(-15000); fs.appendFileSync(record.log, chunk) }
    process.stdout.on('data', output)
    process.stderr.on('data', output)
    record.done = new Promise((resolve, reject) => {
      process.on('error', reject)
      process.on('exit', code => { record.exited = true; record.code = code; resolve(code) })
    })
    return record
  }
  async function ready(url, process) {
    for (let i = 0; i < 120; i++) {
      assert.ok(!process?.exited, 'Isolated process exited: ' + process?.output.slice(-1200))
      try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* compiling */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('Isolated service not ready: ' + url)
  }
  try {
    for (const table of ['storage.migrations', '_realtime.schema_migrations', 'realtime.schema_migrations', 'storage.buckets']) {
      sql(docker(['exec', 'supabase_db_platforma-fonduri', 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only', '--table=' + table]), database, 'supabase_admin')
    }
    const storage = inspect('supabase_storage_platforma-fonduri'), storageEnv = envMap(storage)
    for (const key of ['DATABASE_URL', 'VECTOR_DATABASE_URL']) if (storageEnv[key]) {
      const url = new URL(storageEnv[key]); assert.equal(url.hostname, 'supabase_db_platforma-fonduri'); url.pathname = '/' + database; storageEnv[key] = url.href
    }
    storageEnv.FILE_STORAGE_BACKEND_PATH = '/tmp/issue110-storage'
    startContainer('issue110_phase5_storage_' + database.slice(-12), storage.Config.Image, storageEnv, authPort + 2, 5000, network)
    extraServices.storage = authPort + 2
    const realtime = inspect('supabase_realtime_platforma-fonduri'), realtimeEnv = envMap(realtime)
    Object.assign(realtimeEnv, { DB_NAME: database, SLOT_NAME_SUFFIX: database.slice(-12), ERL_AFLAGS: '-proto_dist inet_tcp +S 2' })
    startContainer('issue110_phase5_realtime_' + database.slice(-12), realtime.Config.Image, realtimeEnv, authPort + 3, 4000, network)
    extraServices.realtime = authPort + 3
    await ready('http://127.0.0.1:' + (authPort + 2) + '/status')
    const mail = child(['tests/e2e/helpers/resend-mock.mjs', String(authPort + 4), runEnv.E2E_RESEND_LOG])
    await ready(runEnv.RESEND_BASE_URL, mail)
    for (const copy of [app, recoveryApp]) {
      for (const item of ['app', 'components', 'hooks', 'lib', 'types', 'public', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs']) {
        fs.cpSync(path.join(root, item), path.join(copy, item), { recursive: true })
      }
      fs.symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'junction')
    }
    // Let the isolated bundle resolve the workspace's shared node_modules junction.
    const configFile = path.join(app, 'next.config.ts'), configSource = fs.readFileSync(configFile, 'utf8')
    assert.ok(configSource.includes('const nextConfig: NextConfig = {'))
    fs.writeFileSync(configFile, configSource.replace('const nextConfig: NextConfig = {',
      'const nextConfig: NextConfig = {\n  turbopack: { root: ' + JSON.stringify(root) + ' },\n  outputFileTracingRoot: ' + JSON.stringify(root) + ','))
    const build = child([path.join(root, 'node_modules/next/dist/bin/next'), 'build', app], app)
    await probe('phase5_isolated_production_build', async () => {
      assert.equal(await build.done, 0, 'Isolated production build failed: ' + build.output.slice(-2000))
    })
    assert.equal(build.code, 0, 'Dependent suites require a successful build')
    const server = child([path.join(root, 'node_modules/next/dist/bin/next'), 'start', app, '--hostname', '127.0.0.1', '--port', String(appPort)], app)
    await ready(base + '/login', server)
    // Recovery intentionally forbids HTTP and mock providers in production.
    const recovery = child([path.join(root, 'node_modules/next/dist/bin/next'), 'dev', recoveryApp, '--webpack', '--hostname', '127.0.0.1', '--port', String(appPort + 1)], recoveryApp, { NEXT_PUBLIC_APP_URL: recoveryBase })
    await ready(recoveryBase + '/login', recovery)
    await probe('phase5_demo_seed_and_reuse_complete_local_profiles_before_login', async () => {
      const seed = child(['scripts/seed-local-demo.mjs'])
      assert.equal(await seed.done, 0, seed.output.slice(-2500))
      const profiles = await service.from('profiles').select('role,cif,creation_pending,is_active').like('email', '%@test.local')
      assert.equal(profiles.error, null)
      assert.equal(profiles.data.length, 6)
      assert.ok(profiles.data.every(row => !row.creation_pending && row.is_active))
      const { inspectCifProfiles } = await import('../lib/cif-preflight.ts')
      assert.equal(inspectCifProfiles(profiles.data).valid, true)
      const seedAgain = child(['scripts/seed-local-demo.mjs'])
      assert.equal(await seedAgain.done, 0, seedAgain.output.slice(-2500))
    })
    if (process.exitCode) throw new Error('Phase 5 seed failed; dependent suites were not run')
    await probe('phase5_bootstrap_internal_roles_without_cif', async () => {
      const bootstrap = child(['scripts/create-local-admin.mjs', 'phase5.internal@example.invalid', 'Fixture-123456!', 'Bootstrap probe'])
      assert.equal(await bootstrap.done, 0, 'create-local-admin failed')
      const { data: profile, error } = await service.from('profiles').select('id,role,cif,creation_pending,is_active').eq('email', 'phase5.internal@example.invalid').single()
      assert.equal(error, null); assert.equal(profile.role, 'admin'); assert.equal(profile.cif, null)
      assert.equal(profile.creation_pending, false); assert.equal(profile.is_active, true)
      assert.equal((await service.auth.admin.deleteUser(profile.id)).error, null)
    })
    const suites = process.env.ISSUE110_SUITES?.split(',') || [
      'recovery-fixtures', 'conturi-ui', 'cif-creation', 'conturi-lifecycle', 'incheiere-finalizare',
      'drepturi', 'drepturi-interfata', 'matricea-acces', 'regresii-senior', 'verificare-modificari',
    ]
    const cases = []
    for (const suite of suites) {
      assert.match(suite, /^[a-z-]+$/)
      await probe('phase5_playwright_' + suite, async () => {
        console.log('RUN phase5 ' + suite)
        runEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = path.join(temp, suite + '.json')
        const test = child([path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', 'tests/e2e/' + suite + '.spec.ts', '--reporter=list,json'])
        const code = await test.done
        if (fs.existsSync(runEnv.PLAYWRIGHT_JSON_OUTPUT_NAME)) {
          fs.copyFileSync(runEnv.PLAYWRIGHT_JSON_OUTPUT_NAME, path.join(logs, suite + '.json'))
          const report = JSON.parse(fs.readFileSync(runEnv.PLAYWRIGHT_JSON_OUTPUT_NAME, 'utf8'))
          const collect = suites => { for (const group of suites) {
            for (const spec of group.specs || []) for (const result of spec.tests) cases.push({ suite, name: spec.title, status: result.status })
            collect(group.suites || [])
          } }
          collect(report.suites)
        }
        // Full logs stay local: Playwright failures may contain fixture credentials.
        fs.copyFileSync(test.log, path.join(logs, suite + '.log'))
        assert.equal(code, 0, 'Suite failed; inspect playwright-report/issue110-phase5/' + suite + '.log')
      })
    }
    fs.writeFileSync('docs/issue-110-phase5-playwright-results.json', JSON.stringify({ date: new Date().toISOString(), isolated: true, realEmailDelivery: false, cases }, null, 2) + '\n')
    if (process.argv.includes('--manual') && !process.exitCode && ctx.onManualReady) {
      ctx.onManualReady()
      console.log('MANUAL_READY ' + base + ' — admin@test.local / Parola123!; Ctrl+C closes the isolated environment')
      console.log('MANUAL_EMAIL_LOG ' + runEnv.E2E_RESEND_LOG)
      await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
    }
  } finally {
    for (const record of children.reverse()) if (!record.exited) {
      if (process.platform === 'win32') {
        const kill = spawn('taskkill.exe', ['/PID', String(record.process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        await new Promise(resolve => kill.once('exit', resolve))
      } else record.process.kill('SIGTERM')
      await record.done
    }
    for (const copy of [app, recoveryApp]) {
      assert.equal(path.dirname(copy), temp)
      const modules = path.join(copy, 'node_modules')
      if (fs.existsSync(modules)) { assert.ok(fs.lstatSync(modules).isSymbolicLink()); fs.unlinkSync(modules) }
      fs.rmSync(copy, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }
}
