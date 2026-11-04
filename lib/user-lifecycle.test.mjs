import assert from 'node:assert/strict'
import test from 'node:test'
import { userLifecycleConflict } from '../app/api/_utils/user-lifecycle.ts'

test('maps only documented lifecycle errors with safe status and validated details', () => {
  assert.equal(userLifecycleConflict({ code: 'P0001', message: 'ACCOUNT_CREATION_PENDING' })?.status, 409)
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

test('role and senior conflicts are safe to show and require rechecking', () => {
  for (const code of ['USER_ROLE_CHANGE_BLOCKED', 'PROJECT_SENIOR_REQUIRED', 'ROLE_CONVERSION_FORBIDDEN', 'INELIGIBLE_CONSULTANT']) {
    const result = userLifecycleConflict({ code: 'P0001', message: code, details: 'private database details' })
    assert.equal(result?.status, 409)
    assert.equal(result?.body.code, code)
    assert.equal(result?.body.details, undefined)
  }
  assert.equal(userLifecycleConflict({ code: 'XX000', message: 'USER_ROLE_CHANGE_BLOCKED' }), null)
})
