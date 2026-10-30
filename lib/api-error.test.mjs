import assert from 'node:assert/strict'
import test from 'node:test'
import { transitionFailureVariant } from './api-error.ts'

test('refuzurile de tranziție au aceeași avertizare ca verificările din pagină', () => {
  assert.equal(transitionFailureVariant(400), 'warning')
  assert.equal(transitionFailureVariant(409), 'warning')
})

test('problemele de acces și erorile tehnice rămân erori', () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    assert.equal(transitionFailureVariant(status), 'error')
  }
})
