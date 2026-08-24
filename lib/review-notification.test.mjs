import test from 'node:test'
import assert from 'node:assert/strict'
import { selectReviewNotificationCandidates } from './review-notification.ts'

function request(overrides = {}) {
  return {
    id: 'request-1',
    status: 'rejected',
    visibility: 'published',
    deleted_at: null,
    activity_id: null,
    ...overrides,
  }
}

function review(overrides = {}) {
  return {
    id: 'review-1',
    requirement_id: 'request-1',
    action: 'rejected',
    reason: 'Fișierul este ilizibil',
    reviewed_at: '2026-08-19T09:00:00.000Z',
    client_notified_at: null,
    ...overrides,
  }
}

test('selects an eligible rejection and keeps its reason', () => {
  const result = selectReviewNotificationCandidates({
    requests: [request()],
    reviews: [review()],
  })

  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].review.action, 'rejected')
  assert.equal(result.candidates[0].review.reason, 'Fișierul este ilizibil')
  assert.deepEqual(result.candidates[0].unnotifiedReviewIds, ['review-1'])
})

test('returns only the final approval while claiming both review rows', () => {
  const result = selectReviewNotificationCandidates({
    requests: [request({ status: 'approved' })],
    reviews: [
      review({ id: 'review-rejected', reviewed_at: '2026-08-19T09:00:00.000Z' }),
      review({
        id: 'review-approved',
        action: 'approved',
        reason: null,
        reviewed_at: '2026-08-19T10:00:00.000Z',
      }),
    ],
  })

  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].review.action, 'approved')
  assert.deepEqual(result.candidates[0].unnotifiedReviewIds.sort(), ['review-approved', 'review-rejected'])
})

test('does not notify a rejected review after the file returns to review', () => {
  const result = selectReviewNotificationCandidates({
    requests: [request({ status: 'review' })],
    reviews: [review()],
  })

  assert.equal(result.candidates.length, 0)
})

test('excludes a review whose action differs from the current final status', () => {
  const result = selectReviewNotificationCandidates({
    requests: [request({ status: 'approved' })],
    reviews: [review()],
  })

  assert.equal(result.candidates.length, 0)
  assert.deepEqual(result.incompatibleRequestIds, ['request-1'])
})

test('excludes draft chains and deleted requests', () => {
  const phase = { id: 'phase-1', visibility: 'published' }
  const activity = { id: 'activity-1', visibility: 'published', phase }
  const rows = [
    request({ id: 'draft-request', visibility: 'draft' }),
    request({ id: 'draft-activity', activity_id: 'activity-1', activity: { ...activity, visibility: 'draft' } }),
    request({ id: 'draft-phase', activity_id: 'activity-1', activity: { ...activity, phase: { ...phase, visibility: 'draft' } } }),
    request({ id: 'deleted-request', deleted_at: '2026-08-19T11:00:00.000Z' }),
  ]

  const result = selectReviewNotificationCandidates({
    requests: rows,
    reviews: rows.map(row => review({ id: `${row.id}-review`, requirement_id: row.id })),
  })

  assert.equal(result.candidates.length, 0)
})

test('does not resend when the latest review is notified, even if an older row is null', () => {
  const result = selectReviewNotificationCandidates({
    requests: [request({ status: 'approved' })],
    reviews: [
      review({ id: 'review-old', reviewed_at: '2026-08-19T09:00:00.000Z' }),
      review({
        id: 'review-latest',
        action: 'approved',
        reason: null,
        reviewed_at: '2026-08-19T10:00:00.000Z',
        client_notified_at: '2026-08-19T10:01:00.000Z',
      }),
    ],
  })

  assert.equal(result.candidates.length, 0)
})
