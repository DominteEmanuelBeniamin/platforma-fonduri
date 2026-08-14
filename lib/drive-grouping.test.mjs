import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDriveDocuments, buildDriveFolders } from './drive-grouping.ts'

const phases = [
  { id: 'phase-b', name: 'Aceeași fază', order_index: 1 },
  { id: 'phase-a', name: 'Aceeași fază', order_index: 1 },
  { id: 'phase-empty', name: 'Fără documente', order_index: 2 },
]

function request(overrides = {}) {
  return {
    id: 'request-1',
    name: 'Cerere document',
    status: 'review',
    visibility: 'published',
    attachment_path: null,
    created_at: '2026-01-01T00:00:00.000Z',
    activity: null,
    files: [],
    ...overrides,
  }
}

test('sorts same-name and same-order phases deterministically and keeps empty folders', () => {
  const documents = buildDriveDocuments([
    request({
      id: 'request-phase-a',
      activity: { id: 'activity-a', name: 'Activitate A', phase_id: 'phase-a', visibility: 'published', phase: { visibility: 'published' } },
      attachment_path: 'models/model.pdf',
    }),
  ], phases)
  const folders = buildDriveFolders(documents, phases)

  assert.deepEqual(folders.map(folder => folder.id), ['phase:phase-a', 'phase:phase-b', 'phase:phase-empty'])
  assert.equal(folders.find(folder => folder.id === 'phase:phase-empty').documentCount, 0)
})

test('groups general requests, multiple attachments, and every file in a version', () => {
  const documents = buildDriveDocuments([request({
    attachments: [
      { id: 'attachment-a', storage_path: 'models/a.pdf', original_name: 'A.pdf' },
      { id: 'attachment-b', storage_path: 'models/b.pdf', original_name: 'B.pdf' },
    ],
    files: [
      { id: 'file-v1', storage_path: 'uploads/v1.pdf', original_name: 'v1.pdf', version_number: 1, created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'file-v2-a', storage_path: 'uploads/v2-a.pdf', original_name: 'v2-a.pdf', version_number: 2, created_at: '2026-01-03T00:00:00.000Z' },
      { id: 'file-v2-b', storage_path: 'uploads/v2-b.pdf', original_name: 'v2-b.pdf', version_number: 2, created_at: '2026-01-04T00:00:00.000Z' },
    ],
  })], phases)

  assert.equal(documents.length, 1)
  assert.equal(documents[0].folderId, 'general')
  assert.equal(documents[0].attachments.length, 2)
  assert.deepEqual(documents[0].versions.map(version => version.version), [2, 1])
  assert.equal(documents[0].versions[0].assets.length, 2)
})

test('keeps the request status when the document only has a model attachment', () => {
  const documents = buildDriveDocuments([request({
    status: 'pending',
    attachment_path: 'models/formular.pdf',
  })], phases)

  assert.equal(documents[0].docStatus, 'pending')
})

test('marks a draft request as unpublished without changing its workflow status', () => {
  const documents = buildDriveDocuments([request({
    status: 'pending',
    visibility: 'draft',
    attachment_path: 'models/formular.pdf',
  })], phases)

  assert.equal(documents[0].publicationStatus, 'unpublished')
  assert.equal(documents[0].publicationReason, 'Nepublicat: cererea')
  assert.equal(documents[0].docStatus, 'pending')
})

test('omits requests without active attachments or files and counts logical documents', () => {
  const documents = buildDriveDocuments([
    request({ id: 'empty' }),
    request({
      id: 'deleted',
      files: [{ id: 'deleted-file', storage_path: 'x.pdf', version_number: 1, created_at: '2026-01-02T00:00:00.000Z', deleted_at: '2026-01-03T00:00:00.000Z' }],
    }),
    request({
      id: 'logical',
      files: [
        { id: 'a', storage_path: 'a.pdf', version_number: 1, created_at: '2026-01-02T00:00:00.000Z' },
        { id: 'b', storage_path: 'b.pdf', version_number: 1, created_at: '2026-01-02T00:00:00.000Z' },
      ],
    }),
  ], phases)
  const folders = buildDriveFolders(documents, phases)

  assert.deepEqual(documents.map(document => document.id), ['logical'])
  assert.equal(folders.find(folder => folder.id === 'general').documentCount, 1)
  assert.equal(folders.find(folder => folder.id === 'phase:phase-a').documentCount, 0)
})
