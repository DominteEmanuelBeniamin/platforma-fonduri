import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLOSED_REQUEST_CLIENT_NOTE,
  closedRequestClientNote,
  displayedRequestStatus,
  REQUEST_STATUSES,
  REQUEST_STATUS_INFO,
  isRequestStatus,
  requestStatusInfo,
  requestStatusLabel,
} from './request-status.ts'
import { TONE } from './signage.ts'

test('dicționarul acoperă exact stările permise de CHECK-ul din bază', () => {
  assert.deepEqual([...REQUEST_STATUSES].sort(), ['approved', 'closed', 'pending', 'rejected', 'review'])
  assert.deepEqual(Object.keys(REQUEST_STATUS_INFO).sort(), [...REQUEST_STATUSES].sort())
  for (const status of REQUEST_STATUSES) {
    const info = REQUEST_STATUS_INFO[status]
    assert.ok(info.label.trim(), `etichetă: ${status}`)
    assert.ok(info.clientLabel.trim(), `etichetă client: ${status}`)
    assert.ok(Object.hasOwn(TONE, info.tone), `ton cunoscut: ${status}`)
  }
})

test('clientul are de încărcat; echipa așteaptă răspuns', () => {
  assert.equal(requestStatusLabel('pending', true), 'De încărcat')
  assert.equal(requestStatusLabel('pending', false), 'Așteaptă răspuns')
})

test('cererea închisă se cheamă „Închisă" pentru toți și nu e verde', () => {
  assert.equal(requestStatusLabel('closed', true), 'Închisă')
  assert.equal(requestStatusLabel('closed', false), 'Închisă')
  // Separată de „Aprobat": documentul poate să nu fi venit niciodată.
  assert.notEqual(REQUEST_STATUS_INFO.closed.tone, REQUEST_STATUS_INFO.approved.tone)
  assert.equal(REQUEST_STATUS_INFO.closed.tone, 'closed')
  assert.match(CLOSED_REQUEST_CLIENT_NOTE, /nu mai e nevoie să încarci/)
})

test('o stare necunoscută nu se mai deghizează în „De încărcat"', () => {
  for (const value of ['uploaded', 'stare-noua', '', null, undefined]) {
    assert.equal(isRequestStatus(value), false, String(value))
    assert.equal(requestStatusLabel(value, true), 'Stare necunoscută')
    assert.equal(requestStatusInfo(value).tone, 'neutral')
  }
})

test('o cerere închisă din „Aprobat” se arată „Aprobat”; celelalte, „Închisă”', () => {
  assert.equal(displayedRequestStatus({ status: 'closed', status_before_close: 'approved' }), 'approved')
  assert.equal(displayedRequestStatus({ status: 'closed', status_before_close: 'rejected' }), 'closed')
  assert.equal(displayedRequestStatus({ status: 'closed', status_before_close: 'pending' }), 'closed')
  assert.equal(displayedRequestStatus({ status: 'approved', status_before_close: null }), 'approved')
  assert.equal(displayedRequestStatus({ status: 'pending' }), 'pending')
  assert.equal(displayedRequestStatus({}), null)
})

test('nota clientului pe o cerere închisă spune dacă documentul fusese aprobat', () => {
  assert.equal(closedRequestClientNote({ status_before_close: 'pending' }), CLOSED_REQUEST_CLIENT_NOTE)
  assert.match(closedRequestClientNote({ status_before_close: 'approved' }), /Documentul e aprobat/)
})
