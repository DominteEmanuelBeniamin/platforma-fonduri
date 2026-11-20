// Umple proiectul Supabase de DEMO cu aceleași date ca ghidul video: conturi,
// șabloane, proiecte în stadii diferite, fișiere, aprobări, chat.
//
// Folosire (vezi scripts/demo/README.md): completezi `.env.demo.local`, oprești
// `npm run dev` dacă rulează, apoi
//   npm run demo:populeaza
// Pașii: migrările → bucket-ul de fișiere → aplicația pe :3005 legată de demo
// → seed-local-demo.mjs → scripts/ghid/date-ghid.mjs. Emailurile nu pleacă
// nicăieri: ajung în playwright-report/demo-mail/resend.jsonl.
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { assertDemoStack, citesteEnvDemo } from './tinta.mjs'

const rootUrl = new URL('../../', import.meta.url)
const root = fileURLToPath(rootUrl)
const demo = citesteEnvDemo(rootUrl)
assertDemoStack(demo)
const APP = 'http://127.0.0.1:3005'
const env = { ...process.env, ...demo,
  SEED_TINTA: 'demo', SEED_APP_URL: APP, GHID_APP_URL: APP, NEXT_PUBLIC_APP_URL: APP,
  RESEND_API_KEY: 're_test_demo', RESEND_BASE_URL: 'http://127.0.0.1:4011', REMINDER_EMAIL_OVERRIDE_TO: 'demo@example.invalid',
}
console.log(`Proiect demo: ${demo.NEXT_PUBLIC_SUPABASE_URL}\n`)

// ---------- 1. Migrările ----------
console.log('1/5 Migrările (supabase db push)…')
try {
  execFileSync('npx', ['supabase', 'db', 'push', '--db-url', demo.DEMO_DB_URL, '--yes'], { cwd: root, stdio: ['ignore', 'inherit', 'pipe'] })
} catch (error) {
  console.error(String(error.stderr || '').replaceAll(demo.DEMO_DB_URL, '<DEMO_DB_URL>'))
  process.exit(1)
}

// ---------- 2. Bucket-ul de fișiere (local vine din config.toml) ----------
console.log('2/5 Bucket-ul project-files…')
const service = createClient(demo.NEXT_PUBLIC_SUPABASE_URL, demo.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: bucket } = await service.storage.getBucket('project-files')
if (!bucket) {
  const { error } = await service.storage.createBucket('project-files', { public: false, fileSizeLimit: '25MB' })
  if (error) throw error
}

// ---------- 3. Aplicația, legată de demo ----------
const children = []
function stop() {
  for (const child of children.reverse()) if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
}
process.once('SIGINT', () => { stop(); process.exit(130) })
function start(args) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] })
  children.push(child)
  return child
}
async function asteapta(url, ce) {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).status < 500) return } catch { /* Pornește. */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`${ce} nu a pornit (${url})`)
}
function ruleaza(args) {
  execFileSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
}

try {
  console.log('3/5 Pornesc aplicația pe :3005…')
  start(['tests/e2e/helpers/resend-mock.mjs', '4011', 'playwright-report/demo-mail/resend.jsonl'])
  await asteapta('http://127.0.0.1:4011', 'Captura de emailuri')
  start([path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3005'])
  await asteapta(APP + '/login', 'Aplicația')

  console.log('4/5 Conturi, șabloane, proiecte (câteva minute)…')
  ruleaza(['--experimental-strip-types', 'scripts/seed-local-demo.mjs'])
  console.log('5/5 Fișiere, aprobări, chat…')
  ruleaza(['scripts/ghid/date-ghid.mjs'])
} finally {
  stop()
}
console.log(`\nGata. Proiectul demo e populat. Conturi (parola ParolaDemo123!):
  admin@test.local              — administrator
  mihai.ionescu@test.local      — consultant senior
  ana.popescu@test.local        — consultant junior
  client.agroverde@test.local   — client (Agro Verde SRL)
  client.brutaria@test.local    — client (Brutăria Moldovei SRL)
  client.technord@test.local    — client (TechNord Solutions SRL)`)
