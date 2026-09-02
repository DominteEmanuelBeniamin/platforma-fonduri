import assert from 'node:assert/strict'
import test from 'node:test'

// Calea relativă cu extensie: Node nu cunoaște aliasul `@/`.
import { isMissingObjectError } from '../app/api/_utils/attachment-storage.ts'

test('obiectul sursă lipsă e recunoscut ca atare', () => {
  assert.equal(isMissingObjectError('Object not found'), true)
  assert.equal(isMissingObjectError('not_found'), true)
  assert.equal(isMissingObjectError('The resource was not found'), true)
  assert.equal(isMissingObjectError('Request failed with status 404'), true)
})

test('accidentele nu trec drept fișier lipsă', () => {
  // Fiecare dintre ele ar fi lăsat copia pe obiectul originalului.
  assert.equal(isMissingObjectError('Internal Server Error'), false)
  assert.equal(isMissingObjectError('fetch failed'), false)
  assert.equal(isMissingObjectError('The operation timed out'), false)
  assert.equal(isMissingObjectError('The resource already exists'), false)
  assert.equal(isMissingObjectError('Payload too large'), false)
  assert.equal(isMissingObjectError(null), false)
  assert.equal(isMissingObjectError(undefined), false)
  assert.equal(isMissingObjectError(''), false)
})

test('bucket-ul lipsă e o problemă de configurare, nu un model șters', () => {
  assert.equal(isMissingObjectError('Bucket not found'), false)
})
