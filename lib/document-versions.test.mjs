import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeFiles,
  filterFilesForClient,
  isLatestFileVersion,
  latestVersionNumber,
} from './document-versions.ts'

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

test('nu ascunde fișiere din cauza unei versiuni lipsă sau numerice ca text', () => {
  // Fără versiune utilizabilă nu există „ultima versiune", deci null, nu 0.
  assert.equal(latestVersionNumber([{ id: 'a', version_number: null }]), null)
  assert.equal(latestVersionNumber([{ id: 'a' }]), null)
  assert.equal(latestVersionNumber([{ id: 'a', version_number: 'nu-i număr' }]), null)

  // Un version_number venit ca text nu trebuie să pice pe ===.
  assert.equal(latestVersionNumber([{ id: 'a', version_number: '2' }]), 2)
  assert.deepEqual(filterFilesForClient([{ id: 'a', version_number: '2' }]).map(f => f.id), ['a'])
  assert.equal(isLatestFileVersion({ version_number: '2' }, [{ version_number: 1 }, { version_number: '2' }]), true)
  assert.equal(isLatestFileVersion({ version_number: 1 }, [{ version_number: 1 }, { version_number: '2' }]), false)

  // Un fișier fără versiune nu e „cel mai recent" doar pentru că restul lipsesc.
  assert.equal(isLatestFileVersion({ version_number: null }, [{ version_number: null }]), false)
})
