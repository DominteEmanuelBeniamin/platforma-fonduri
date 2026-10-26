import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSearchIndex, searchIndex } from './projectSearch.ts'

const maria = { id: 'maria', full_name: 'Maria Ionescu', email: 'maria@example.invalid' }
const ion = { id: 'ion', full_name: 'Ion Popescu', email: 'ion@example.invalid' }
const activity = {
  id: 'activity', name: 'Verificare', status: 'in_progress', order_index: 0,
  assigned_to: maria.id, assigned_user: maria,
}
const phases = [{
  id: 'phase', name: 'Pregătire', status: 'in_progress', order_index: 0,
  project_status_id: 'status', activities: [activity],
}]
const request = extra => ({
  id: 'request', name: 'Declarație', status: 'pending',
  activity_id: activity.id, activity: { id: activity.id, name: activity.name, phase_id: 'phase' },
  assigned_to: null, assigned_consultant: null,
  ...extra,
})
const ids = hits => hits.map(hit => hit.item.id)

test('cererea se găsește după consultantul moștenit din activitatea-părinte', () => {
  const index = buildSearchIndex(phases, [request()])
  const hits = searchIndex(index, 'declaratie maria')
  assert.deepEqual(ids(hits), ['request'])
  const owner = hits[0].matches.find(match => match.key === 'responsabil')
  assert.equal(owner.value, maria.full_name)
  assert.equal(owner.shown, false)
  assert.deepEqual(owner.ranges.map(([start, end]) => owner.value.slice(start, end)), ['Maria'])
})

test('responsabilul direct al cererii are prioritate față de consultantul activității', () => {
  const index = buildSearchIndex(phases, [request({ assigned_to: ion.id, assigned_consultant: ion })], {
    generalConsultant: maria,
  })
  assert.deepEqual(ids(searchIndex(index, 'declarație ion')), ['request'])
  assert.deepEqual(ids(searchIndex(index, 'declarație maria')), [])
})

test('cererea generală moștenește consultantul de proiect disponibil, păstrând prioritatea atribuirii directe', () => {
  const general = request({ activity_id: null, activity: null })
  assert.deepEqual(ids(searchIndex(buildSearchIndex([], [general], { generalConsultant: maria }), 'declarație maria')), ['request'])
  assert.deepEqual(ids(searchIndex(buildSearchIndex([], [general]), 'declarație maria')), [])
  assert.deepEqual(ids(searchIndex(buildSearchIndex([], [general], { generalConsultant: null }), 'declarație maria')), [])

  const assigned = { ...general, assigned_to: ion.id, assigned_consultant: ion }
  const index = buildSearchIndex([], [assigned], { generalConsultant: maria })
  assert.deepEqual(ids(searchIndex(index, 'declarație ion')), ['request'])
  assert.deepEqual(ids(searchIndex(index, 'declarație maria')), [])
})

test('cererea dintr-o activitate fără responsabil nu moștenește consultantul general', () => {
  const unassigned = [{
    ...phases[0], activities: [{ ...activity, assigned_to: null, assigned_user: null }],
  }]
  const index = buildSearchIndex(unassigned, [request()], { generalConsultant: maria })
  assert.deepEqual(ids(searchIndex(index, 'declarație maria')), [])

  const missingActivity = buildSearchIndex([], [request()], { generalConsultant: maria })
  assert.deepEqual(ids(searchIndex(missingActivity, 'declarație maria')), [])
})

test('pickerul de documente din chat păstrează responsabilii moșteniți din indexul comun', () => {
  const index = buildSearchIndex(phases, [
    request(),
    request({ id: 'general', activity_id: null, activity: null }),
  ], { generalConsultant: maria })
  const documentsOnly = index.filter(result => result.type === 'document_request')
  assert.deepEqual(ids(searchIndex(documentsOnly, 'declarație maria')), ['request', 'general'])
})

test('responsabilul moștenit fără nume rămâne căutabil după email', () => {
  const unnamed = { ...maria, full_name: ' ' }
  const index = buildSearchIndex([
    { ...phases[0], activities: [{ ...activity, assigned_user: unnamed }] },
  ], [request()])
  assert.deepEqual(ids(searchIndex(index, 'declarație maria')), ['request'])
  assert.equal(index.find(result => result.id === 'request').fields.find(field => field.key === 'responsabil').value, unnamed.email)
})
