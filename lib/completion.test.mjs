import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activityCompletionConfirm,
  activityProgress,
  canCloseRequest,
  completeRefusal,
  countHiddenRoots,
  hiddenFinalItems,
  hiddenFinalSummary,
  isActivityFinal,
  isPhaseFinal,
  isRequestFinal,
  mergeVisibleOrder,
  phaseCompletionConfirm,
  phaseProgress,
  progressLabel,
  reopenRefusal,
  requestCloseConfirm,
  requestCloseRefusal,
  requestReopenConfirm,
  requestReopenRefusal,
} from './completion.ts'

// ─── Ce e finalizat ───────────────────────────────────────────────────────────

test('cererea e finalizată când e aprobată sau închisă', () => {
  assert.equal(isRequestFinal({ status: 'approved' }), true)
  assert.equal(isRequestFinal({ status: 'closed' }), true)
  for (const status of ['pending', 'review', 'rejected', null, undefined, 'stare-noua']) {
    assert.equal(isRequestFinal({ status }), false, String(status))
  }
})

test('un document trimis clientului nu e niciodată finalizat (D12)', () => {
  assert.equal(isRequestFinal({ status: 'approved', is_outgoing: true }), false)
  assert.equal(isRequestFinal({ status: 'closed', is_outgoing: true }), false)
  assert.equal(isRequestFinal({ status: 'pending', is_outgoing: true }), false)
})

test('faza și activitatea sunt finalizate doar pe `completed`', () => {
  assert.equal(isActivityFinal({ status: 'completed' }), true)
  assert.equal(isPhaseFinal({ status: 'completed' }), true)
  for (const status of ['pending', 'in_progress', 'skipped', 'blocked', null]) {
    assert.equal(isActivityFinal({ status }), false, String(status))
    assert.equal(isPhaseFinal({ status }), false, String(status))
  }
})

test('se închid doar cererile „De încărcat" și „Respins" (D3, D12)', () => {
  assert.equal(canCloseRequest({ status: 'pending' }), true)
  assert.equal(canCloseRequest({ status: 'rejected' }), true)
  for (const status of ['review', 'approved', 'closed', null]) {
    assert.equal(canCloseRequest({ status }), false, String(status))
  }
  assert.equal(canCloseRequest({ status: 'pending', is_outgoing: true }), false)
  assert.equal(canCloseRequest({ status: 'pending', deleted_at: '2026-10-01T00:00:00Z' }), false)
})

// ─── Refuzuri ────────────────────────────────────────────────────────────────

test('refuzul închiderii are statusul și motivul potrivit', () => {
  assert.equal(requestCloseRefusal({ status: 'pending' }), null)
  assert.equal(requestCloseRefusal({ status: 'rejected' }), null)
  assert.deepEqual(requestCloseRefusal({ status: 'review' }), { status: 409, message: 'Verifică întâi documentele încărcate.' })
  assert.equal(requestCloseRefusal({ status: 'approved' }).status, 409)
  assert.equal(requestCloseRefusal({ status: 'closed' }).status, 409)
  assert.equal(requestCloseRefusal({ status: 'pending', deleted_at: '2026-10-01T00:00:00Z' }).status, 409)
  // Documentul trimis clientului e o cerere greșită, nu un conflict de stare.
  assert.equal(requestCloseRefusal({ status: 'pending', is_outgoing: true }).status, 400)
})

test('redeschiderea cere o cerere închisă, cu stare de revenire validă', () => {
  assert.equal(requestReopenRefusal({ status: 'closed', status_before_close: 'pending' }), null)
  assert.equal(requestReopenRefusal({ status: 'closed', status_before_close: 'rejected' }), null)
  assert.equal(requestReopenRefusal({ status: 'pending', status_before_close: null }).status, 409)
  assert.equal(requestReopenRefusal({ status: 'closed', status_before_close: 'review' }).status, 409)
  assert.equal(requestReopenRefusal({ status: 'closed', status_before_close: 'pending', deleted_at: 'x' }).status, 409)
})

