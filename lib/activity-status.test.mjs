import assert from 'node:assert/strict'
import test from 'node:test'

import { activityStatus, deadlineRange, requestTone } from './activity-status.ts'

const today = new Date(2026, 9, 20).getTime() // 20 octombrie 2026, la miezul nopții
const open = { status: 'in_progress', deadline_at: '2026-10-30' }

test('activitatea finalizată e „Finalizată”, orice ar fi dedesubt', () => {
  const status = activityStatus({ status: 'completed', deadline_at: '2026-10-01' }, [{ status: 'pending', deadline_at: '2026-10-01' }], today, false)
  assert.deepEqual(status, { tone: 'ok', label: 'Finalizată' })
})

test('termenul trecut arde înaintea oricărei alte stări', () => {
  assert.equal(activityStatus({ ...open, deadline_at: '2026-10-19' }, [{ status: 'review' }], today, false).label, 'Depășită')
  assert.equal(activityStatus(open, [{ status: 'pending', deadline_at: '2026-10-10' }], today, false).label, 'Depășită')
  // O cerere aprobată nu mai are un termen care să ardă.
  assert.equal(activityStatus(open, [{ status: 'approved', deadline_at: '2026-10-10' }], today, false).label, 'Toate primite')
})

test('echipa vede întâi ce are de verificat, clientul ce are de încărcat', () => {
  const requests = [{ status: 'review' }, { status: 'pending' }]
  assert.equal(activityStatus(open, requests, today, false).label, 'De verificat')
  assert.equal(activityStatus(open, requests, today, true).label, 'De încărcat')
  assert.equal(activityStatus(open, [{ status: 'pending' }], today, false).label, 'La client')
  assert.equal(activityStatus(open, [{ status: 'review' }], today, true).label, 'În verificare')
})

test('un document respins se spune ca atare', () => {
  assert.deepEqual(activityStatus(open, [{ status: 'rejected' }, { status: 'review' }], today, false), { tone: 'danger', label: 'Document respins' })
})

test('fără cereri, sau doar cu documente trimise clientului, activitatea e „În curs”', () => {
  assert.deepEqual(activityStatus(open, [], today, false), { tone: 'neutral', label: 'În curs' })
  assert.equal(activityStatus(open, [{ status: 'pending', is_outgoing: true }], today, false).label, 'În curs')
  assert.equal(activityStatus(open, [{ status: 'pending', deleted_at: '2026-10-01' }], today, false).label, 'În curs')
})

test('cererea închisă din „Aprobat” rămâne „Aprobat”', () => {
  assert.equal(requestTone({ status: 'closed', status_before_close: 'approved', deadline_at: '2026-10-01' }, today), 'ok')
  assert.equal(requestTone({ status: 'closed', status_before_close: 'pending', deadline_at: '2026-10-01' }, today), 'closed')
})

test('intervalul termenelor: aceeași lună o singură dată, fără punct', () => {
  assert.deepEqual(deadlineRange(['2026-10-30', '2026-10-21'], today), { label: '21 – 30 oct', overdue: false })
  assert.deepEqual(deadlineRange(['2026-10-06', '2026-11-04', null], today), { label: '6 oct – 4 nov', overdue: true })
  assert.deepEqual(deadlineRange(['2026-12-05'], today), { label: '5 dec', overdue: false })
  assert.equal(deadlineRange([null, undefined], today), null)
  assert.deepEqual(deadlineRange(['2027-04-05', '2027-04-26'], today), { label: '5 – 26 apr 2027', overdue: false })
})
