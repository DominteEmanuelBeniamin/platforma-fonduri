import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GENERAL_PHASE_ID,
  UNASSIGNED_OWNER_ID,
  activeFilterCount,
  SEARCH_THRESHOLD,
  buildProjectDashboardRows,
  clearCalendarParams,
  countLabel,
  dateKey,
  deadlineKey,
  defaultFilters,
  eventProgress,
  eventWaitingOn,
  filterEvents,
  filterProjectRows,
  isActivityDone,
  isProjectActive,
  isRequestDone,
  isUrgentDeadline,
  monthGridDays,
  monthKey,
  nextProjectSort,
  parseMonthKey,
  projectCalendarHref,
  readFiltersFromParams,
  readProjectSort,
  readSearch,
  readShowEnded,
  requestOwnerId,
  sortProjectRows,
  summarizeProjectRows,
  writeFiltersToParams,
  writeProjectSort,
  writeSearch,
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
  status: 'pending',
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
  automatic_reminders_enabled: true,
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
  oldest_overdue_days: null,
  due_soon: 0,
  undated: 0,
  waiting_us: 0,
  waiting_client: 0,
  drafts: 0,
  activities: { done: 0, total: 0 },
  requests: { done: 0, total: 0 },
  reminders_off: false,
  overdue_events: [],
  upcoming_events: [],
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

// ─── Cine e dator cu munca rămasă ─────────────────────────────────────────────

test('cererea în verificare așteaptă echipa; celelalte, clientul', () => {
  assert.equal(eventWaitingOn(event({ status: 'review' })), 'us')
  assert.equal(eventWaitingOn(event({ status: 'pending' })), 'client')
  assert.equal(eventWaitingOn(event({ status: 'rejected' })), 'client')
  // Statusul e `text` liber în bază: o valoare nouă cade la client, nu se
  // strecoară tăcut în munca echipei.
  assert.equal(eventWaitingOn(event({ status: 'stare-noua' })), 'client')
  assert.equal(eventWaitingOn(event({ status: null })), 'client')
})

test('activitatea nefinalizată e mereu muncă internă, indiferent de status', () => {
  assert.equal(eventWaitingOn(event({ kind: 'activity', status: 'pending' })), 'us')
  assert.equal(eventWaitingOn(event({ kind: 'activity', status: 'stare-noua' })), 'us')
})

test('ce e finalizat nu mai așteaptă pe nimeni', () => {
  assert.equal(eventWaitingOn(event({ done: true, status: 'approved' })), null)
  assert.equal(eventWaitingOn(event({ kind: 'activity', done: true, status: 'completed' })), null)
})

test('cele două coloane de așteptare acoperă exact munca rămasă', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project()],
      [
        event({ id: 'a', status: 'approved', done: true }),
        event({ id: 'b', status: 'review' }),
        event({ id: 'c', status: 'pending' }),
        event({ id: 'd', status: 'rejected' }),
        event({ id: 'e', kind: 'activity', status: 'pending' }),
      ]
    )
  )
  assert.equal(rows[0].waiting_us, 2)
  assert.equal(rows[0].waiting_client, 2)
  assert.equal(rows[0].waiting_us + rows[0].waiting_client, rows[0].total - rows[0].done)
})

// ─── Numerele din rând ────────────────────────────────────────────────────────

test('vechimea depășirii e a celui mai vechi termen, nu a ultimului citit', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project()],
      [
        event({ id: 'recent', deadline_at: dayOffset(-2) }),
        event({ id: 'vechi', deadline_at: dayOffset(-30) }),
        event({ id: 'mijloc', deadline_at: dayOffset(-9) }),
      ]
    )
  )
  assert.equal(rows[0].overdue, 3)
  assert.equal(rows[0].oldest_overdue_days, 30)
  // Lista din rândul desfășurat începe cu cea mai veche.
  assert.deepEqual(rows[0].overdue_events.map(e => e.id), ['vechi', 'mijloc', 'recent'])
})

test('un proiect fără depășiri n-are vechime, nu are vechimea zero', () => {
  const rows = buildProjectDashboardRows(payload([project()], [event({ deadline_at: dayOffset(4) })]))
  assert.equal(rows[0].oldest_overdue_days, null)
})

