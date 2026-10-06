import assert from 'node:assert/strict'
import test from 'node:test'
import { profileDisplayName } from './profile-display.ts'

test('marks a disabled profile without changing the saved name', () => {
  assert.equal(profileDisplayName({ full_name: 'Ana Popescu', is_active: false }), 'Ana Popescu (cont dezactivat)')
})

test('keeps active, unknown and custom labels unchanged', () => {
  assert.equal(profileDisplayName({ full_name: 'Ana Popescu', is_active: true }), 'Ana Popescu')
  assert.equal(profileDisplayName({ email: 'ana@example.com', is_active: null }), 'ana@example.com')
  assert.equal(profileDisplayName({ full_name: 'Ana', is_active: false }, 'Agro Verde'), 'Agro Verde (cont dezactivat)')
})
