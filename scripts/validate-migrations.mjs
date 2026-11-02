// Rebuild migrations in a separate Supabase project, port and temporary workdir.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyCifMigration } from './apply-cif-migration.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
assert.equal(process.argv.length, 2, 'No database target arguments are accepted')
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonduri-migrations-'))
const project = 'fonduri-ci-' + randomUUID().replaceAll('-', '').slice(0, 12)
const container = 'supabase_db_' + project
const options = { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
const cli = args => execFileSync(process.execPath, [path.join(root, 'node_modules/supabase/dist/supabase.js'), '--workdir', workdir, ...args], { ...options, stdio: 'inherit' })
const sql = input => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { ...options, input, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const port = await new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})
const source = path.join(root, 'supabase/migrations')
const files = fs.readdirSync(source).filter(file => /^\d+_.+\.sql$/.test(file)).sort()
const guarded = files.filter(file => file.endsWith('_issue_110_cif_account_creation.sql'))
assert.equal(guarded.length, 1)
const position = files.indexOf(guarded[0])
assert.ok(position > 0)
const destination = path.join(workdir, 'supabase/migrations')
fs.mkdirSync(destination, { recursive: true })
// Only the DB starts. No API, email, production connection or local .env is needed.
fs.writeFileSync(path.join(workdir, 'supabase/config.toml'), `project_id = "${project}"
[db]
port = ${port}
major_version = 17
[db.seed]
enabled = false
`)
try {
  for (const file of files.slice(0, position)) fs.copyFileSync(path.join(source, file), path.join(destination, file))
  cli(['db', 'start'])
  const metadata = JSON.parse(execFileSync('docker', ['inspect', container], options))[0]
  assert.equal(metadata.Config.Labels['com.supabase.cli.project'], project)
  assert.equal(path.resolve(metadata.Config.Labels['com.supabase.cli.workdir']).toLowerCase(), path.resolve(workdir).toLowerCase())
  const productionGate = fs.readFileSync(path.join(root, 'scripts/production-migrations-preflight.sql'), 'utf8')
  assert.throws(() => sql(productionGate), /CIF_ROLLOUT_REQUIRED/, 'Deploy must refuse a missing CIF rollout')
  applyCifMigration(sql, path.join(source, guarded[0]))
  for (const file of files.slice(position)) fs.copyFileSync(path.join(source, file), path.join(destination, file))
  cli(['migration', 'up', '--local'])
  const versions = sql('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version').split('\n')
  assert.deepEqual(versions, files.map(file => file.split('_')[0]))
  // The same read-only gate runs before production deployment.
  sql(productionGate)
  assert.throws(() => sql('BEGIN; DROP INDEX public.profiles_cif_unique;\n' + productionGate), /CIF_SCHEMA_INCOMPLETE/, 'Deploy must refuse an incomplete schema')
  sql(productionGate) // The failed transaction must have restored the index.
  assert.equal(sql('SELECT count(*) FROM public.profiles'), '0', 'CI must not import private seeds')
  console.log(`Validated ${versions.length} migrations on an isolated database; production preflight passed.`)
} finally {
  // The generated project ID prevents touching any existing local Docker stack.
  cli(['stop', '--project-id', project, '--no-backup'])
  assert.equal(path.dirname(path.resolve(workdir)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(workdir).startsWith('fonduri-migrations-'))
  fs.rmSync(workdir, { recursive: true, force: true })
}
