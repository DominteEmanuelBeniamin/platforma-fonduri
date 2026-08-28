import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decideReview,
  describeDocumentActionFailure,
  isValidDocumentActionUuid,
  normalizeUploadFileIds,
} from './document-action-idempotency.ts'

test('motivele RPC-ului primesc un mesaj în română și statusul potrivit', () => {
  assert.deepEqual(
    describeDocumentActionFailure('Notes are required for rejection', 'P0001'),
    { status: 400, message: 'Scrie motivul respingerii, ca utilizatorul să știe ce să corecteze.' },
  )
  assert.equal(
    describeDocumentActionFailure('This document version was already reviewed with another action', 'P0001').status,
    409,
  )
  // Un P0001 nerecunoscut rămâne un conflict, nu o eroare de server.
  assert.equal(describeDocumentActionFailure('Ceva nou din SQL', 'P0001').status, 409)
  assert.equal(describeDocumentActionFailure(null, '42501').status, 500)
})

test('review decision separates new, retry, conflict and invalid status', () => {
  assert.equal(decideReview('review', 'approved', null), 'new')
  assert.equal(decideReview('approved', 'approved', 'approved'), 'retry')
  assert.equal(decideReview('approved', 'rejected', 'approved'), 'conflict')
  assert.equal(decideReview('approved', 'approved', null), 'status-invalid')
})

test('document action UUID validation accepts canonical UUIDs only', () => {
  assert.equal(isValidDocumentActionUuid('00000000-0000-0000-0000-000000000000'), true)
  assert.equal(isValidDocumentActionUuid('not-a-uuid'), false)
  assert.equal(isValidDocumentActionUuid('00000000-0000-0000-0000-00000000000'), false)
})

test('normalizes upload file ids and rejects invalid or duplicate sets', () => {
  const first = '00000000-0000-0000-0000-000000000001'
  const second = '00000000-0000-0000-0000-000000000002'
  assert.deepEqual(normalizeUploadFileIds([second, first]), [first, second])
  assert.equal(normalizeUploadFileIds([first, first]), null)
  assert.equal(normalizeUploadFileIds([first, 'not-a-uuid']), null)
})
