// Validates a private SQL snapshot; prints totals and the migration fingerprint only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { inspectCifProfiles } from '../lib/cif-preflight.ts'

const file = process.argv[2]
assert.ok(file, 'Usage: node --experimental-strip-types scripts/issue-110-preflight.mjs <private-snapshot.json>')
const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
assert.ok(Array.isArray(snapshot.profiles) && snapshot.profiles.every(row => row &&
  ['client', 'consultant', 'admin'].includes(row.role) && (row.cif === null || typeof row.cif === 'string')), 'Invalid snapshot shape')
assert.match(snapshot.fingerprint, /^[a-f0-9]{32}$/, 'Invalid snapshot fingerprint')
const result = inspectCifProfiles(snapshot.profiles)
console.log(JSON.stringify({ ...result, ...(result.valid ? { fingerprint: snapshot.fingerprint } : {}) }))
process.exitCode = result.valid ? 0 : 1
