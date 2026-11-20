// Ținta demo: un proiect Supabase separat, numai pentru prezentări. Seed-ul
// local (`seed-local-demo.mjs`, `scripts/ghid/date-ghid.mjs`) rulează pe el
// când primește SEED_TINTA=demo de la `populeaza.mjs`. Producția e refuzată.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

export const REF_PRODUCTIE = 'kqjpnyxuynnpohrsbhfm'
export const FISIER_ENV = '.env.demo.local'

export const eDemo = env => env.SEED_TINTA === 'demo'

/** Citește `.env.demo.local` și pune parola (codificată) în connection string. */
export function citesteEnvDemo(root) {
  const cale = new URL(FISIER_ENV, root)
  assert.ok(fs.existsSync(cale), `Lipsește ${FISIER_ENV} în folderul proiectului (vezi scripts/demo/README.md).`)
  const env = {}
  for (const linie of fs.readFileSync(cale, 'utf8').split(/\r?\n/)) {
    const m = linie.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  for (const cheie of ['DEMO_PROJECT_REF', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DEMO_DB_URL', 'DEMO_DB_PASSWORD']) {
    assert.ok(env[cheie], `Lipsește ${cheie} în ${FISIER_ENV}`)
  }
  assert.ok(env.DEMO_DB_URL.includes('[YOUR-PASSWORD]'), 'În DEMO_DB_URL lasă textul [YOUR-PASSWORD] așa cum e; parola merge în DEMO_DB_PASSWORD.')
  env.DEMO_DB_URL = env.DEMO_DB_URL.replace('[YOUR-PASSWORD]', encodeURIComponent(env.DEMO_DB_PASSWORD))
  delete env.DEMO_DB_PASSWORD
  env.SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
  return env
}

/** Doar proiectul demo numit în DEMO_PROJECT_REF, niciodată producția. */
export function assertDemoStack(env) {
  assert.notEqual(env.NODE_ENV, 'production', 'Seed-ul demo refuză NODE_ENV=production')
  const ref = env.DEMO_PROJECT_REF
  assert.ok(/^[a-z]{20}$/.test(ref || ''), 'DEMO_PROJECT_REF trebuie să fie ID-ul proiectului (20 de litere mici)')
  assert.notEqual(ref, REF_PRODUCTIE, 'DEMO_PROJECT_REF este proiectul de PRODUCȚIE. Oprit.')
  for (const cheie of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    assert.equal(env[cheie], `https://${ref}.supabase.co`, `${cheie} trebuie să fie https://${ref}.supabase.co`)
  }
  assert.ok(env.DEMO_DB_URL?.includes(ref), 'DEMO_DB_URL nu e al proiectului demo')
  assert.ok(!env.DEMO_DB_URL.includes(REF_PRODUCTIE), 'DEMO_DB_URL este baza de PRODUCȚIE. Oprit.')
}

/** Ca `psql -qAt`: un rând pe linie, coloanele unite prin `sep`, null → gol. */
export function sqlDemo(env, query, sep = '|') {
  let out
  try {
    // CSV, nu JSON: în JSON coloanele cu același nume (a.status, f.status) se suprascriu.
    out = execFileSync('npx', ['supabase', 'db', 'query', '--db-url', env.DEMO_DB_URL, '-o', 'csv', query],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    // Mesajul implicit conține comanda, deci și parola din DEMO_DB_URL.
    const detalii = `${error.stdout || ''}\n${error.stderr || ''}`.replaceAll(env.DEMO_DB_URL, '<DEMO_DB_URL>').trim()
    throw new Error(`SQL eșuat: ${query.slice(0, 200)}\n${detalii}`)
  }
  // Primul rând e antetul; la UPDATE/DELETE fără RETURNING e doar „UPDATE n”.
  return parseCsv(out).slice(1)
    .map(rand => rand.map(v => v === 'NULL' ? '' : v).join(sep))
    .join('\n').trim()
}

function parseCsv(text) {
  const randuri = []
  let rand = [], camp = '', ghilimele = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (ghilimele) {
      if (c === '"' && text[i + 1] === '"') { camp += '"'; i++ }
      else if (c === '"') ghilimele = false
      else camp += c
    } else if (c === '"') ghilimele = true
    else if (c === ',') { rand.push(camp); camp = '' }
    else if (c === '\n') { rand.push(camp); randuri.push(rand); rand = []; camp = '' }
    else if (c !== '\r') camp += c
  }
  if (camp || rand.length) { rand.push(camp); randuri.push(rand) }
  return randuri
}

/** Varianta demo a `finalizeLocalFixture`: același UPDATE, aceleași verificări. */
export async function finalizeDemoFixture(service, id, profile) {
  assert.ok(['admin', 'consultant', 'client'].includes(profile.role), 'Explicit fixture role required')
  const result = await service.from('profiles').update({
    ...profile, creation_pending: false, is_active: true,
  }).eq('id', id).select('id,role,cif,creation_pending,is_active').single()
  assert.equal(result.error, null, 'Demo fixture profile: ' + (result.error?.message || ''))
  assert.equal(result.data.creation_pending, false)
  assert.equal(result.data.is_active, true)
  return result.data
}
