import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isSensitivePurgeDue,
  parseSensitiveKindInput,
  sensitivePurgeAt,
  sensitivePurgeDueAt,
  sensitiveStatusLine,
} from './sensitive-documents.ts'

const approvedAt = '2026-10-01T09:00:00.000Z'
const closedAt = '2026-12-01T09:00:00.000Z'

test('o cerere nemarcată nu are termen de ștergere', () => {
  assert.equal(sensitivePurgeDueAt({ kind: null, status: 'approved', approvedAt, projectClosedAt: closedAt }), null)
  assert.equal(sensitivePurgeDueAt({ kind: 'altceva', projectClosedAt: closedAt }), null)
})

test('cazierul aprobat se șterge la 90 de zile', () => {
  assert.equal(
    sensitivePurgeDueAt({ kind: 'cazier', status: 'approved', approvedAt }),
    '2026-12-30T09:00:00.000Z',
  )
})

test('ceasul cazierului pornește doar cât cererea e aprobată', () => {
  assert.equal(sensitivePurgeDueAt({ kind: 'cazier', status: 'review', approvedAt }), null)
})

test('încheierea proiectului aduce termenul mai devreme, dacă vine prima', () => {
  assert.equal(
    sensitivePurgeDueAt({ kind: 'cazier', status: 'approved', approvedAt, projectClosedAt: '2026-10-10T09:00:00.000Z' }),
    '2026-11-09T09:00:00.000Z',
  )
})

test('actul de identitate așteaptă încheierea proiectului', () => {
  assert.equal(sensitivePurgeDueAt({ kind: 'identitate', status: 'approved', approvedAt }), null)
  assert.equal(sensitivePurgeDueAt({ kind: 'identitate', projectClosedAt: closedAt }), '2026-12-31T09:00:00.000Z')
})

test('amânarea mută termenul doar mai târziu', () => {
  const base = { kind: 'identitate', projectClosedAt: closedAt }
  assert.equal(sensitivePurgeAt({ ...base, holdUntil: '2027-06-01T00:00:00.000Z' }), '2027-06-01T00:00:00.000Z')
  assert.equal(sensitivePurgeAt({ ...base, holdUntil: '2026-12-05T00:00:00.000Z' }), '2026-12-31T09:00:00.000Z')
})

test('o cerere deja ștearsă nu mai are termen', () => {
  assert.equal(sensitivePurgeAt({ kind: 'identitate', projectClosedAt: closedAt, purgedAt: '2027-01-01T00:00:00.000Z' }), null)
})

test('jobul șterge doar ce a ajuns la termen', () => {
  const input = { kind: 'identitate', projectClosedAt: closedAt }
  assert.equal(isSensitivePurgeDue(input, Date.parse('2026-12-31T08:59:59.000Z')), false)
  assert.equal(isSensitivePurgeDue(input, Date.parse('2026-12-31T09:00:00.000Z')), true)
})

test('intrarea din API: lipsă, golire, valoare validă, valoare nevalidă', () => {
  assert.equal(parseSensitiveKindInput(undefined), undefined)
  assert.equal(parseSensitiveKindInput(null), null)
  assert.equal(parseSensitiveKindInput(''), null)
  assert.equal(parseSensitiveKindInput('cazier'), 'cazier')
  assert.equal(parseSensitiveKindInput('pasaport'), false)
})

test('rândul de stare spune termenul sau amânarea', () => {
  assert.match(sensitiveStatusLine({ kind: 'identitate', projectClosedAt: closedAt }), /^Se șterge automat pe /)
  assert.match(
    sensitiveStatusLine({ kind: 'identitate', projectClosedAt: closedAt, holdUntil: '2027-06-01T00:00:00.000Z' }),
    /^Ștergerea automată e amânată până pe /,
  )
  assert.equal(sensitiveStatusLine({ kind: null }), null)
})
