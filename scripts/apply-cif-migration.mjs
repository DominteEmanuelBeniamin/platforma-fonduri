// Shared by the local reset and the isolated CI rebuild; never targets hosted DBs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { inspectCifProfiles } from '../lib/cif-preflight.ts'

export function applyCifMigration(sql, migrationPath) {
  const filename = path.basename(migrationPath)
  const match = filename.match(/^(\d+)_issue_110_cif_account_creation\.sql$/)
  assert.ok(match, 'Expected the guarded CIF migration')
  const migration = fs.readFileSync(migrationPath, 'utf8')
  assert.match(migration, /COMMIT;\s*$/)
  const snapshot = JSON.parse(sql(`SELECT jsonb_build_object(
    'profiles', coalesce(jsonb_agg(jsonb_build_object('role',role,'cif',cif) ORDER BY id), '[]'::jsonb),
    'fingerprint', md5(coalesce(jsonb_agg(jsonb_build_array(id,role,cif) ORDER BY id), '[]'::jsonb)::text)) FROM public.profiles`))
  const result = inspectCifProfiles(snapshot.profiles)
  assert.ok(result.valid, 'CIF preflight failed: ' + JSON.stringify(result))
  assert.match(snapshot.fingerprint, /^[a-f0-9]{32}$/)
  const literal = value => "'" + value.replaceAll("'", "''") + "'"
  // Register history inside the migration's transaction: both commit or neither does.
  const history = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES (${literal(match[1])}, 'issue_110_cif_account_creation', ARRAY[${literal(migration)}]);`
  sql(`SET app.issue110_cif_preflight = '${snapshot.fingerprint}';\n`
    + migration.replace(/COMMIT;\s*$/, () => history + '\nCOMMIT;\n'))
}
