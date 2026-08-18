import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GENERAL_PHASE_ID,
  UNASSIGNED_OWNER_ID,
  activeFilterCount,
  buildProjectDashboardRows,
  clearCalendarParams,
  dateKey,
  deadlineKey,
  defaultFilters,
  eventProgress,
  filterEvents,
  isActivityDone,
  isProjectActive,
  isRequestDone,
  isUrgentDeadline,
  monthGridDays,
  monthKey,
  nextProjectSort,
  parseMonthKey,
  readFiltersFromParams,
  readProjectSort,
  readShowEnded,
  requestOwnerId,
  sortProjectRows,
  writeFiltersToParams,
  writeProjectSort,
  writeShowEnded,
} from './calendar.ts'
import { avatarColors } from './avatar.ts'
import { DARK_INK, LIGHT_INK, readableInk, relativeLuminance } from './contrast.ts'

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

test('responsabilul cererii coboară pe lanțul cerere → activitate → proiect', () => {
  assert.equal(requestOwnerId({ assigned_to: 'u1', activity: { assigned_to: 'u2' } }), 'u1')
  assert.equal(requestOwnerId({ assigned_to: null, activity_id: 'a1', activity: { assigned_to: 'u2' } }), 'u2')
  // cererea generală, fără activitate, cade pe consultantul de proiect
  assert.equal(requestOwnerId({ assigned_to: null, activity_id: null, generalOwnerId: 'u3' }), 'u3')
  // dar una din interiorul unei activități neatribuite nu îl moștenește
  assert.equal(requestOwnerId({ assigned_to: null, activity_id: 'a1', activity: null, generalOwnerId: 'u3' }), null)
  assert.equal(requestOwnerId({}), null)
})

test('activitatea-părinte se citește la fel, obiect sau listă', () => {
  // PostgREST întoarce relația când într-un fel, când în celălalt, iar cele
  // două apeluri — ruta de calendar și badge-ul din pagina proiectului — vin
  // din interogări diferite. Dacă lista ar cădea pe `null`, badge-ul ar socoti
  // cererea neatribuită, iar calendarul ar da-o pe seama cuiva.
  assert.equal(requestOwnerId({ activity_id: 'a1', activity: [{ assigned_to: 'u2' }] }), 'u2')
  assert.equal(requestOwnerId({ activity_id: 'a1', activity: { assigned_to: 'u2' } }), 'u2')
  assert.equal(requestOwnerId({ activity_id: 'a1', activity: [] }), null)
})

// ─── Contrastul textului de pe eveniment ──────────────────────────────────────

test('fiecare culoare din paletă primește cerneala mai lizibilă', () => {
  // Contrastul WCAG dintre două luminanțe.
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const inkLuminance = { [DARK_INK]: relativeLuminance(DARK_INK), [LIGHT_INK]: relativeLuminance(LIGHT_INK) }

  for (const { from } of avatarColors) {
    const chosen = readableInk(from)
    const other = chosen === DARK_INK ? LIGHT_INK : DARK_INK
    const background = relativeLuminance(from)
    assert.ok(
      contrast(background, inkLuminance[chosen]) >= contrast(background, inkLuminance[other]),
      `${from}: ${chosen} e mai puțin lizibil decât ${other}`,
    )
  }
})

test('culorile deschise din paletă nu primesc text alb', () => {
  // Chihlimbarul e cazul care a scăpat prima dată: alb pe #f59e0b dă 2,15:1.
  assert.equal(readableInk('#f59e0b'), DARK_INK)
  assert.equal(readableInk('#06b6d4'), DARK_INK)
  assert.equal(readableInk('#10b981'), DARK_INK)
  // iar cele închise nu primesc cerneală închisă
  assert.equal(readableInk('#2456a7'), LIGHT_INK)
  assert.equal(readableInk('#9333ea'), LIGHT_INK)
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

test('luna din URL se citește ca an literal, sau deloc', () => {
  assert.equal(monthKey(parseMonthKey('2026-08')), '2026-08')
  assert.equal(parseMonthKey('2026-13'), null)
  assert.equal(parseMonthKey('2026-00'), null)
  assert.equal(parseMonthKey('august'), null)
  assert.equal(parseMonthKey(null), null)
  // `new Date(26, 7, 1)` ar fi dat anul 1926, iar `writeMonth` l-ar fi scris
  // înapoi în URL — o lună inventată, din care nu se mai iese.
  assert.equal(parseMonthKey('0026-08'), null)
  assert.equal(parseMonthKey('0099-08'), null)
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

// ─── Tablou de bord admin (#81) ───────────────────────────────────────────────

const project = extra => ({
  id: 'p1',
  title: 'Proiect',
  client_name: null,
  lifecycle_status: 'active',
  ...extra,
})

const payload = (projects, events = []) => ({
  projects,
  events,
  phases: [],
  role: 'admin',
  user_id: 'u1',
})

const row = extra => ({
  id: 'p1',
  title: 'Proiect',
  client_name: null,
  active: true,
  total: 0,
  done: 0,
  overdue: 0,
  next_deadline: null,
  ...extra,
})

test('un proiect fără niciun element rămâne în tabel, nu dispare din el', () => {
  const rows = buildProjectDashboardRows(payload([project({ id: 'gol' })]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].total, 0)
  assert.equal(rows[0].done, 0)
  assert.equal(rows[0].next_deadline, null)
})

test('numărătoarea urmează exact starea calculată de calendar', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project()],
      [
        // Finalizat după termen: rămâne finalizat, nu se numără la depășite.
        event({ id: 'a', done: true, deadline_at: dayOffset(-5) }),
        event({ id: 'b', done: false, deadline_at: dayOffset(-2) }),
        event({ id: 'c', done: false, deadline_at: dayOffset(3) }),
        event({ id: 'd', done: false, deadline_at: null }),
      ]
    )
  )
  assert.equal(rows[0].total, 4)
  assert.equal(rows[0].done, 1)
  assert.equal(rows[0].overdue, 1)
  assert.equal(rows[0].next_deadline, dayOffset(3))
})

