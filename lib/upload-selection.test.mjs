import assert from 'node:assert/strict'
import test from 'node:test'

import { discardSelectionText, selectionStats, selectionSummary } from './upload-selection.ts'

const file = (size, extra = {}) => ({ size, uploadStatus: 'pending', ...extra })

test('numără ce pleacă la încărcare: valide și neîncărcate încă', () => {
  const stats = selectionStats([
    file(100),
    file(200, { validationError: { type: 'type', message: 'Tip de fișier nepermis' } }),
    file(300, { uploadStatus: 'success' }),
    file(400, { uploadStatus: 'error' }),
  ])
  assert.equal(stats.total, 4)
  assert.equal(stats.toUpload, 2, 'cel în așteptare și cel căzut, care se reîncearcă')
  assert.equal(stats.invalid, 1)
  assert.equal(stats.failed, 1)
  assert.equal(stats.uploaded, 1)
  assert.equal(stats.notUploaded, 3, 'tot ce nu a ajuns la consultant se pierde la închidere')
  assert.equal(stats.totalSize, 1000)
})

test('totalul spune erorile doar când există', () => {
  assert.equal(selectionSummary(selectionStats([file(1024)])), '1 fișier selectat · 1 KB')
  assert.equal(
    selectionSummary(selectionStats([file(1024), file(1024, { validationError: {} }), file(2048, { uploadStatus: 'error' })])),
    '3 fișiere selectate · 4 KB · 2 erori',
  )
  assert.equal(selectionSummary(selectionStats(Array.from({ length: 20 }, () => file(0)))), '20 de fișiere selectate · 0 B')
})

test('confirmarea la închidere acordă verbul cu numărul', () => {
  assert.equal(discardSelectionText(1), 'Ai ales 1 fișier care nu s-a încărcat. Dacă închizi, selecția se pierde.')
  assert.equal(discardSelectionText(3), 'Ai ales 3 fișiere care nu s-au încărcat. Dacă închizi, selecția se pierde.')
})
