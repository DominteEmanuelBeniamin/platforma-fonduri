import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decideReview,
  hasDuplicateUploadPaths,
  isValidDocumentActionUuid,
  isValidUploadFileSize,
  isValidUploadStoragePath,
} from './document-action-idempotency.ts'

test('review decision separates new, retry, conflict and invalid status', () => {
  assert.equal(decideReview('review', 'approved', null), 'new')
  assert.equal(decideReview('approved', 'approved', 'approved'), 'retry')
  assert.equal(decideReview('approved', 'rejected', 'approved'), 'conflict')
  assert.equal(decideReview('approved', 'approved', null), 'status-invalid')
})

test('upload batch validation detects duplicate paths', () => {
  assert.equal(hasDuplicateUploadPaths(['a.pdf', 'b.pdf']), false)
  assert.equal(hasDuplicateUploadPaths(['a.pdf', 'a.pdf']), true)
})

test('document action UUID validation accepts canonical UUIDs only', () => {
  assert.equal(isValidDocumentActionUuid('00000000-0000-0000-0000-000000000000'), true)
  assert.equal(isValidDocumentActionUuid('not-a-uuid'), false)
  assert.equal(isValidDocumentActionUuid('00000000-0000-0000-0000-00000000000'), false)
})

test('upload file size validation enforces the 25 MB server limit', () => {
  assert.equal(isValidUploadFileSize(undefined), true)
  assert.equal(isValidUploadFileSize(null), true)
  assert.equal(isValidUploadFileSize(25 * 1024 * 1024), true)
  assert.equal(isValidUploadFileSize(25 * 1024 * 1024 + 1), false)
  assert.equal(isValidUploadFileSize(-1), false)
})

test('upload storage paths stay within the request version prefix', () => {
  const prefix = 'projects/p1/document-requests/r1/v3/'
  assert.equal(isValidUploadStoragePath(`${prefix}file.pdf`, 'p1', 'r1', 3), true)
  assert.equal(isValidUploadStoragePath(`${prefix}folder/file.pdf`, 'p1', 'r1', 3), true)
  assert.equal(isValidUploadStoragePath('', 'p1', 'r1', 3), false)
  assert.equal(isValidUploadStoragePath('projects/p2/document-requests/r1/v3/file.pdf', 'p1', 'r1', 3), false)
  assert.equal(isValidUploadStoragePath('projects/p1/document-requests/r1/v2/file.pdf', 'p1', 'r1', 3), false)
  assert.equal(isValidUploadStoragePath(`${prefix}../v4/file.pdf`, 'p1', 'r1', 3), false)
})
