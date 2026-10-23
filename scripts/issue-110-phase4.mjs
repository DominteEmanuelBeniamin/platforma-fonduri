// Run the phase 4 UI tests against a disposable copy of the current source.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const root = process.cwd(), port = Number(process.env.ISSUE110_UI_PORT || 3004)
assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535)
const temp = path.join(root, 'supabase', '.temp', 'issue110-ui-' + randomUUID())
fs.mkdirSync(temp, { recursive: true })
for (const item of ['app', 'components', 'hooks', 'lib', 'types', 'public', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs']) {
  fs.cpSync(path.join(root, item), path.join(temp, item), { recursive: true })
}
fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction')
const key = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from('{"role":"anon"}').toString('base64url'), 'local-ui-mock'].join('.')
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
  SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: key, E2E_ENV_FILE: process.env.E2E_ENV_FILE || '.env.e2e.localdb',
  E2E_BASE_URL: 'http://127.0.0.1:' + port, PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(temp, 'playwright.json') }
delete env.SUPABASE_SERVICE_ROLE_KEY
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', temp, '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: temp, env, windowsHide: true, stdio: ['ignore','pipe','pipe'] })
let log = '', finished = false, exitCode = 1, cleanupPassed = false, cases = []
server.stdout.on('data', chunk => { log = (log + chunk).slice(-5000) })
server.stderr.on('data', chunk => { log = (log + chunk).slice(-5000); process.stderr.write(chunk) })
const stopped = new Promise(resolve => server.once('exit', () => { finished = true; resolve() }))
try {
  let ready = false
  for (let i = 0; i < 90; i++) {
    if (finished) throw new Error('Isolated Next server exited: ' + log.slice(-1500))
    let response
    try { response = await fetch(env.E2E_BASE_URL + '/login', { signal: AbortSignal.timeout(15000) }) } catch { /* Wait for compilation. */ }
    if (response?.status >= 500) throw new Error('Isolated Next compilation failed: ' + log.slice(-3500))
    ready = response?.ok ?? false
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(ready, 'Isolated Next server ready: ' + log.slice(-1500))
  console.log('Phase 4: isolated Next source copy ready; Auth/API/Realtime are mocked')
  const run = spawn(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.ui.config.ts', 'tests/ui/cif-input.spec.ts', '--project', 'desktop', '--project', 'telefon', '--reporter=list,json', ...process.argv.slice(2)], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  exitCode = await new Promise(resolve => run.once('exit', code => resolve(code ?? 1)))
  const report = JSON.parse(fs.readFileSync(env.PLAYWRIGHT_JSON_OUTPUT_NAME, 'utf8'))
  const collect = suites => {
    for (const suite of suites) {
      for (const spec of suite.specs || []) for (const test of spec.tests) cases.push({ name: spec.title, project: test.projectName, passed: test.status === 'expected' })
      collect(suite.suites || [])
    }
  }
  collect(report.suites)
} catch (error) {
  console.error(error.message)
} finally {
  if (!finished) {
    if (process.platform === 'win32') {
      const kill = spawn('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      await new Promise(resolve => kill.once('exit', resolve))
    } else server.kill('SIGTERM')
  }
  await stopped
  assert.equal(path.dirname(temp), path.join(root, 'supabase', '.temp'))
  assert.match(path.basename(temp), /^issue110-ui-[a-f0-9-]{36}$/)
  assert.equal(fs.realpathSync(temp), temp)
  // Remove the junction itself before recursively deleting our temporary copy.
  const modules = path.join(temp, 'node_modules')
  assert.ok(fs.lstatSync(modules).isSymbolicLink())
  fs.unlinkSync(modules)
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  cleanupPassed = !fs.existsSync(temp)
  fs.writeFileSync('docs/issue-110-phase4-results.json', JSON.stringify({ date: new Date().toISOString(), isolated: true, hostedWrites: false, databaseWrites: false, realEmailDelivery: false, cleanupPassed, cases }, null, 2) + '\n')
  console.log(cases.filter(result => result.passed).length + '/' + cases.length + ' phase4 checks passed; cleanup=' + cleanupPassed)
  process.exitCode = exitCode || (cleanupPassed ? 0 : 1)
}
