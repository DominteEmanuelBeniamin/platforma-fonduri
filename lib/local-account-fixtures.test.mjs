import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixtureCif, finalizeLocalFixture } from '../scripts/local-account-fixtures.mjs'
import { validateCif } from './cif.ts'

test('fixture CUIs are stable, valid and distinct across synthetic identities', () => {
  const values = Array.from({ length: 1000 }, (_, i) => fixtureCif('local-fixture-' + i))
  assert.equal(new Set(values).size, values.length)
  for (const value of values) assert.equal(validateCif(value).ok, true)
  assert.equal(fixtureCif('local-fixture-1'), values[1])
})

test('fixture bootstrap rejects hosted clients before any write', async () => {
  await assert.rejects(finalizeLocalFixture({ supabaseUrl: 'https://example.supabase.co' }, 'id', { role: 'admin' }), /local Supabase/)
})

test('fixture bootstrap saves role, valid CIF and activation in one mutation', async () => {
  let saved
  const service = { supabaseUrl: 'http://127.0.0.1:54321', from: () => ({ update: profile => {
    saved = profile
    return { eq: () => ({ select: () => ({ single: async () => ({ error: null, data: { id: 'fixture', ...profile } }) }) }) }
  } }) }
  await finalizeLocalFixture(service, 'fixture', { role: 'client', full_name: 'Fixture' })
  assert.equal(saved.role, 'client')
  assert.equal(validateCif(saved.cif).ok, true)
  assert.equal(saved.creation_pending, false)
  assert.equal(saved.is_active, true)
  await finalizeLocalFixture(service, 'fixture', { role: 'consultant' })
  assert.equal('cif' in saved, false)
})
