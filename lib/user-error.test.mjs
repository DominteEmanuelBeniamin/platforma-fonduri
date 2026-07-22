import assert from 'node:assert/strict'
import test from 'node:test'
import { userErrorMessage } from './user-error.js'

test('normalizes HTTP errors without exposing server text', () => {
  assert.equal(userErrorMessage(401, 'Nu am putut salva.'), 'Sesiunea a expirat. Autentifică-te din nou.')
  assert.equal(userErrorMessage(500, 'Nu am putut salva.'), 'Nu am putut salva. Reîncearcă peste câteva momente.')
  assert.equal(userErrorMessage(undefined, 'Nu am putut salva.'), 'Nu am putut salva. Verifică conexiunea și reîncearcă.')
})
