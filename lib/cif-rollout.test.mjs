import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('rollout preflight returns only totals and binds a fingerprint only to valid snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue110-preflight-'))
  const file = path.join(dir, 'snapshot.json'), fingerprint = 'a'.repeat(32)
  const run = profiles => {
    fs.writeFileSync(file, JSON.stringify({ profiles, fingerprint }))
    return spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/issue-110-preflight.mjs', file], { encoding: 'utf8', windowsHide: true })
  }
  try {
    const valid = run([{ role: 'client', cif: 'RO5258486' }, { role: 'admin', cif: null }])
    assert.equal(valid.status, 0)
    assert.deepEqual(JSON.parse(valid.stdout), { valid: true, missing: 0, invalid: 0, nonCanonical: 0, duplicates: 0, fingerprint })
    const invalid = run([{ role: 'client', cif: 'RO12345678' }, { role: 'client', cif: null }])
    assert.equal(invalid.status, 1)
    assert.deepEqual(JSON.parse(invalid.stdout), { valid: false, missing: 1, invalid: 1, nonCanonical: 0, duplicates: 0 })
    assert.equal(invalid.stdout.includes('RO12345678'), false)
    assert.notEqual(run([{ role: 'client', cif: 42 }]).status, 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
import { applyCifMigration } from '../scripts/apply-cif-migration.mjs'

const guardedMigration = 'supabase/migrations/20261029130000_issue_110_cif_account_creation.sql'

test('CIF application refuses invalid data before DDL and never exposes identifiers', () => {
  let calls = 0
  assert.throws(() => applyCifMigration(() => {
    calls++
    return JSON.stringify({ profiles: [{ role: 'client', cif: 'RO12345678' }], fingerprint: 'a'.repeat(32) })
  }, guardedMigration), error => error.message.includes('CIF preflight failed') && !error.message.includes('RO12345678'))
  assert.equal(calls, 1)
})

test('CIF application binds the fingerprint and commits its history with the DDL', () => {
  const calls = []
  applyCifMigration(input => {
    calls.push(input)
    return JSON.stringify({ profiles: [{ role: 'client', cif: 'RO5258486' }], fingerprint: 'b'.repeat(32) })
  }, guardedMigration)
  assert.equal(calls.length, 2)
  assert.ok(calls[1].startsWith("SET app.issue110_cif_preflight = '" + 'b'.repeat(32) + "';"))
  assert.match(calls[1], /INSERT INTO supabase_migrations\.schema_migrations\(version,name,statements\)/)
  assert.ok(calls[1].includes("IF v_value !~ ''^[A-Za-z0-9+*]+$'' THEN"), 'SQL regex dollars must remain literal in migration history')
  assert.ok(calls[1].trimEnd().endsWith('COMMIT;'))
})

test('CIF application refuses a malformed fingerprint without executing the migration', () => {
  let calls = 0
  assert.throws(() => applyCifMigration(() => {
    calls++
    return JSON.stringify({ profiles: [], fingerprint: "'; SELECT 1; --" })
  }, guardedMigration))
  assert.equal(calls, 1)
})
