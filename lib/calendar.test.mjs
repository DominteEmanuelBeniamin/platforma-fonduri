import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GENERAL_PHASE_ID,
  UNASSIGNED_OWNER_ID,
  activeFilterCount,
  clearCalendarParams,
  dateKey,
  deadlineKey,
  defaultFilters,
  eventProgress,
  filterEvents,
  isActivityDone,
  isRequestDone,
  isUrgentDeadline,
  monthGridDays,
  readFiltersFromParams,
  writeFiltersToParams,
} from './calendar.ts'

// Ziua de azi se mută, deci datele din teste se construiesc relativ la ea.
const dayOffset = days => {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

const event = extra => ({
  id: 'x',
  kind: 'request',
  name: 'Cerere',
  deadline_at: null,
  done: false,
  visibility: 'published',
  project_id: 'p1',
  project_title: 'Proiect',
  client_name: null,
  phase_id: null,
  phase_name: null,
  activity_id: null,
  activity_name: null,
  assignee_id: null,
  assignee_name: null,
  href: '/projects/p1',
  ...extra,
})

// ─── Stare derivată ───────────────────────────────────────────────────────────

test('„depășit" cere termen trecut ȘI element nefinalizat', () => {
  assert.equal(eventProgress({ deadline_at: dayOffset(-3), done: false }), 'overdue')
  // Un element finalizat după termen rămâne finalizat, nu devine depășit.
  assert.equal(eventProgress({ deadline_at: dayOffset(-3), done: true }), 'done')
  assert.equal(eventProgress({ deadline_at: dayOffset(3), done: false }), 'open')
  assert.equal(eventProgress({ deadline_at: null, done: false }), 'open')
  assert.equal(eventProgress({ deadline_at: dayOffset(0), done: false }), 'open')
})

test('urgent = depășit sau în următoarele 7 zile, pe ce nu e gata', () => {
  assert.equal(isUrgentDeadline(dayOffset(-1)), true)
  assert.equal(isUrgentDeadline(dayOffset(0)), true)
  assert.equal(isUrgentDeadline(dayOffset(7)), true)
  assert.equal(isUrgentDeadline(dayOffset(8)), false)
  assert.equal(isUrgentDeadline(null), false)
  assert.equal(isUrgentDeadline(dayOffset(-1), true), false)
})

test('finalizat înseamnă altceva pe activitate față de cerere', () => {
  assert.equal(isActivityDone({ status: 'completed' }), true)
  assert.equal(isActivityDone({ status: 'pending', completed_at: '2026-01-01' }), true)
  assert.equal(isActivityDone({ status: 'pending', completed_at: null }), false)
  assert.equal(isRequestDone({ status: 'approved' }), true)
  assert.equal(isRequestDone({ status: 'rejected' }), false)
  assert.equal(isRequestDone({ status: 'review' }), false)
})

// ─── Grila de lună ────────────────────────────────────────────────────────────

test('grila are 42 de zile și începe luni', () => {
  // August 2026 începe sâmbătă, deci grila pornește de luni 27 iulie.
  const days = monthGridDays(new Date(2026, 7, 1))
  assert.equal(days.length, 42)
  assert.equal(days.every(day => day.getDay() !== undefined), true)
  assert.equal(dateKey(days[0]), '2026-07-27')
  assert.equal(days[0].getDay(), 1)
  assert.equal(dateKey(days[41]), '2026-09-06')
})

test('grila unei luni care începe chiar luni nu adaugă săptămână goală în față', () => {
  // Iunie 2026 începe luni.
  const days = monthGridDays(new Date(2026, 5, 1))
  assert.equal(dateKey(days[0]), '2026-06-01')
  assert.equal(days.length, 42)
})

test('cheia de zi a unui termen e ziua locală, nu cea UTC', () => {
  assert.equal(deadlineKey(null), null)
  assert.equal(deadlineKey('nu-e-dată'), null)
  const local = new Date(2026, 7, 12, 3, 0, 0)
  assert.equal(deadlineKey(local.toISOString()), '2026-08-12')
})

// ─── Filtre ───────────────────────────────────────────────────────────────────

test('consultantul pornește de la ce îi e atribuit, adminul de la tot', () => {
  assert.deepEqual(defaultFilters('consultant', 'u1').owners, ['u1'])
  assert.equal(defaultFilters('admin', 'u1').owners, null)
  assert.equal(defaultFilters('client', 'u1').owners, null)
})

test('filtrele se combină, iar „General" prinde cererile fără fază', () => {
  const events = [
    event({ id: 'a', kind: 'activity', phase_id: 'f1', assignee_id: 'u1' }),
    event({ id: 'b', phase_id: 'f1', assignee_id: 'u2' }),
    event({ id: 'c', phase_id: null, assignee_id: null, visibility: 'draft' }),
  ]
  const base = defaultFilters('admin', 'u1')

  assert.deepEqual(filterEvents(events, base).map(e => e.id), ['a', 'b', 'c'])
  assert.deepEqual(filterEvents(events, { ...base, kinds: ['activity'] }).map(e => e.id), ['a'])
  assert.deepEqual(filterEvents(events, { ...base, phaseIds: [GENERAL_PHASE_ID] }).map(e => e.id), ['c'])
  assert.deepEqual(filterEvents(events, { ...base, phaseIds: ['f1'] }).map(e => e.id), ['a', 'b'])
  assert.deepEqual(filterEvents(events, { ...base, owners: [UNASSIGNED_OWNER_ID] }).map(e => e.id), ['c'])
  assert.deepEqual(filterEvents(events, { ...base, visibility: ['draft'] }).map(e => e.id), ['c'])
  // combinate
  assert.deepEqual(
    filterEvents(events, { ...base, kinds: ['request'], phaseIds: ['f1'], owners: ['u2'] }).map(e => e.id),
    ['b'],
  )
  // niciun tip selectat nu înseamnă „toate"
  assert.deepEqual(filterEvents(events, { ...base, kinds: [] }), [])
})

test('cererea din interiorul activității mele intră în „ale mele"', () => {
  // Responsabilul efectiv e calculat pe server: cererea fără `assigned_to`
  // propriu poartă consultantul activității-părinte.
  const events = [event({ id: 'b', phase_id: 'f1', assignee_id: 'u1' })]
  assert.deepEqual(filterEvents(events, defaultFilters('consultant', 'u1')).map(e => e.id), ['b'])
  assert.deepEqual(filterEvents(events, defaultFilters('consultant', 'u9')), [])
})

// ─── Filtre în URL ────────────────────────────────────────────────────────────

const roundTrip = (filters, defaults) => {
  const params = new URLSearchParams()
  writeFiltersToParams(params, filters, defaults)
  return { params, back: readFiltersFromParams(params, defaults) }
}

test('starea implicită nu lasă nimic în URL', () => {
  const defaults = defaultFilters('admin', 'u1')
  const { params, back } = roundTrip(defaults, defaults)
  assert.equal(params.toString(), '')
  assert.deepEqual(back, defaults)
})

test('„toate" și „niciuna" nu se confundă la dus-întors', () => {
  const defaults = defaultFilters('consultant', 'u1')

  // Consultantul comută de pe „ale mele" pe „toate": null trebuie să ajungă în
  // URL explicit, altfel s-ar reciti ca implicitul lui.
  const all = roundTrip({ ...defaults, owners: null }, defaults)
  assert.equal(all.params.get('co'), '*')
  assert.equal(all.back.owners, null)

  // Lista goală e o stare validă și distinctă.
  const none = roundTrip({ ...defaults, progress: [] }, defaults)
  assert.equal(none.params.get('cs'), '-')
  assert.deepEqual(none.back.progress, [])
})

test('o vedere filtrată se redeschide identic', () => {
  const defaults = defaultFilters('admin', 'u1')
  const filters = {
    kinds: ['request'],
    phaseIds: ['f1', GENERAL_PHASE_ID],
    projectIds: null,
    progress: ['overdue'],
    visibility: ['draft'],
    owners: ['u2', UNASSIGNED_OWNER_ID],
  }
  const { back } = roundTrip(filters, defaults)
  assert.deepEqual(back, filters)
})

test('valorile necunoscute din URL sunt ignorate, nu propagate', () => {
  const defaults = defaultFilters('admin', 'u1')
  const params = new URLSearchParams('ck=activity,inventat&cs=overdue,aiurea')
  const back = readFiltersFromParams(params, defaults)
  assert.deepEqual(back.kinds, ['activity'])
  assert.deepEqual(back.progress, ['overdue'])
})

test('numărătoarea de filtre active vede exact abaterile', () => {
  const defaults = defaultFilters('admin', 'u1')
  assert.equal(activeFilterCount(defaults, defaults), 0)
  assert.equal(activeFilterCount({ ...defaults, kinds: ['activity'] }, defaults), 1)
  assert.equal(activeFilterCount({ ...defaults, kinds: ['activity'], owners: ['u2'] }, defaults), 2)
  // aceleași valori în altă ordine nu sunt o abatere
  assert.equal(activeFilterCount({ ...defaults, kinds: ['request', 'activity'] }, defaults), 0)
})

test('părăsirea tabului curăță din URL doar parametrii calendarului', () => {
  const params = new URLSearchParams('view=calendar&phase=f1&cv=list&cm=2026-08&co=u1')
  clearCalendarParams(params)
  assert.equal(params.get('cv'), null)
  assert.equal(params.get('cm'), null)
  assert.equal(params.get('co'), null)
  assert.equal(params.get('phase'), 'f1')
  assert.equal(params.get('view'), 'calendar')
})
