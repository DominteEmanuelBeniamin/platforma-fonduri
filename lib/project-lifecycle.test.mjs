import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countOverdueOpenItems,
  formatClosedDate,
  isProjectActive,
  PROJECT_CLOSE_REVIEW_FIRST_MESSAGE,
  projectCloseConfirm,
  projectClosedLabel,
  projectReopenConfirm,
} from './project-lifecycle.ts'
import { isProjectActive as isProjectActiveFromCalendar } from './calendar.ts'

test('doar „active" e proiect în lucru; orice altceva, inclusiv lipsa, e încheiat', () => {
  assert.equal(isProjectActive({ lifecycle_status: 'active' }), true)
  for (const value of ['completed', 'archived', 'cancelled', 'suspended', 'stare-noua', '', null, undefined]) {
    assert.equal(isProjectActive({ lifecycle_status: value }), false, String(value))
  }
  assert.equal(isProjectActive({}), false)
})

test('calendarul reexportă aceeași regulă, nu o copie', () => {
  assert.equal(isProjectActiveFromCalendar, isProjectActive)
})

test('badge-ul pune data în formatul aplicației, cu punct după lună', () => {
  // Amiaza UTC: aceeași zi calendaristică în orice fus de pe glob.
  assert.equal(formatClosedDate('2026-10-12T12:00:00.000Z'), '12 oct. 2026')
  assert.equal(projectClosedLabel('2026-10-12T12:00:00.000Z'), 'Încheiat pe 12 oct. 2026')
  assert.equal(projectClosedLabel('2026-10-12T12:00:00.000Z', 'Ana Popescu'), 'Încheiat pe 12 oct. 2026 · de Ana Popescu')
  // Clientul nu primește autorul: fără nume, doar data.
  assert.equal(projectClosedLabel('2026-10-12T12:00:00.000Z', null), 'Încheiat pe 12 oct. 2026')
  assert.equal(projectClosedLabel('2026-10-12T12:00:00.000Z', '   '), 'Încheiat pe 12 oct. 2026')
})

test('data se citește în ora României, oricare ar fi fusul browserului', () => {
  // 22:30 UTC pe 5 octombrie e deja 6 octombrie la București (UTC+3).
  assert.equal(formatClosedDate('2026-10-05T22:30:00.000Z'), '6 oct. 2026')
  assert.equal(formatClosedDate('2026-10-05T20:30:00.000Z'), '5 oct. 2026')
})

test('o dată lipsă sau stricată nu scrie „Invalid Date" în badge', () => {
  assert.equal(formatClosedDate(null), null)
  assert.equal(formatClosedDate('nu-e-data'), null)
  assert.equal(projectClosedLabel(null), 'Încheiat')
  assert.equal(projectClosedLabel('nu-e-data', 'Ana'), 'Încheiat · de Ana')
})

test('confirmarea de încheiere numește proiectul și spune ce se oprește', () => {
  const dialog = projectCloseConfirm('F1 - ACHIZIȚIE')
  assert.match(dialog.title, /F1 - ACHIZIȚIE/)
  assert.match(dialog.description, /Reminderele automate se opresc/)
  assert.match(dialog.description, /doar consulta/)
  assert.match(dialog.description, /redeschizi/)
  assert.equal(dialog.confirmText, 'Încheie proiectul')
})

test('încheierea cere întâi verificarea documentelor (8 octombrie 2026)', () => {
  assert.equal(
    PROJECT_CLOSE_REVIEW_FIRST_MESSAGE(1),
    'Un document așteaptă verificarea. Aprobă-l sau respinge-l, apoi încheie proiectul.',
  )
  assert.equal(
    PROJECT_CLOSE_REVIEW_FIRST_MESSAGE(3),
    '3 documente așteaptă verificarea. Aprobă-le sau respinge-le, apoi încheie proiectul.',
  )
  assert.match(PROJECT_CLOSE_REVIEW_FIRST_MESSAGE(20), /^20 de documente așteaptă/)
})

test('confirmarea de redeschidere numără termenele deja depășite', () => {
  const niciunul = projectReopenConfirm('P', 0)
  assert.doesNotMatch(niciunul.description, /depășit/)
  assert.equal(niciunul.confirmText, 'Redeschide proiectul')

  assert.match(projectReopenConfirm('P', 1).description, /Un termen e deja depășit: /)
  assert.match(projectReopenConfirm('P', 3).description, /3 termene sunt deja depășite: /)
  // Regula „de" peste 20, ca în restul aplicației.
  assert.match(projectReopenConfirm('P', 21).description, /21 de termene sunt deja depășite/)
})

test('cu reminderele oprite, redeschiderea nu promite emailuri', () => {
  const dialog = projectReopenConfirm('P', 2, false)
  assert.match(dialog.description, /rămân oprite/)
  assert.match(dialog.description, /2 termene sunt deja depășite\.$/)
  assert.doesNotMatch(dialog.description, /Termen depășit/)
})

test('numără ce va anunța cronul: publicat, deschis, cu termenul trecut', () => {
  const now = new Date('2026-10-05T09:00:00.000Z')
  const ieri = '2026-10-04T09:00:00.000Z'
  const maine = '2026-10-06T09:00:00.000Z'
  const P = 'published'
  const phases = [{
    visibility: P,
    activities: [
      { id: 'a1', visibility: P, status: 'pending', deadline_at: ieri },
      { id: 'a2', visibility: P, status: 'in_progress', deadline_at: ieri },
      { id: 'a3', visibility: P, status: 'completed', deadline_at: ieri },
      { id: 'a4', visibility: P, status: 'blocked', deadline_at: ieri },
      { id: 'a5', visibility: 'draft', status: 'pending', deadline_at: ieri },
      { id: 'a6', visibility: P, status: 'pending', deadline_at: maine },
      { id: 'a7', visibility: P, status: 'pending', deadline_at: null },
    ],
  }, { visibility: 'draft', activities: [{ id: 'b1', visibility: P, status: 'pending', deadline_at: ieri }] }]
  const requests = [
    { visibility: P, activity_id: 'a1', status: 'pending', deadline_at: ieri },
    { visibility: P, activity_id: null, status: 'rejected', deadline_at: ieri },
    { visibility: P, activity_id: 'a1', status: 'review', deadline_at: ieri },
    { visibility: P, activity_id: 'a1', status: 'approved', deadline_at: ieri },
    { visibility: P, activity_id: 'a1', status: 'closed', deadline_at: ieri },
    { visibility: P, activity_id: 'a1', status: 'pending', deadline_at: ieri, is_outgoing: true },
    { visibility: P, activity_id: 'a1', status: 'pending', deadline_at: ieri, deleted_at: '2026-10-01T00:00:00.000Z' },
    { visibility: 'draft', activity_id: 'a1', status: 'pending', deadline_at: ieri },
    { visibility: P, activity_id: 'a5', status: 'pending', deadline_at: ieri },
    { visibility: P, activity_id: 'b1', status: 'pending', deadline_at: ieri },
    { visibility: P, activity_id: 'a1', status: 'pending', deadline_at: maine },
  ]
  // 2 activități (a1, a2) + 2 cereri (pending publicată, rejected generală)
  assert.equal(countOverdueOpenItems(phases, requests, now), 4)
  assert.equal(countOverdueOpenItems([], [], now), 0)
})
