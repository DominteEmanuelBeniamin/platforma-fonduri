import assert from 'node:assert/strict'
import test from 'node:test'
import { userLifecycleConflict } from '../app/api/_utils/user-lifecycle.ts'

test('maps only documented lifecycle errors with safe status and validated details', () => {
  assert.deepEqual(userLifecycleConflict({
    code: 'P0001',
    message: 'SELF_ACCOUNT_ACTION',
    details: '',
  }), {
    status: 409,
    body: { code: 'SELF_ACCOUNT_ACTION', message: 'Nu poți acționa asupra propriului cont.' },
  })
  assert.deepEqual(userLifecycleConflict({
    code: 'P0001',
    message: 'LAST_ACTIVE_ADMIN',
    details: '',
  })?.status, 409)
  assert.deepEqual(userLifecycleConflict({
    code: 'P0001',
    message: 'ACTIVE_ADMIN_REQUIRED',
    details: '',
  })?.status, 403)
  assert.deepEqual(userLifecycleConflict({
    code: 'P0001',
    message: 'USER_NOT_FOUND',
    details: '',
  })?.status, 404)
  assert.deepEqual(userLifecycleConflict({
    code: 'P0001',
    message: 'USER_HAS_RELATED_DATA',
    details: JSON.stringify({ blockers: [{ kind: 'projects', count: 2 }] }),
  }), {
    status: 409,
    body: {
      code: 'USER_HAS_RELATED_DATA',
      message: 'Contul are date asociate și nu poate fi șters.',
      details: { blockers: [{ kind: 'projects', count: 2 }] },
    },
  })
  assert.equal(userLifecycleConflict({ code: 'P0001', message: 'OTHER', details: 'secret SQL' }), null)
  assert.equal(userLifecycleConflict({
    code: 'P0001',
    message: 'USER_HAS_RELATED_DATA',
    details: JSON.stringify({ blockers: [{ kind: 'projects', count: '2' }] }),
  })?.body.details, undefined)
})
