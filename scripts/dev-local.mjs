// Run Next and the existing mail capture together, using only local services.
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'
import { assertLocalStack } from './local-account-fixtures.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
nextEnv.loadEnvConfig(root)
assertLocalStack(process.env)
const children = []
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  for (const child of children.reverse()) if (child.exitCode === null && !child.killed) {
    if (process.platform === 'win32') {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* Already exited. */ }
    } else child.kill('SIGTERM')
  }
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
const env = { ...process.env,
  RESEND_API_KEY: 're_test_local', RESEND_BASE_URL: 'http://127.0.0.1:4010',
  REMINDER_EMAIL_OVERRIDE_TO: 'local@example.invalid', NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
}
function start(args) {
  const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  children.push(child)
  child.on('error', error => { console.error(error.message); process.exitCode = 1; stop() })
  child.on('exit', code => { if (!stopping) { process.exitCode = code || 0; stop() } })
  return child
}
try {
  const mail = start(['tests/e2e/helpers/resend-mock.mjs', '4010', 'playwright-report/local-mail/resend.jsonl'])
  let ready = false
  for (let i = 0; i < 50; i++) {
    assert.ok(!stopping && mail.exitCode === null, 'Local mail capture failed to start')
    try { ready = (await fetch(env.RESEND_BASE_URL, { signal: AbortSignal.timeout(500) })).ok } catch { /* Starting. */ }
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(ready, 'Local mail capture is unavailable')
  console.log('Emailurile locale sunt capturate în playwright-report/local-mail/resend.jsonl.')
  start([path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3000'])
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
  stop()
}
