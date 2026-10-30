// Rebuild only the fixed local Docker database; all local data is replaced.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { inspectCifProfiles } from '../lib/cif-preflight.ts'
import { assertLocalStack } from './local-account-fixtures.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
nextEnv.loadEnvConfig(root)
assertLocalStack(process.env)
assert.equal(process.argv.length, 2, 'This command accepts no remote target or extra arguments')
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, 'Missing local service key')

const container = 'supabase_db_platforma-fonduri'
const options = { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
const metadata = JSON.parse(execFileSync('docker', ['inspect', container], options))[0]
assert.equal(metadata.Config.Labels['com.supabase.cli.project'], 'platforma-fonduri', 'Unexpected Docker project')
assert.equal(path.resolve(metadata.Config.Labels['com.supabase.cli.workdir']).toLowerCase(), path.resolve(root).toLowerCase(), 'Docker stack belongs to another checkout')
assert.ok(metadata.NetworkSettings.Ports['5432/tcp'].some(binding => binding.HostPort === '54322'), 'Unexpected local database port')

const cli = args => execFileSync(process.execPath, [path.join(root, 'node_modules/supabase/dist/supabase.js'), ...args], { ...options, stdio: 'inherit' })
const sql = input => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
  ...options, input, stdio: ['pipe', 'pipe', 'pipe'],
}).trim()
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(file => /^\d+_.+\.sql$/.test(file)).sort()
const guarded = migrations.filter(file => file.endsWith('_issue_110_cif_account_creation.sql'))
assert.equal(guarded.length, 1, 'Expected the guarded account migration')
const position = migrations.indexOf(guarded[0])
assert.ok(position > 0, 'Account migration requires its baseline')
const version = guarded[0].split('_')[0]

console.log('Recreez baza Docker locală; datele locale existente vor fi înlocuite.')
// The guarded migration needs a validated snapshot in its own SQL session.
cli(['db', 'reset', '--local', '--version', migrations[position - 1].split('_')[0], '--no-seed', '--yes'])
const snapshot = JSON.parse(sql(`SELECT jsonb_build_object(
  'profiles', coalesce(jsonb_agg(jsonb_build_object('role',role,'cif',cif) ORDER BY id), '[]'::jsonb),
  'fingerprint', md5(coalesce(jsonb_agg(jsonb_build_array(id,role,cif) ORDER BY id), '[]'::jsonb)::text)) FROM public.profiles`))
assert.ok(inspectCifProfiles(snapshot.profiles).valid, 'CIF preflight failed')
assert.match(snapshot.fingerprint, /^[a-f0-9]{32}$/)
sql("SET app.issue110_cif_preflight = '" + snapshot.fingerprint + "';\n" + fs.readFileSync(path.join(root, 'supabase/migrations', guarded[0]), 'utf8'))
cli(['migration', 'repair', version, '--status', 'applied', '--local'])
cli(['migration', 'up', '--local'])
const profiles = JSON.parse(sql("SELECT coalesce(jsonb_agg(jsonb_build_object('role',role,'cif',cif,'creation_pending',creation_pending,'is_active',is_active)), '[]'::jsonb) FROM public.profiles"))
assert.equal(profiles.length, 0, 'Reset must leave a fresh database before the demo seed')
const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const bucket = await service.storage.getBucket('project-files')
assert.equal(bucket.error, null, 'Local project-files bucket is missing from supabase/config.toml')
assert.equal(bucket.data.public, false, 'Local project-files bucket must stay private')
console.log('Baza locală este goală, actualizată și istoricul migrărilor este înregistrat.')
console.log('Pornește npm run dev:local, apoi npm run seed:local pentru conturile și proiectele demo.')
