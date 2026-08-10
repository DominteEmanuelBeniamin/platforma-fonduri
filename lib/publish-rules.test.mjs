import assert from 'node:assert/strict'
import test from 'node:test'
import publishRules from './publish-rules.js'

const { publishBlockers, publishBlockedError, BLOCKER_DEADLINE, BLOCKER_ASSIGNEE } = publishRules

test('cererea fără termen nu se poate publica', () => {
  assert.deepEqual(publishBlockers({ currentDeadline: null }), [BLOCKER_DEADLINE])
  assert.deepEqual(publishBlockers({ currentDeadline: '' }), [BLOCKER_DEADLINE])
})

test('cererea cu termen se poate publica, fără consultant', () => {
  assert.deepEqual(publishBlockers({ currentDeadline: '2026-09-01', currentAssignee: null }), [])
})

test('activitatea are nevoie și de termen, și de consultant', () => {
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: null, currentAssignee: null }),
    [BLOCKER_DEADLINE, BLOCKER_ASSIGNEE]
  )
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: '2026-09-01', currentAssignee: null }),
    [BLOCKER_ASSIGNEE]
  )
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: '2026-09-01', currentAssignee: 'uuid' }),
    []
  )
})

test('valorile trimise în aceeași cerere contează', () => {
  assert.deepEqual(
    publishBlockers({
      kind: 'activity',
      currentDeadline: null,
      incomingDeadline: '2026-09-01',
      currentAssignee: null,
      incomingAssignee: 'uuid',
    }),
    []
  )
})

test('aceeași cerere nu poate publica și goli câmpul cerut', () => {
  assert.deepEqual(
    publishBlockers({ currentDeadline: '2026-09-01', incomingDeadline: null }),
    [BLOCKER_DEADLINE]
  )
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: '2026-09-01', currentAssignee: 'uuid', incomingAssignee: null }),
    [BLOCKER_ASSIGNEE]
  )
})

test('documentele informative sunt exceptate', () => {
  assert.deepEqual(publishBlockers({ isOutgoing: true, currentDeadline: null }), [])
})

test('mesajul de eroare enumeră tot ce lipsește și trece prin apiFetch în `message`', () => {
  const body = publishBlockedError([BLOCKER_DEADLINE, BLOCKER_ASSIGNEE])
  assert.equal(body.message, body.error)
  assert.deepEqual(body.missing, [BLOCKER_DEADLINE, BLOCKER_ASSIGNEE])
  assert.equal(body.message, 'Nu poți publica fără termen limită și un consultant atribuit. Completează, apoi publică.')
})