test('faza și activitatea nu se finalizează de două ori și nu se redeschid din lucru', () => {
  assert.equal(completeRefusal('phase', 'pending'), null)
  assert.equal(completeRefusal('activity', 'in_progress'), null)
  assert.deepEqual(completeRefusal('phase', 'completed'), { status: 409, message: 'Faza e deja finalizată.' })
  assert.deepEqual(completeRefusal('activity', 'completed'), { status: 409, message: 'Activitatea e deja finalizată.' })
  assert.equal(reopenRefusal('phase', 'completed'), null)
  assert.equal(reopenRefusal('activity', 'pending').status, 409)
  assert.match(reopenRefusal('phase', 'in_progress').message, /^Faza nu e finalizată/)
  // O stare scrisă din bază (blocked, skipped) nu e „deja în lucru”: mesajul nu pretinde asta.
  assert.equal(reopenRefusal('activity', 'blocked').message, 'Activitatea nu e finalizată.')
})

// ─── Ascunderea ───────────────────────────────────────────────────────────────

const phase = (id, status, activities) => ({ id, name: id, status, activities })
const activity = (id, status) => ({ id, name: id, status })
const request = (id, activityId, status, extra = {}) => ({ id, activity_id: activityId, status, ...extra })

test('o fază finalizată cu o cerere în verificare rămâne vizibilă', () => {
  const phases = [phase('f1', 'completed', [activity('a1', 'completed')])]
  const requests = [request('r1', 'a1', 'review'), request('r2', 'a1', 'approved')]
  const hidden = hiddenFinalItems(phases, requests)
  assert.equal(hidden.phases.has('f1'), false)
  assert.equal(hidden.activities.has('a1'), false)
  // Copiii finalizați ai unui părinte vizibil se ascund.
  assert.deepEqual([...hidden.requests], ['r2'])
})

test('o activitate finalizată fără cereri se ascunde, iar faza ei doar dacă e și ea finalizată', () => {
  const requests = []
  assert.deepEqual(
    [...hiddenFinalItems([phase('f1', 'in_progress', [activity('a1', 'completed')])], requests).activities],
    ['a1'],
  )
  const hidden = hiddenFinalItems([phase('f1', 'completed', [activity('a1', 'completed')])], requests)
  assert.equal(hidden.phases.has('f1'), true)
  assert.equal(hidden.activities.has('a1'), true)
})

test('o activitate nefinalizată nu se ascunde, chiar dacă toate cererile ei sunt gata', () => {
  const hidden = hiddenFinalItems(
    [phase('f1', 'completed', [activity('a1', 'in_progress')])],
    [request('r1', 'a1', 'approved'), request('r2', 'a1', 'closed')],
  )
  assert.equal(hidden.activities.has('a1'), false)
  assert.equal(hidden.phases.has('f1'), false)
  assert.deepEqual([...hidden.requests].sort(), ['r1', 'r2'])
})

test('un document trimis clientului ține activitatea și faza vizibile (D12)', () => {
  const hidden = hiddenFinalItems(
    [phase('f1', 'completed', [activity('a1', 'completed')])],
    [request('r1', 'a1', 'approved'), request('m1', 'a1', 'pending', { is_outgoing: true })],
  )
  assert.equal(hidden.activities.has('a1'), false)
  assert.equal(hidden.phases.has('f1'), false)
  assert.equal(hidden.requests.has('m1'), false)
})

test('cererile generale și cele șterse', () => {
  const hidden = hiddenFinalItems(
    [],
    [
      request('g1', null, 'closed'),
      request('g2', null, 'pending'),
      request('sters', null, 'approved', { deleted_at: '2026-10-01T00:00:00Z' }),
    ],
  )
  assert.deepEqual([...hidden.requests], ['g1'])
})

