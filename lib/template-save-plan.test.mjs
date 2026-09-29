import assert from 'node:assert/strict'
import test from 'node:test'

import { planTemplateSave } from './template-save-plan.ts'

const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ids = {
  template: id(1),
  phaseA: id(2),
  phaseB: id(3),
  activityA: id(4),
  activityB: id(5),
  docCi: id(6),
  docFile: id(7),
  consultant: id(8),
  foreign: id(99),
}
const attachment = { id: id(50), storage_path: 'templates/attachments/model.pdf', original_name: 'model.pdf', order_index: 0 }

const current = {
  id: ids.template,
  name: 'Șablon',
  description: null,
  phases: [
    {
      id: ids.phaseA, name: 'Pregătire', slug: 'pregatire', project_status_id: 's1', order_index: 1,
      activities: [{
        id: ids.activityA, name: 'Colectare', order_index: 1, default_consultant_id: null,
        document_requirements: [
          { id: ids.docCi, name: 'CI', description: null, is_mandatory: true, requirement_type: 'obligatoriu', is_outgoing: false, order_index: 1, attachment_path: null, attachments: [] },
          { id: ids.docFile, name: 'Cerere', description: 'model', is_mandatory: false, requirement_type: 'optional', is_outgoing: false, order_index: 2, attachment_path: attachment.storage_path, attachment_original_name: 'model.pdf', attachments: [attachment] },
        ],
      }],
    },
    {
      id: ids.phaseB, name: 'Depunere', slug: 'depunere', project_status_id: 's2', order_index: 2,
      activities: [{ id: ids.activityB, name: 'Trimitere', order_index: 1, default_consultant_id: null, document_requirements: [] }],
    },
  ],
}

// Ce trimite editorul pentru șablonul nemodificat.
function input() {
  return {
    name: current.name,
    description: '',
    phases: current.phases.map(phase => ({
      id: phase.id,
      name: phase.name,
      project_status_id: phase.project_status_id,
      activities: phase.activities.map(activity => ({
        id: activity.id,
        name: activity.name,
        default_consultant_id: null,
        document_requirements: activity.document_requirements.map(doc => ({
          id: doc.id,
          name: doc.name,
          description: doc.description,
          is_outgoing: doc.is_outgoing,
          requirement_type: doc.requirement_type,
          attachments: doc.attachments,
        })),
      })),
    })),
  }
}

function plan(body, taken = ['pregatire', 'depunere']) {
  let n = 100
  const result = planTemplateSave(current, body, taken, () => id(n++))
  assert.ok(result.ok, result.error)
  return result.plan
}

function planError(body) {
  const result = planTemplateSave(current, body, [], () => id(200))
  assert.equal(result.ok, false)
  return result.error
}

const docsOf = body => body.phases[0].activities[0].document_requirements

test('fără modificări, planul e gol', () => {
  const result = plan(input())
  for (const [key, value] of Object.entries(result)) {
    assert.ok(value === null || value.length === 0, `${key} ar trebui să fie gol`)
  }
})

test('redenumirea unui document modifică doar numele lui', () => {
  const body = input()
  docsOf(body)[0].name = 'Carte de identitate'
  const result = plan(body)
  assert.deepEqual(result.docUpdates.map(u => [u.id, u.update, u.attachments]), [[ids.docCi, { name: 'Carte de identitate' }, undefined]])
})

test('scoaterea atașamentului și schimbarea tipului sunt modificări', () => {
  const body = input()
  docsOf(body)[1].attachments = []
  docsOf(body)[0].requirement_type = 'daca_e_cazul'
  const result = plan(body)
  assert.deepEqual(result.docUpdates.map(u => u.id), [ids.docCi, ids.docFile])
  assert.deepEqual(result.docUpdates[0].update, { requirement_type: 'daca_e_cazul', is_mandatory: false })
  assert.deepEqual(result.docUpdates[1].attachments, [])
  assert.equal(result.docUpdates[1].update.attachment_path, null)
})

test('reordonarea schimbă doar order_index-ul elementelor mutate', () => {
  const body = input()
  body.phases.reverse()
  const result = plan(body)
  assert.deepEqual(result.phaseUpdates.map(u => [u.id, u.update]), [
    [ids.phaseB, { order_index: 1 }],
    [ids.phaseA, { order_index: 2 }],
  ])
  assert.equal(result.docUpdates.length, 0)
})

