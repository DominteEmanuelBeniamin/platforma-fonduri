import assert from 'node:assert/strict'
import test from 'node:test'
import publishRules from './publish-rules.js'

const { publishBlockers, blockersIntroducedBy, publishBlockedError, BLOCKER_DEADLINE, BLOCKER_ASSIGNEE } = publishRules

test('cererea fără termen și fără responsabil cere ambele', () => {
  assert.deepEqual(publishBlockers({ currentDeadline: null }), [BLOCKER_DEADLINE, BLOCKER_ASSIGNEE])
  assert.deepEqual(publishBlockers({ currentDeadline: '' }), [BLOCKER_DEADLINE, BLOCKER_ASSIGNEE])
})

test('cererea e acoperită de consultantul activității-părinte', () => {
  assert.deepEqual(
    publishBlockers({ currentDeadline: '2026-09-01', currentAssignee: null, parentAssignee: 'uuid' }),
    []
  )
  // cererea generală nu are activitate-părinte, deci are nevoie de al ei
  assert.deepEqual(
    publishBlockers({ currentDeadline: '2026-09-01', currentAssignee: null }),
    [BLOCKER_ASSIGNEE]
  )
  assert.deepEqual(
    publishBlockers({ currentDeadline: '2026-09-01', currentAssignee: 'uuid' }),
    []
  )
})

test('activitatea nu moștenește responsabil de nicăieri', () => {
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: '2026-09-01', parentAssignee: 'uuid' }),
    [BLOCKER_ASSIGNEE]
  )
})

test('activitatea are nevoie și de termen, și de consultant', () => {
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: null, currentAssignee: null }),
    [BLOCKER_DEADLINE, BLOCKER_ASSIGNEE]
  )
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: '2026-09-01', currentAssignee: null }),
    [BLOCKER_ASSIGNEE]
  )
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: '2026-09-01', currentAssignee: 'uuid' }),
    []
  )
})

test('valorile trimise în aceeași cerere contează', () => {
  assert.deepEqual(
    publishBlockers({
      kind: 'activity',
      currentDeadline: null,
      incomingDeadline: '2026-09-01',
      currentAssignee: null,
      incomingAssignee: 'uuid',
    }),
    []
  )
})

test('aceeași cerere nu poate publica și goli câmpul cerut', () => {
  assert.deepEqual(
    publishBlockers({ currentDeadline: '2026-09-01', incomingDeadline: null, parentAssignee: 'uuid' }),
    [BLOCKER_DEADLINE]
  )
  assert.deepEqual(
    publishBlockers({ kind: 'activity', currentDeadline: '2026-09-01', currentAssignee: 'uuid', incomingAssignee: null }),
    [BLOCKER_ASSIGNEE]
  )
})

test('documentele informative sunt exceptate', () => {
  assert.deepEqual(publishBlockers({ isOutgoing: true, currentDeadline: null }), [])
})

test('scutirea informativă nu se întinde peste activități', () => {
  assert.deepEqual(
    publishBlockers({ kind: 'activity', isOutgoing: true, currentDeadline: null, currentAssignee: null }),
    [BLOCKER_DEADLINE, BLOCKER_ASSIGNEE]
  )
})

test('un element publicat înainte de #70 rămâne editabil', () => {
  // 41 de activități și 119 cereri sunt publice fără termen și fără
  // responsabil. Redenumirea uneia nu trimite niciun câmp cerut de regulă și nu
  // trebuie să fie respinsă — altfel devin needitabile.
  assert.deepEqual(
    blockersIntroducedBy({ kind: 'activity', currentDeadline: null, currentAssignee: null }),
    []
  )
  // Nici completarea doar a unuia dintre ele nu se blochează pe lipsa celuilalt.
  assert.deepEqual(
    blockersIntroducedBy({
      kind: 'activity',
      currentDeadline: null, incomingDeadline: '2026-09-01',
      currentAssignee: null,
    }),
    []
  )
})

test('dar un câmp completat nu poate fi golit cât elementul e public', () => {
  assert.deepEqual(
    blockersIntroducedBy({
      kind: 'activity',
      currentDeadline: '2026-09-01', incomingDeadline: null,
      currentAssignee: 'uuid',
    }),
    [BLOCKER_DEADLINE]
  )
  assert.deepEqual(
    blockersIntroducedBy({
      kind: 'activity',
      currentDeadline: '2026-09-01',
      currentAssignee: 'uuid', incomingAssignee: null,
    }),
    [BLOCKER_ASSIGNEE]
  )
})

test('un element publicat nu poate rămâne fără ce i-a cerut publicarea', () => {
  // Aceleași blocaje, alt mesaj: aici nu se publică nimic, se apără un element
  // deja public de o golire care l-ar lăsa incomplet.
  // Retragerea din „Public” nu există, deci mesajul spune ce se poate face în
  // locul golirii (feedback-ul lui Sandu, 21 octombrie 2026).
  const body = publishBlockedError([BLOCKER_DEADLINE], { alreadyPublished: true })
  assert.deepEqual(body.missing, [BLOCKER_DEADLINE])
  assert.equal(
    body.message,
    'Elementul e vizibil clientului, deci trebuie să aibă termen limită. Alege altă dată în loc să ștergi termenul.'
  )
  assert.equal(
    publishBlockedError([BLOCKER_ASSIGNEE], { alreadyPublished: true }).message,
    'Elementul e vizibil clientului, deci trebuie să aibă un consultant atribuit. Alege alt consultant în loc să-l scoți.'
  )
  assert.equal(
    publishBlockedError([BLOCKER_DEADLINE, BLOCKER_ASSIGNEE], { alreadyPublished: true }).message,
    'Elementul e vizibil clientului, deci trebuie să aibă termen limită și un consultant atribuit. Alege alt consultant și altă dată în loc să le golești.'
  )
  for (const blockers of [[BLOCKER_DEADLINE], [BLOCKER_ASSIGNEE], [BLOCKER_DEADLINE, BLOCKER_ASSIGNEE]]) {
    assert.doesNotMatch(publishBlockedError(blockers, { alreadyPublished: true }).message, /Retrage/)
  }
})

test('mesajul de eroare enumeră tot ce lipsește și trece prin apiFetch în `message`', () => {
  const body = publishBlockedError([BLOCKER_DEADLINE, BLOCKER_ASSIGNEE])
  assert.equal(body.message, body.error)
  assert.deepEqual(body.missing, [BLOCKER_DEADLINE, BLOCKER_ASSIGNEE])
  assert.equal(body.message, 'Nu poți publica fără termen limită și un consultant atribuit. Completează, apoi publică.')
})
