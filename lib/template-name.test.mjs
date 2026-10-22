import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeTemplateName, templateNameChanged, templateNameConflict, templateNameTakenMessage } from './template-name.ts'

const others = [{ id: 't1', name: 'Start-Up Nation 2026' }, { id: 't2', name: 'AFIR  DR-30' }]

test('același nume, cu alte majuscule sau spații la capete, e conflict', () => {
  assert.equal(templateNameConflict(' start-up nation 2026 ', others), 'Start-Up Nation 2026')
  assert.equal(templateNameConflict('afir dr-30', others), 'AFIR  DR-30', 'spațiile duble din interior nu deosebesc')
  assert.equal(normalizeTemplateName('  Ă  Î '), 'ă î')
})

test('propriul nume nu e conflict, iar un nume nou e liber', () => {
  assert.equal(templateNameConflict('Start-Up Nation 2026', others, 't1'), null)
  assert.equal(templateNameConflict('Start-Up Nation 2027', others), null)
  assert.equal(templateNameConflict('   ', others), null)
})

test('se verifică doar când numele chiar se schimbă', () => {
  assert.equal(templateNameChanged('Șablon', ' șablon '), false)
  assert.equal(templateNameChanged('Șablon', 'Șablon nou'), true)
})

test('mesajul spune numele și ce e de făcut', () => {
  assert.equal(templateNameTakenMessage(' X '), 'Există deja un șablon numit «X». Alege alt nume.')
})