test('o țintă dezvăluită apare împreună cu strămoșii ei', () => {
  const phases = [phase('f1', 'completed', [activity('a1', 'completed'), activity('a2', 'completed')])]
  const requests = [request('r1', 'a1', 'approved'), request('r2', 'a1', 'closed')]

  const prinCerere = hiddenFinalItems(phases, requests, new Set(['r1']))
  assert.equal(prinCerere.phases.has('f1'), false)
  assert.equal(prinCerere.activities.has('a1'), false)
  assert.equal(prinCerere.requests.has('r1'), false)
  // Restul rămâne ascuns: se dezvăluie ținta, nu tot.
  assert.equal(prinCerere.requests.has('r2'), true)
  assert.equal(prinCerere.activities.has('a2'), true)

  const prinActivitate = hiddenFinalItems(phases, requests, new Set(['a2']))
  assert.equal(prinActivitate.phases.has('f1'), false)
  assert.equal(prinActivitate.activities.has('a2'), false)
  assert.equal(prinActivitate.activities.has('a1'), true)

  const prinFaza = hiddenFinalItems(phases, requests, new Set(['f1']))
  assert.equal(prinFaza.phases.has('f1'), false)
  assert.equal(prinFaza.activities.has('a1'), true)

  // Un id necunoscut (element șters între timp) nu strică nimic.
  assert.equal(hiddenFinalItems(phases, requests, new Set(['nu-exista'])).phases.has('f1'), true)
})

test('numărul de ascunse nu socotește de două ori ce stă sub un părinte ascuns', () => {
  const phases = [
    phase('f1', 'completed', [activity('a1', 'completed')]),
    phase('f2', 'in_progress', [activity('a2', 'completed'), activity('a3', 'pending')]),
  ]
  const requests = [
    request('r1', 'a1', 'approved'),
    request('r2', 'a2', 'closed'),
    request('r3', 'a3', 'approved'),
    request('r4', 'a3', 'pending'),
    request('g1', null, 'approved'),
  ]
  const hidden = hiddenFinalItems(phases, requests)
  // f1 (cu a1 și r1 în ea), a2 (cu r2), r3 din a3 vizibilă, g1 generală
  assert.equal(countHiddenRoots(hidden, phases, requests), 4)
})

// ─── Contoare ─────────────────────────────────────────────────────────────────

test('contoarele de progres', () => {
  assert.deepEqual(phaseProgress({ activities: [activity('a1', 'completed'), activity('a2', 'pending')] }), { done: 1, total: 2 })
  assert.deepEqual(phaseProgress({ activities: null }), { done: 0, total: 0 })
  const requests = [
    request('r1', 'a1', 'approved'),
    request('r2', 'a1', 'closed'),
    request('r3', 'a1', 'review'),
    request('m1', 'a1', 'pending', { is_outgoing: true }),
    request('sters', 'a1', 'approved', { deleted_at: 'x' }),
    request('alta', 'a2', 'approved'),
  ]
  // Documentele trimise clientului nu intră la număr, ca până acum.
  assert.deepEqual(activityProgress('a1', requests), { done: 2, total: 3 })
})

test('eticheta de progres se acordă și pune „de" peste 20', () => {
  assert.equal(progressLabel({ done: 3, total: 5 }, 'activitate', 'activități'), '3 din 5 activități finalizate')
  assert.equal(progressLabel({ done: 0, total: 1 }, 'activitate', 'activități'), '0 din 1 activitate finalizată')
  assert.equal(progressLabel({ done: 2, total: 21 }, 'cerere', 'cereri'), '2 din 21 de cereri finalizate')
  assert.equal(progressLabel({ done: 0, total: 0 }, 'activitate', 'activități'), '0 activități')
})

// ─── Reordonarea ──────────────────────────────────────────────────────────────

test('reordonarea printre cele vizibile păstrează locurile celor ascunse', () => {
  // ascunse la început
  assert.deepEqual(mergeVisibleOrder(['h', 'a', 'b', 'c'], ['c', 'a', 'b']), ['h', 'c', 'a', 'b'])
  // ascunse la mijloc
  assert.deepEqual(mergeVisibleOrder(['a', 'h1', 'b', 'h2', 'c'], ['b', 'c', 'a']), ['b', 'h1', 'c', 'h2', 'a'])
  // ascunse la final
  assert.deepEqual(mergeVisibleOrder(['a', 'b', 'h'], ['b', 'a']), ['b', 'a', 'h'])
  // nimic ascuns: noua ordine, întocmai
  assert.deepEqual(mergeVisibleOrder(['a', 'b', 'c'], ['c', 'b', 'a']), ['c', 'b', 'a'])
  // o singură vizibilă: nimic de mutat
  assert.deepEqual(mergeVisibleOrder(['h1', 'a', 'h2'], ['a']), ['h1', 'a', 'h2'])
})

