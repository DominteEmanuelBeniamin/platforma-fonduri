import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCopyName } from './duplicate-name.ts'

test('prima copie primește sufixul simplu', () => {
  assert.equal(buildCopyName('Contractare', ['Contractare']), 'Contractare (copie)')
})

test('a doua copie numără, în loc să repete numele', () => {
  assert.equal(
    buildCopyName('Contractare', ['Contractare', 'Contractare (copie)']),
    'Contractare (copie 2)',
  )
  assert.equal(
    buildCopyName('Contractare', ['Contractare', 'Contractare (copie)', 'Contractare (copie 2)']),
    'Contractare (copie 3)',
  )
})

test('duplicarea unei copii repornește de la numele-rădăcină', () => {
  // Fără asta se ajungea la „X (copie) (copie) (copie)”.
  assert.equal(
    buildCopyName('Contractare (copie)', ['Contractare', 'Contractare (copie)']),
    'Contractare (copie 2)',
  )
  assert.equal(
    buildCopyName('Contractare (copie 2)', ['Contractare', 'Contractare (copie)', 'Contractare (copie 2)']),
    'Contractare (copie 3)',
  )
})

test('numele care doar seamănă cu un sufix rămâne întreg', () => {
  assert.equal(buildCopyName('Raport (copiere)', []), 'Raport (copiere) (copie)')
  assert.equal(buildCopyName('(copie) de rezervă', []), '(copie) de rezervă (copie)')
})

test('comparația ignoră spațiile și majusculele', () => {
  assert.equal(buildCopyName('Contractare', ['  contractare (COPIE)  ']), 'Contractare (copie 2)')
})

test('numele gol are un nume', () => {
  assert.equal(buildCopyName('   ', []), 'Fără nume (copie)')
  assert.equal(buildCopyName(null, []), 'Fără nume (copie)')
})
