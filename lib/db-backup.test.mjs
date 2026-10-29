import assert from 'node:assert/strict'
import test from 'node:test'

import { backupDay, backupObjectName, backupObjectsToDelete } from './db-backup.ts'

test('ziua copiei e după ora României', () => {
  // 22:30 UTC pe 21 octombrie e deja 22 octombrie la București.
  assert.equal(backupDay(new Date('2026-10-21T22:30:00.000Z')), '2026-10-22')
  assert.equal(backupObjectName(new Date('2026-10-22T01:00:00.000Z')), 'kabinet-db-2026-10-22.ndjson.gz')
})

test('se șterg doar copiile mai vechi de 14 zile', () => {
  const now = new Date('2026-10-22T01:00:00.000Z')
  const names = [
    'kabinet-db-2026-10-22.ndjson.gz',
    'kabinet-db-2026-10-08.ndjson.gz',
    'kabinet-db-2026-10-07.ndjson.gz',
    'kabinet-db-2026-09-01.ndjson.gz',
  ]
  assert.deepEqual(backupObjectsToDelete(names, now), [
    'kabinet-db-2026-10-07.ndjson.gz',
    'kabinet-db-2026-09-01.ndjson.gz',
  ])
})

test('alte fișiere din dosar rămân neatinse', () => {
  const now = new Date('2026-10-22T01:00:00.000Z')
  assert.deepEqual(backupObjectsToDelete(['notite.txt', 'kabinet-db-2020-01-01.json', '.emptyFolderPlaceholder'], now), [])
})