test('reordonarea ignoră id-uri străine și dubluri', () => {
  assert.deepEqual(mergeVisibleOrder(['a', 'h', 'b'], ['b', 'x', 'a', 'b']), ['b', 'h', 'a'])
  assert.deepEqual(mergeVisibleOrder([], ['a']), [])
})

// ─── Confirmări ───────────────────────────────────────────────────────────────

test('confirmarea fazei spune ce rămâne deschis și nu promite că dispare', () => {
  const f = phase('Contractare', 'in_progress', [activity('a1', 'completed'), activity('a2', 'pending')])
  const requests = [
    request('r1', 'a1', 'pending'),
    request('r2', 'a2', 'review'),
    request('r3', 'a2', 'approved'),
    request('m1', 'a2', 'pending', { is_outgoing: true }),
  ]
  const dialog = phaseCompletionConfirm(f, requests)
  assert.match(dialog.title, /„Contractare”/)
  assert.match(dialog.description, /O activitate din ea nu e finalizată/)
  assert.match(dialog.description, /2 cereri de documente sunt încă deschise: rămân deschise și își păstrează reminderele/)
  assert.doesNotMatch(dialog.description, /nu mai apare/)
  assert.equal(dialog.confirmText, 'Marchează ca finalizată')
})

test('confirmarea fazei anunță că dispare doar când chiar dispare', () => {
  const f = phase('F', 'in_progress', [activity('a1', 'completed')])
  assert.match(phaseCompletionConfirm(f, [request('r1', 'a1', 'approved')]).description, /faza nu mai apare în listă/)
  // Un document trimis clientului o ține pe loc.
  assert.doesNotMatch(
    phaseCompletionConfirm(f, [request('m1', 'a1', 'pending', { is_outgoing: true })]).description,
    /nu mai apare/,
  )
})

test('confirmarea activității numără cererile deschise', () => {
  const a = activity('Plan de afaceri', 'in_progress')
  const una = activityCompletionConfirm(a, [request('r1', 'Plan de afaceri', 'rejected')])
  assert.match(una.description, /O cerere de documente e încă deschisă/)
  assert.doesNotMatch(una.description, /nu mai apare/)
  const niciuna = activityCompletionConfirm(a, [request('r1', 'Plan de afaceri', 'closed')])
  assert.match(niciuna.description, /activitatea nu mai apare în listă/)
})

test('confirmările cererii', () => {
  const inchide = requestCloseConfirm('Bilanț 2025')
  assert.match(inchide.title, /„Bilanț 2025”/)
  assert.match(inchide.description, /nu mai primește remindere/)
  assert.equal(inchide.confirmText, 'Închide cererea')
  assert.match(requestReopenConfirm('Bilanț 2025', 'rejected').description, /Revine la „Respins”/)
  assert.match(requestReopenConfirm('Bilanț 2025', 'pending').description, /Revine la „Așteaptă răspuns”/)
})

test('rândul celor ascunse spune câte și cum se arată', () => {
  assert.deepEqual(hiddenFinalSummary(1, 4, 'activitate', 'activități'), { text: '1 activitate finalizată ascunsă', action: 'Arată' })
  assert.deepEqual(hiddenFinalSummary(3, 4, 'cerere', 'cereri'), { text: '3 cereri finalizate ascunse', action: 'Arată' })
  assert.deepEqual(hiddenFinalSummary(21, 30, 'cerere', 'cereri'), { text: '21 de cereri finalizate ascunse', action: 'Arată' })
  assert.deepEqual(hiddenFinalSummary(1, 2, 'fază', 'faze'), { text: '1 fază finalizată ascunsă', action: 'Arată' })
  // Când nu mai rămâne nimic vizibil, rândul ține loc de listă.
  assert.deepEqual(hiddenFinalSummary(5, 5, 'activitate', 'activități'), { text: 'Toate cele 5 activități sunt finalizate.', action: 'Arată-le' })
  assert.deepEqual(hiddenFinalSummary(1, 1, 'cerere', 'cereri'), { text: 'Singura cerere e finalizată.', action: 'Arat-o' })
})
