import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectCifProfiles } from './cif-preflight.ts'

test('preflight acceptă clienți canonici și roluri fără CIF', () => {
  assert.deepEqual(inspectCifProfiles([
    { role: 'client', cif: 'RO5258486' }, { role: 'client', cif: 'FRFR123456789' },
    { role: 'admin', cif: null }, { role: 'consultant', cif: null },
  ]), { valid: true, missing: 0, invalid: 0, nonCanonical: 0, duplicates: 0 })
})

test('preflight refuză lipsuri, checksum greșit și formate invalide la toate rolurile', () => {
  assert.deepEqual(inspectCifProfiles([
    { role: 'client', cif: null }, { role: 'client', cif: ' ' },
    { role: 'client', cif: 'RO12345678' }, { role: 'admin', cif: 'DE123' },
    { role: 'consultant', cif: '' },
  ]), { valid: false, missing: 2, invalid: 3, nonCanonical: 0, duplicates: 0 })
})

test('preflight numără aliasurile și coliziunile fără să corecteze datele', () => {
  const profiles = [
    { role: 'client', cif: '5258486' }, { role: 'consultant', cif: 'ro 0005.258.486' },
    { role: 'admin', cif: 'RO5258486' }, { role: 'client', cif: 'GR123456789' },
    { role: 'consultant', cif: 'EL123456789' },
  ]
  const original = structuredClone(profiles)
  assert.deepEqual(inspectCifProfiles(profiles), { valid: false, missing: 0, invalid: 0, nonCanonical: 3, duplicates: 3 })
  assert.deepEqual(profiles, original)
})
