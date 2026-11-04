import assert from 'node:assert/strict'
import test from 'node:test'
import { isRoleImpact, roleImpactRequest } from './user-role-impact.ts'

test('impact request accepts only explicit, valid operations', () => {
  assert.deepEqual(roleImpactRequest({ role: 'admin' }), { changes: { role: 'admin' } })
  for (const input of [{}, { role: 'client' }, { is_active: 'false' }, { page: 0, role: 'admin' }, { role: 'admin', extra: 1 }]) {
    assert.equal(roleImpactRequest(input), null)
  }
})

test('malformed inventory is never accepted as a zero-blocker check', () => {
  const valid = { target_id: 'u1', changes: { role: 'admin' }, checked_at: '2026-11-02T10:00:00Z', blockers: [], information: [], totals: { blockers: 0, information: 0 }, warnings: [] }
  assert.equal(isRoleImpact(valid, 'u1'), true)
  assert.equal(isRoleImpact({ ...valid, totals: { blockers: 0, information: 0 }, blockers: [{}] }, 'u1'), false)
  assert.equal(isRoleImpact({ ...valid, checked_at: 'invalid' }, 'u1'), false)
  assert.equal(isRoleImpact({ ...valid, warnings: null }, 'u1'), false)
  assert.equal(isRoleImpact(valid, 'other-user'), false)
})
