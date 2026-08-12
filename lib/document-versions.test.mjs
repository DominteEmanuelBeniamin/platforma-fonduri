import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeFiles,
  filterFilesForClient,
  isLatestFileVersion,
  latestVersionNumber,
} from './document-versions.js'

const files = [
  { id: 'old-a', version_number: 1 },
  { id: 'latest-a', version_number: 2 },
  { id: 'latest-b', version_number: 2 },
  { id: 'deleted', version_number: 3, deleted_at: '2026-08-12T00:00:00Z' },
]

test('uses the greatest non-deleted version and keeps every file in it', () => {
  assert.equal(latestVersionNumber(files), 2)
  assert.deepEqual(filterFilesForClient(files).map(file => file.id), ['latest-a', 'latest-b'])
  assert.equal(isLatestFileVersion(files[0], files), false)
  assert.equal(isLatestFileVersion(files[1], files), true)
})

test('ignores deleted files and handles empty input', () => {
  assert.deepEqual(activeFiles([{ id: 'deleted', deleted_at: 'now' }]), [])
  assert.equal(latestVersionNumber([]), null)
  assert.deepEqual(filterFilesForClient([]), [])
})