test('un element „în pregătire" cu termen depășit se numără la depășite', () => {
  const rows = buildProjectDashboardRows(
    payload([project()], [event({ visibility: 'draft', done: false, deadline_at: dayOffset(-1) })])
  )
  assert.equal(rows[0].overdue, 1)
})

test('următorul termen sare peste cele trecute și peste cele finalizate', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project()],
      [
        event({ id: 'gata', done: true, deadline_at: dayOffset(1) }),
        event({ id: 'vechi', done: false, deadline_at: dayOffset(-4) }),
        event({ id: 'urmator', done: false, deadline_at: dayOffset(6) }),
      ]
    )
  )
  assert.equal(rows[0].next_deadline, dayOffset(6))
})

test('doar „active" înseamnă în lucru; orice altă valoare e proiect încheiat', () => {
  assert.equal(isProjectActive({ lifecycle_status: 'active' }), true)
  for (const value of ['completed', 'archived', 'cancelled', 'suspended', 'stare-noua', '']) {
    assert.equal(isProjectActive({ lifecycle_status: value }), false)
  }
})

test('ordinea implicită pune primele proiectele cu termene depășite', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project({ id: 'calm' }), project({ id: 'urgent' }), project({ id: 'depasit' })],
      [
        event({ id: '1', project_id: 'calm', deadline_at: dayOffset(20) }),
        event({ id: '2', project_id: 'urgent', deadline_at: dayOffset(2) }),
        event({ id: '3', project_id: 'depasit', deadline_at: dayOffset(-1) }),
      ]
    )
  )
  assert.deepEqual(
    sortProjectRows(rows, 'urgency', 'asc').map(r => r.id),
    ['depasit', 'urgent', 'calm']
  )
})

test('proiectele fără termen viitor stau la final în ambele sensuri', () => {
  const rows = [row({ id: 'fara', title: 'A' }), row({ id: 'cu', title: 'B', next_deadline: dayOffset(5) })]
  assert.equal(sortProjectRows(rows, 'deadline', 'asc').at(-1).id, 'fara')
  assert.equal(sortProjectRows(rows, 'deadline', 'desc').at(-1).id, 'fara')
})

test('„finalizate" se sortează pe raport, nu pe numărul brut', () => {
  const rows = [
    row({ id: 'aproape', title: 'A', total: 4, done: 3 }),
    row({ id: 'mult', title: 'B', total: 40, done: 5 }),
    row({ id: 'gol', title: 'C' }),
  ]
  // Crescător: cel mai puțin avansat întâi. „5 din 40" e mai puțin avansat
  // decât „3 din 4", deși numărul brut e mai mare.
  assert.deepEqual(sortProjectRows(rows, 'done', 'asc').map(r => r.id), ['mult', 'aproape', 'gol'])
  assert.deepEqual(sortProjectRows(rows, 'done', 'desc').map(r => r.id), ['aproape', 'mult', 'gol'])
})

test('a treia apăsare pe un antet întoarce tabelul la ordinea implicită', () => {
  // Prima apăsare pe „depășite" scoate problemele în față, deci descrescător.
  const first = nextProjectSort({ sort: 'urgency', direction: 'asc' }, 'overdue')
  assert.deepEqual(first, { sort: 'overdue', direction: 'desc' })
  const second = nextProjectSort(first, 'overdue')
  assert.deepEqual(second, { sort: 'overdue', direction: 'asc' })
  assert.deepEqual(nextProjectSort(second, 'overdue'), { sort: 'urgency', direction: 'asc' })
})

test('starea implicită a tabelului nu lasă nimic în URL', () => {
  const params = new URLSearchParams()
  writeProjectSort(params, { sort: 'urgency', direction: 'asc' })
  writeShowEnded(params, false)
  assert.equal(params.toString(), '')
})

test('un tabel sortat se redeschide identic', () => {
  const params = new URLSearchParams()
  writeProjectSort(params, { sort: 'done', direction: 'desc' })
  writeShowEnded(params, true)

  const reopened = new URLSearchParams(params.toString())
  assert.deepEqual(readProjectSort(reopened), { sort: 'done', direction: 'desc' })
  assert.equal(readShowEnded(reopened), true)
})

test('sensul se scrie în URL doar când se abate de la prima apăsare', () => {
  const params = new URLSearchParams()
  writeProjectSort(params, { sort: 'overdue', direction: 'desc' })
  assert.equal(params.get('dir'), null)
  writeProjectSort(params, { sort: 'overdue', direction: 'asc' })
  assert.equal(params.get('dir'), 'asc')
})

test('o coloană necunoscută din URL cade pe ordinea implicită', () => {
  assert.deepEqual(readProjectSort(new URLSearchParams('sort=stadiu&dir=desc')), {
    sort: 'urgency',
    direction: 'asc',
  })
})
