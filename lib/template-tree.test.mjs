import assert from 'node:assert/strict'
import test from 'node:test'

import { assembleTemplateTrees, mapWithConcurrency } from './template-tree.ts'

test('arborele păstrează forma veche și ordonează fiecare nivel după order_index', () => {
  const [template] = assembleTemplateTrees(
    [{ id: 't1', name: 'Șablon' }],
    [
      { id: 'p2', template_id: 't1', name: 'A doua', order_index: 2 },
      { id: 'p1', template_id: 't1', name: 'Prima', order_index: 1 },
    ],
    [
      { id: 'a2', template_phase_id: 'p1', name: 'A2', order_index: 2 },
      { id: 'a1', template_phase_id: 'p1', name: 'A1', order_index: 1 },
    ],
    [
      { id: 'd2', template_activity_id: 'a1', name: 'D2', order_index: 2 },
      { id: 'd1', template_activity_id: 'a1', name: 'D1', order_index: 1 },
    ],
  )

  assert.deepEqual(template.phases.map(phase => phase.id), ['p1', 'p2'])
  assert.deepEqual(template.phases[0].activities.map(activity => activity.id), ['a1', 'a2'])
  assert.deepEqual(template.phases[0].activities[0].document_requirements.map(doc => doc.id), ['d1', 'd2'])
  assert.deepEqual(template.phases[0].activities[1].document_requirements, [])
  assert.deepEqual(template.phases[1].activities, [])
})

test('elementele al căror părinte lipsește (inactiv) nu apar în arbore', () => {
  const [template] = assembleTemplateTrees(
    [{ id: 't1' }],
    [{ id: 'p1', template_id: 't1', order_index: 1 }],
    [
      { id: 'a1', template_phase_id: 'p1', order_index: 1 },
      { id: 'orfana', template_phase_id: 'faza-inactiva', order_index: 1 },
    ],
    [{ id: 'd-orfan', template_activity_id: 'orfana', order_index: 1 }],
  )

  assert.deepEqual(template.phases[0].activities.map(activity => activity.id), ['a1'])
  assert.deepEqual(template.phases[0].activities[0].document_requirements, [])
})

test('fazele se împart corect între mai multe șabloane', () => {
  const templates = assembleTemplateTrees(
    [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
    [
      { id: 'p1', template_id: 't1', order_index: 1 },
      { id: 'p2', template_id: 't2', order_index: 1 },
    ],
    [],
    [],
  )

  assert.deepEqual(templates.map(template => template.phases.map(phase => phase.id)), [['p1'], ['p2'], []])
})

test('mapWithConcurrency respectă limita și păstrează ordinea rezultatelor', async () => {
  let running = 0
  let peak = 0
  const results = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (delay, index) => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise(resolve => setTimeout(resolve, delay))
    running -= 1
    return index
  })

  assert.equal(peak, 2)
  assert.deepEqual(results, [0, 1, 2, 3, 4])
})

test('mapWithConcurrency pe o listă goală nu pornește nimic', async () => {
  assert.deepEqual(await mapWithConcurrency([], 3, async () => 1), [])
})
