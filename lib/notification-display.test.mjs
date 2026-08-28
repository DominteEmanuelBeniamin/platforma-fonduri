import assert from 'node:assert/strict'
import test from 'node:test'

import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  formatRelativeTime,
  notificationAction,
  notificationContext,
  notificationDayGroup,
  notificationSubject,
} from './notification-display.ts'

const now = new Date('2026-08-27T12:00:00')
const ago = (ms) => new Date(now.getTime() - ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

test('relative time keeps Romanian agreement across the ranges', () => {
  assert.equal(formatRelativeTime(ago(5_000), now), 'chiar acum')
  assert.equal(formatRelativeTime(ago(MINUTE), now), 'acum un minut')
  assert.equal(formatRelativeTime(ago(5 * MINUTE), now), 'acum 5 minute')
  assert.equal(formatRelativeTime(ago(25 * MINUTE), now), 'acum 25 de minute')
  assert.equal(formatRelativeTime(ago(HOUR), now), 'acum o oră')
  assert.equal(formatRelativeTime(ago(3 * HOUR), now), 'acum 3 ore')
  assert.equal(formatRelativeTime(ago(21 * HOUR), now), 'acum 21 de ore')
})

test('from yesterday down, the row shows the day and the hour', () => {
  // Sub 24 de ore rămâne exact; „ieri” începe de la ziua calendaristică precedentă.
  assert.equal(formatRelativeTime(new Date('2026-08-26T23:30:00').toISOString(), now), 'acum 12 ore')
  assert.equal(formatRelativeTime(new Date('2026-08-26T06:00:00').toISOString(), now), 'ieri, 06:00')
  assert.equal(formatRelativeTime(ago(3 * DAY), now), 'luni, 12:00')
  // Sâmbăta trecută, într-o zi de joi: numele zilei ar arăta către sâmbăta care
  // vine, așa că din săptămâna trecută în jos rândul revine la dată.
  assert.equal(formatRelativeTime(new Date('2026-08-22T18:45:00').toISOString(), now), '22 aug. 2026, 18:45')
  assert.equal(formatRelativeTime(new Date('2026-07-28T09:05:00').toISOString(), now), '28 iul. 2026, 09:05')
})

test('the weekday name stays inside the current week, whatever day it is', () => {
  // Luni: o fereastră de 7 zile ar fi cuprins toată săptămâna trecută.
  const monday = new Date('2026-08-31T09:00:00')
  assert.equal(formatRelativeTime(new Date('2026-08-26T14:20:00').toISOString(), monday), '26 aug. 2026, 14:20')
  assert.equal(notificationDayGroup(new Date('2026-08-26T14:20:00').toISOString(), monday), 'Săptămâna trecută')
  assert.equal(notificationDayGroup(new Date('2026-08-31T08:00:00').toISOString(), monday), 'Astăzi')
})

test('a broken or future timestamp falls back to the absolute form', () => {
  assert.equal(formatRelativeTime('nu-i o dată', now), 'nu-i o dată')
  assert.match(formatRelativeTime(new Date(now.getTime() + HOUR).toISOString(), now), /2026/)
})

test('day groups separate today, yesterday and the rest', () => {
  assert.equal(notificationDayGroup(ago(2 * HOUR), now), 'Astăzi')
  assert.equal(notificationDayGroup(new Date('2026-08-26T08:00:00').toISOString(), now), 'Ieri')
  // Marți 25, în aceeași săptămână cu joi 27.
  assert.equal(notificationDayGroup(ago(2 * DAY), now), 'Săptămâna aceasta')
  // Duminică 23 închide săptămâna dinainte, chiar dacă sunt doar 4 zile.
  assert.equal(notificationDayGroup(ago(4 * DAY), now), 'Săptămâna trecută')
  assert.match(notificationDayGroup(ago(60 * DAY), now), /2026/)
})

test('only digests carry their item count', () => {
  const base = { title: 'Element nou publicat', createdAt: ago(MINUTE), projectTitle: 'Proiect' }
  assert.equal(notificationAction({ ...base, type: 'publication', itemCount: 1 }), 'Element nou publicat')
  assert.equal(notificationAction({ ...base, type: 'publication', itemCount: 3 }), 'Elemente noi publicate (3)')
  assert.equal(
    notificationAction({ ...base, type: 'document_action', title: 'Documente încărcate', itemCount: 2 }),
    'Documente încărcate (2)',
  )
})

test('the subject is the thing, and falls back to the action', () => {
  const base = { type: 'assignment', title: 'Activitate atribuită', itemCount: 1, createdAt: ago(MINUTE) }
  assert.equal(notificationSubject({ ...base, entityLabel: 'Depunere cerere' }), 'Depunere cerere')
  assert.equal(notificationSubject({ ...base, entityLabel: '   ' }), 'Activitate atribuită')
  // Rândurile scrise înainte de `entity_label` au numele în titlu.
  assert.equal(
    notificationSubject({ ...base, title: 'Activitate atribuită: Depunere cerere' }),
    'Activitate atribuită: Depunere cerere',
  )
})

test('the context line never repeats what the subject already said', () => {
  const base = { type: 'assignment', title: 'Activitate atribuită', itemCount: 1, createdAt: ago(5 * MINUTE) }
  assert.deepEqual(
    notificationContext({ ...base, entityLabel: 'Depunere cerere', actorName: 'Ana Pop', projectTitle: 'Fonduri' }, now),
    ['Activitate atribuită de Ana Pop', 'Fonduri', 'acum 5 minute'],
  )
  assert.deepEqual(
    notificationContext({ ...base, entityLabel: 'Depunere cerere', projectTitle: 'Fonduri' }, now),
    ['Activitate atribuită', 'Fonduri', 'acum 5 minute'],
  )
  // Fără subiect propriu, acțiunea e deja pe prima linie.
  assert.deepEqual(
    notificationContext({ ...base, actorName: 'Ana Pop', projectTitle: 'Fonduri' }, now),
    ['de Ana Pop', 'Fonduri', 'acum 5 minute'],
  )
  assert.deepEqual(
    notificationContext({ ...base, projectTitle: null }, now),
    ['Proiect fără titlu', 'acum 5 minute'],
  )
})

test('every notification type has a filter label', () => {
  for (const type of NOTIFICATION_TYPES) {
    assert.equal(typeof NOTIFICATION_TYPE_LABELS[type], 'string')
  }
  assert.equal(Object.keys(NOTIFICATION_TYPE_LABELS).length, NOTIFICATION_TYPES.length)
})