test('„săptămâna asta" ia termenele din 7 zile, fără cele depășite', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project()],
      [
        event({ id: 'depasit', deadline_at: dayOffset(-1) }),
        event({ id: 'azi', deadline_at: dayOffset(0) }),
        event({ id: 'limita', deadline_at: dayOffset(7) }),
        event({ id: 'dupa', deadline_at: dayOffset(8) }),
        event({ id: 'gata', done: true, status: 'approved', deadline_at: dayOffset(2) }),
        event({ id: 'fara-termen', deadline_at: null }),
      ]
    )
  )
  assert.equal(rows[0].due_soon, 2)
  assert.equal(rows[0].overdue, 1)
  assert.deepEqual(rows[0].upcoming_events.map(e => e.id), ['azi', 'limita', 'dupa'])
})

test('numerele se desfac pe sursă, ca raportul general să poată fi citit', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project()],
      [
        event({ id: 'a1', kind: 'activity', done: true, status: 'completed' }),
        event({ id: 'a2', kind: 'activity' }),
        event({ id: 'c1', done: true, status: 'approved' }),
        event({ id: 'c2' }),
        event({ id: 'c3' }),
      ]
    )
  )
  assert.deepEqual(rows[0].activities, { done: 1, total: 2 })
  assert.deepEqual(rows[0].requests, { done: 1, total: 3 })
  assert.equal(rows[0].total, 5)
  assert.equal(rows[0].done, 2)
})

test('„în pregătire" numără doar munca rămasă, nu și ce s-a terminat în draft', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project()],
      [
        event({ id: 'draft-deschis', visibility: 'draft' }),
        event({ id: 'draft-gata', visibility: 'draft', done: true, status: 'approved' }),
        event({ id: 'publicat', visibility: 'published' }),
      ]
    )
  )
  assert.equal(rows[0].drafts, 1)
})

test('rezumatul de sus adună exact rândurile primite', () => {
  const summary = summarizeProjectRows([
    row({ id: 'a', overdue: 2, due_soon: 1, waiting_us: 3 }),
    row({ id: 'b', overdue: 0, due_soon: 4, waiting_us: 1 }),
    row({ id: 'c', overdue: 5, due_soon: 0, waiting_us: 0 }),
  ])
  assert.deepEqual(summary, {
    projects: 3,
    overdue: 7,
    projectsWithOverdue: 2,
    dueSoon: 5,
    waitingUs: 4,
  })
})

// ─── Sortarea pe coloanele noi ────────────────────────────────────────────────

test('„de rezolvat" sortează pe munca de la noi, apoi pe cea de la client', () => {
  const rows = [
    row({ id: 'putin', waiting_us: 1, waiting_client: 90 }),
    row({ id: 'mult', waiting_us: 9, waiting_client: 0 }),
    row({ id: 'egal', waiting_us: 1, waiting_client: 95 }),
  ]
  assert.deepEqual(sortProjectRows(rows, 'waiting', 'desc').map(r => r.id), ['mult', 'egal', 'putin'])
})

test('la fel de multe depășiri, cea mai veche trece prima', () => {
  const rows = [
    row({ id: 'proaspat', overdue: 3, oldest_overdue_days: 2 }),
    row({ id: 'vechi', overdue: 3, oldest_overdue_days: 40 }),
  ]
  assert.deepEqual(sortProjectRows(rows, 'urgency', 'asc').map(r => r.id), ['vechi', 'proaspat'])
  assert.deepEqual(sortProjectRows(rows, 'overdue', 'desc').map(r => r.id), ['vechi', 'proaspat'])
})

// ─── Căutarea ─────────────────────────────────────────────────────────────────

test('căutarea trece peste diacritice și peste majuscule', () => {
  const rows = [
    row({ id: 'a', title: 'ACHIZIȚIE miniexcavator' }),
    row({ id: 'b', title: 'Femeia antreprenor' }),
  ]
  assert.deepEqual(filterProjectRows(rows, 'achizitie').map(r => r.id), ['a'])
  assert.deepEqual(filterProjectRows(rows, 'ACHIZIȚIE').map(r => r.id), ['a'])
})

test('căutarea prinde și clientul, nu doar titlul', () => {
  const rows = [
    row({ id: 'a', title: 'Proiect unu', client_name: 'TAC SRL' }),
    row({ id: 'b', title: 'Proiect doi', client_name: null }),
  ]
  assert.deepEqual(filterProjectRows(rows, 'tac').map(r => r.id), ['a'])
})

test('căutarea goală nu filtrează nimic', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b' })]
  assert.equal(filterProjectRows(rows, '   ').length, 2)
  assert.equal(SEARCH_THRESHOLD > 0, true)
})