test('consultantul implicit și redenumirea fazei (cu slug nou și unic)', () => {
  const body = input()
  body.phases[0].activities[0].default_consultant_id = ids.consultant
  body.phases[0].name = 'Depunere'
  const result = plan(body)
  assert.deepEqual(result.activityUpdates[0].update, { default_consultant_id: ids.consultant })
  assert.deepEqual(result.phaseUpdates[0].update, { name: 'Depunere', slug: 'depunere-2' })
})

test('elementele noi primesc id-uri dinainte și părinții corecți; slug-ul ocolește fazele scoase', () => {
  const body = input()
  body.phases.push({
    id: 'loc-p', name: 'Arhivă', project_status_id: 's3',
    activities: [{
      id: 'loc-a', name: 'Arhivare',
      document_requirements: [{ id: 'loc-d', name: 'Proces-verbal', requirement_type: 'obligatoriu', attachments: [] }],
    }],
  })
  const result = plan(body, ['pregatire', 'depunere', 'arhiva'])
  const [phase] = result.phaseInserts
  const [activity] = result.activityInserts
  const [doc] = result.docInserts
  assert.equal(phase.row.slug, 'arhiva-2')
  assert.equal(phase.row.order_index, 3)
  assert.equal(activity.row.template_phase_id, phase.row.id)
  assert.equal(doc.row.template_activity_id, activity.row.id)
  assert.equal(doc.row.is_mandatory, true)
  assert.equal(doc.phaseName, 'Arhivă')
})

test('o duplicare dintr-un element nou din aceeași salvare devine persistentă', () => {
  const body = input()
  const dup = { source_kind: 'local', source_entity_type: 'template_activity', source_id: null, source_name: 'Nouă' }
  body.phases[1].activities.push(
    { id: 'loc-1', name: 'Nouă', document_requirements: [] },
    { id: 'loc-2', name: 'Nouă (copie)', duplication: dup, source_local_id: 'loc-1', document_requirements: [] },
  )
  const result = plan(body)
  const [original, copy] = result.activityInserts
  assert.deepEqual(copy.duplication, { ...dup, source_kind: 'persistent', source_id: original.row.id })
})

test('duplicarea persistentă primește numele sursei; sursa din alt șablon e refuzată', () => {
  const body = input()
  body.phases[1].activities.push({
    id: 'loc-1', name: 'Copie',
    duplication: { source_kind: 'persistent', source_entity_type: 'template_activity', source_id: ids.activityA },
    document_requirements: [],
  })
  assert.equal(plan(body).activityInserts[0].duplication.source_name, 'Colectare')

  body.phases[1].activities[1].duplication.source_id = ids.foreign
  assert.match(planError(body), /nu aparține acestui template/)
})

test('scoaterea unei faze scoate doar faza, nu și copiii ei', () => {
  const body = input()
  body.phases.shift()
  const result = plan(body)
  assert.deepEqual(result.phaseRemovals.map(r => r.before.id), [ids.phaseA])
  assert.equal(result.activityRemovals.length, 0)
  assert.equal(result.docRemovals.length, 0)
  assert.deepEqual(result.phaseUpdates.map(u => [u.id, u.update]), [[ids.phaseB, { order_index: 1 }]])
})

test('scoaterea unui document din activitate', () => {
  const body = input()
  docsOf(body).pop()
  assert.deepEqual(plan(body).docRemovals.map(r => [r.before.id, r.parentName, r.grandparentName]), [[ids.docFile, 'Colectare', 'Pregătire']])
})

test('refuză elemente mutate sub alt părinte, id-uri străine sau dublate', () => {
  const moved = input()
  moved.phases[1].activities.push(moved.phases[0].activities.pop())
  assert.match(planError(moved), /nu aparține fazei/)

  const foreign = input()
  foreign.phases[0].id = ids.foreign
  assert.match(planError(foreign), /nu aparține acestui șablon/)

  const twice = input()
  twice.phases[1].activities.push({ ...twice.phases[0].activities[0] })
  assert.match(planError(twice), /de două ori/)
})

test('documentul trimis clientului cere fișier și e mereu opțional', () => {
  const body = input()
  docsOf(body)[0].is_outgoing = true
  assert.match(planError(body), /trebuie să aibă un fișier/)

  docsOf(body)[1].is_outgoing = true
  docsOf(body)[0].is_outgoing = false
  const update = plan(body).docUpdates[0].update
  assert.deepEqual(update, { is_outgoing: true })
})

test('faza fără status e refuzată, și la adăugare, și la modificare', () => {
  const existing = input()
  existing.phases[0].project_status_id = null
  assert.match(planError(existing), /nu are status/)

  const added = input()
  added.phases.push({ id: 'loc-p', name: 'Fără status', project_status_id: '', activities: [] })
  assert.match(planError(added), /nu are status/)
})
