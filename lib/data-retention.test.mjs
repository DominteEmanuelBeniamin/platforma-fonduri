import assert from 'node:assert/strict'
import test from 'node:test'

import {
  firstClaimedUploadBatch,
  computePurgeDate,
  isRetentionDue,
  isRetentionEligible,
  isRetentionPolicyEnabled,
} from './data-retention.ts'

const now = new Date('2026-09-11T10:00:00.000Z')
const policy = { enabled: true, retention_hours: 24 }

test('retention policy duration is opt-in and positive', () => {
  assert.equal(isRetentionPolicyEnabled({ enabled: false, retention_hours: 24 }), false)
  assert.equal(isRetentionPolicyEnabled({ enabled: true, retention_hours: null }), false)
  assert.equal(isRetentionPolicyEnabled({ enabled: true, retention_hours: 0 }), false)
  assert.equal(isRetentionPolicyEnabled(policy), true)
})

test('missing deadlines and legal holds fail closed', () => {
  assert.equal(isRetentionEligible({ policy, retentionUntil: null, now }), false)
  assert.equal(isRetentionEligible({ policy, retentionUntil: '2026-09-11T09:00:00.000Z', legalHoldAt: now, now }), false)
  assert.equal(isRetentionEligible({ policy: { ...policy, enabled: false }, retentionUntil: now, now }), false)
})

test('a due timestamp is eligible', () => {
  assert.equal(isRetentionDue('2026-09-11T10:00:00.000Z', now), true)
  assert.equal(isRetentionEligible({ policy, retentionUntil: '2026-09-11T09:59:59.000Z', now }), true)
  assert.equal(isRetentionEligible({ policy, retentionUntil: '2026-09-11T10:00:01.000Z', now }), false)
})

test('only a returned incomplete row is claimed for orphan cleanup', () => {
  const batch = { id: 'batch-1', requirement_id: 'request-1', uploaded_by: 'user-1', expected_files: [], created_at: now.toISOString() }
  assert.equal(firstClaimedUploadBatch(null), null)
  assert.equal(firstClaimedUploadBatch([]), null)
  assert.deepEqual(firstClaimedUploadBatch([batch]), batch)
})

test('purge date is the maximum of grace and business retention dates', () => {
  assert.equal(
    computePurgeDate({
      deletedAt: '2026-09-11T10:00:00.000Z',
      graceRetentionHours: 24,
      retentionUntilDates: ['2026-09-13T10:00:00.000Z'],
      requireBusinessRetention: true,
    }),
    '2026-09-13T10:00:00.000Z',
  )
  assert.equal(
    computePurgeDate({
      deletedAt: '2026-09-11T10:00:00.000Z',
      graceRetentionHours: 24,
      businessRetentionStartAt: '2026-09-11T10:00:00.000Z',
      businessRetentionHours: 72,
    }),
    '2026-09-14T10:00:00.000Z',
  )
})

test('purge scheduling fails closed for missing business dates or holds', () => {
  const input = { deletedAt: now, graceRetentionHours: 24, requireBusinessRetention: true }
  assert.equal(computePurgeDate(input), null)
  assert.equal(computePurgeDate({ ...input, retentionUntilDates: [null, now] }), '2026-09-12T10:00:00.000Z')
  assert.equal(computePurgeDate({ ...input, retentionUntilDates: [null, undefined] }), null)
  assert.equal(computePurgeDate({ ...input, retentionUntilDates: ['not-a-date'] }), null)
  assert.equal(computePurgeDate({ ...input, retentionUntilDates: [now], legalHoldAt: now }), null)
  assert.equal(computePurgeDate({ deletedAt: now, graceRetentionHours: null }), null)
})