test('căutarea se scrie în URL doar când chiar caută ceva', () => {
  const params = new URLSearchParams()
  writeSearch(params, '  ')
  assert.equal(params.toString(), '')
  writeSearch(params, '  achizitie ')
  assert.equal(readSearch(params), 'achizitie')
  writeSearch(params, '')
  assert.equal(readSearch(params), '')
  assert.equal(params.toString(), '')
})

// ─── Puntea către calendar ────────────────────────────────────────────────────

test('linkul către calendar duce în lista proiectului, filtrat pe depășite la cerere', () => {
  const plain = new URL(projectCalendarHref('p1'), 'https://x')
  assert.equal(plain.pathname, '/calendar')
  assert.equal(plain.searchParams.get('cv'), 'list')
  assert.equal(plain.searchParams.get('cj'), 'p1')
  assert.equal(plain.searchParams.get('cs'), null)

  const overdue = new URL(projectCalendarHref('p1', { overdueOnly: true }), 'https://x')
  assert.equal(overdue.searchParams.get('cs'), 'overdue')

  // Cheile trebuie să fie chiar cele pe care le citește calendarul.
  const filters = readFiltersFromParams(overdue.searchParams, defaultFilters('admin', 'u1'))
  assert.deepEqual(filters.projectIds, ['p1'])
  assert.deepEqual(filters.progress, ['overdue'])
})

// ─── Numeralul din linia de rezumat ───────────────────────────────────────────

test('„de" apare peste 20, dar nu la 101–119', () => {
  assert.equal(countLabel(1, 'termen', 'termene'), '1 termen')
  assert.equal(countLabel(3, 'termen', 'termene'), '3 termene')
  assert.equal(countLabel(19, 'termen', 'termene'), '19 termene')
  assert.equal(countLabel(21, 'termen', 'termene'), '21 de termene')
  assert.equal(countLabel(100, 'termen', 'termene'), '100 de termene')
  assert.equal(countLabel(118, 'termen', 'termene'), '118 termene')
  assert.equal(countLabel(0, 'termen', 'termene'), '0 termene')
})

test('căutarea din două cuvinte trece peste spațiul dintre ele', () => {
  const rows = [
    row({ id: 'a', title: 'Femeia antreprenor', client_name: 'TAC SRL' }),
    row({ id: 'b', title: 'Femeia de serviciu' }),
  ]
  assert.deepEqual(filterProjectRows(rows, 'femeia ant').map(r => r.id), ['a'])
  // Titlul și clientul se caută ca un singur șir, deci un cuvânt din fiecare
  // se potrivește doar în ordinea în care sunt scrise.
  assert.deepEqual(filterProjectRows(rows, 'antreprenor tac').map(r => r.id), ['a'])
  // Capetele nu contează; interiorul, da.
  assert.deepEqual(filterProjectRows(rows, '  femeia ant  ').map(r => r.id), ['a'])
})

test('reminderele oprite ajung în rând; necunoscutul rămâne pornit', () => {
  const rows = buildProjectDashboardRows(
    payload([
      project({ id: 'oprit', automatic_reminders_enabled: false }),
      project({ id: 'pornit', automatic_reminders_enabled: true }),
      // Un proiect citit fără coloană nu trebuie marcat ca oprit: aceeași gardă
      // ca în cronul de remindere și în `lib/automatic-reminders`.
      project({ id: 'necunoscut', automatic_reminders_enabled: undefined }),
    ])
  )
  assert.deepEqual(rows.map(r => [r.id, r.reminders_off]), [
    ['oprit', true],
    ['pornit', false],
    ['necunoscut', false],
  ])
})

test('munca fără nicio dată se numără separat, nu dispare', () => {
  const rows = buildProjectDashboardRows(
    payload(
      [project()],
      [
        event({ id: 'planificat', deadline_at: dayOffset(5) }),
        event({ id: 'nedatat-1', deadline_at: null }),
        event({ id: 'nedatat-2', deadline_at: null }),
        // Finalizat fără termen: n-are ce plănui, deci nu se numără.
        event({ id: 'gata', done: true, status: 'approved', deadline_at: null }),
        // Depășitele au mereu termen, deci n-ating numărul.
        event({ id: 'depasit', deadline_at: dayOffset(-3) }),
      ]
    )
  )
  assert.equal(rows[0].undated, 2)
  assert.equal(rows[0].total, 5)
  // Un singur termen viitor din cinci elemente: exact cazul pe care coloana
  // „Următorul termen" îl arăta ca proiect planificat.
  assert.equal(rows[0].upcoming_events.length, 1)
})
