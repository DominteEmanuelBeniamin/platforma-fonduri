import assert from 'node:assert/strict'
import test from 'node:test'
import publishRules from './publish-rules.js'

const { missingDeadlineForPublish, deadlineRequiredError, DEADLINE_REQUIRED_CODE } = publishRules

test('blochează publicarea când rândul nu are termen și nu se trimite unul', () => {
  assert.equal(missingDeadlineForPublish({ currentDeadline: null }), true)
  assert.equal(missingDeadlineForPublish({ currentDeadline: '' }), true)
})

test('permite publicarea când termenul există deja pe rând', () => {
  assert.equal(missingDeadlineForPublish({ currentDeadline: '2026-09-01' }), false)
})

test('permite publicarea când termenul vine în aceeași cerere', () => {
  assert.equal(
    missingDeadlineForPublish({ currentDeadline: null, incomingDeadline: '2026-09-01' }),
    false
  )
})

test('blochează publicarea când aceeași cerere șterge termenul existent', () => {
  assert.equal(
    missingDeadlineForPublish({ currentDeadline: '2026-09-01', incomingDeadline: null }),
    true
  )
  assert.equal(
    missingDeadlineForPublish({ currentDeadline: '2026-09-01', incomingDeadline: '' }),
    true
  )
})

test('documentele informative sunt exceptate', () => {
  assert.equal(missingDeadlineForPublish({ isOutgoing: true, currentDeadline: null }), false)
})

test('răspunsul de eroare poartă motivul real în `message`', () => {
  const body = deadlineRequiredError()
  assert.equal(body.code, DEADLINE_REQUIRED_CODE)
  assert.equal(body.message, body.error)
  assert.match(body.message, /termen limită/i)
})
