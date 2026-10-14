import assert from 'node:assert/strict'
import test from 'node:test'
import { inactiveReferenceConflict } from '../app/api/_utils/inactive-reference.ts'

test('maps only the dedicated inactive-reference database marker with valid details', () => {
  const mapped = inactiveReferenceConflict({
    code: 'P0001',
    message: 'INACTIVE_REFERENCE',
    details: JSON.stringify({ user_id: 'u-1', field: 'client_id', extra: 'ignored' }),
  }, 'A disabled account cannot be used.')

  assert.deepEqual(mapped, {
    status: 409,
    body: {
      code: 'INACTIVE_REFERENCE',
      message: 'A disabled account cannot be used.',
      details: { user_id: 'u-1', field: 'client_id' },
    },
  })
})

test('does not map ordinary P0001 errors or malformed trigger details', () => {
  assert.equal(inactiveReferenceConflict({
    code: 'P0001',
    message: 'OTHER_ERROR',
    details: '{}',
  }, 'safe'), null)
  assert.equal(inactiveReferenceConflict({
    code: 'P0001',
    message: 'INACTIVE_REFERENCE',
    details: 'not-json',
  }, 'safe'), null)
  assert.equal(inactiveReferenceConflict({
    code: 'P0001',
    message: 'INACTIVE_REFERENCE',
    details: JSON.stringify({ user_id: 'u-1' }),
  }, 'safe'), null)
})
