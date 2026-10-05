import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countOverdueOpenItems,
  formatClosedDate,
  isProjectActive,
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
  assert.match(dialog.description, /redeschide/)
  assert.equal(dialog.confirmText, 'Încheie proiectul')
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

test('numără doar ce e încă deschis și are termenul trecut', () => {
  const now = new Date('2026-10-05T09:00:00.000Z')
  const ieri = '2026-10-04T09:00:00.000Z'
  const maine = '2026-10-06T09:00:00.000Z'
  const phases = [{
    activities: [
      { status: 'pending', deadline_at: ieri },
      { status: 'in_progress', deadline_at: ieri },
      { status: 'completed', deadline_at: ieri },
      { status: 'pending', deadline_at: maine },
      { status: 'pending', deadline_at: null },
    ],
  }]
  const requests = [
    { status: 'pending', deadline_at: ieri },
    { status: 'rejected', deadline_at: ieri },
    { status: 'review', deadline_at: ieri },
    { status: 'approved', deadline_at: ieri },
    { status: 'closed', deadline_at: ieri },
    { status: 'pending', deadline_at: ieri, is_outgoing: true },
    { status: 'pending', deadline_at: ieri, deleted_at: '2026-10-01T00:00:00.000Z' },
    { status: 'pending', deadline_at: maine },
  ]
  // 2 activități + 3 cereri (pending, rejected, review)
  assert.equal(countOverdueOpenItems(phases, requests, now), 5)
  assert.equal(countOverdueOpenItems([], [], now), 0)
})
