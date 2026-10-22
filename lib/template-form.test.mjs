import assert from 'node:assert/strict'
import test from 'node:test'

import { templateFormDirty } from './template-form.ts'

const doc = (id, extra = {}) => ({ id, name: `Cerere ${id}`, description: '', is_outgoing: false, requirement_type: 'obligatoriu', templateFiles: [], templateAttachments: [], ...extra })
const form = (phases, extra = {}) => ({ name: 'Șablon', description: '', phases, ...extra })
const phase = (id, activities, extra = {}) => ({ id, name: `Faza ${id}`, project_status_id: 's1', expanded: false, activities, ...extra })
const activity = (id, docs, extra = {}) => ({ id, name: `Activitatea ${id}`, default_consultant_id: '', expanded: false, document_requirements: docs, ...extra })

const base = form([phase('f1', [activity('a1', [doc('d1'), doc('d2')])]), phase('f2', [])])

test('formularul neatins nu are modificări', () => {
  assert.equal(templateFormDirty(base, base), false)
  assert.equal(templateFormDirty(base, structuredClone(base)), false)
})

test('strângerea sau desfacerea fazelor nu contează', () => {
  const folded = form(base.phases.map(p => ({ ...p, expanded: true, activities: p.activities.map(a => ({ ...a, expanded: true })) })))
  assert.equal(templateFormDirty(base, folded), false)
})

test('spațiile de la capete în nume și descriere nu contează, fiindcă salvarea le taie', () => {
  assert.equal(templateFormDirty(base, { ...base, name: ' Șablon  ' }), false)
})

test('numele, descrierea, ordinea și consultantul sunt modificări', () => {
  assert.equal(templateFormDirty(base, { ...base, name: 'Alt nume' }), true)
  assert.equal(templateFormDirty(base, { ...base, description: 'ceva' }), true)
  assert.equal(templateFormDirty(base, { ...base, phases: [...base.phases].reverse() }), true)
  const withConsultant = form([phase('f1', [activity('a1', [doc('d1'), doc('d2')], { default_consultant_id: 'c1' })]), phase('f2', [])])
  assert.equal(templateFormDirty(base, withConsultant), true)
})

test('o cerere schimbată, adăugată sau un fișier-model nou sunt modificări', () => {
  const renamed = form([phase('f1', [activity('a1', [doc('d1', { name: 'Altfel' }), doc('d2')])]), phase('f2', [])])
  assert.equal(templateFormDirty(base, renamed), true)
  const added = form([phase('f1', [activity('a1', [doc('d1'), doc('d2'), doc('d3')])]), phase('f2', [])])
  assert.equal(templateFormDirty(base, added), true)
  const withFile = form([phase('f1', [activity('a1', [doc('d1', { templateFiles: [{ name: 'model.pdf', size: 10 }] }), doc('d2')])]), phase('f2', [])])
  assert.equal(templateFormDirty(base, withFile), true)
})
