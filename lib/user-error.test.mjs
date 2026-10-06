import assert from 'node:assert/strict'
import test from 'node:test'
import { userErrorMessage } from './user-error.js'

test('normalizes HTTP errors without exposing server text', () => {
  assert.equal(userErrorMessage(401, 'Nu am putut salva.'), 'Sesiunea a expirat. Autentifică-te din nou.')
  assert.equal(userErrorMessage(500, 'Nu am putut salva.'), 'Nu am putut salva. Reîncearcă peste câteva momente.')
  assert.equal(userErrorMessage(undefined, 'Nu am putut salva.'), 'Nu am putut salva. Verifică conexiunea și reîncearcă.')
})
test('uses the inactive-client message only for its matching 409 code', () => {
  const fallback = 'Nu am putut anunța clientul.'
  assert.equal(userErrorMessage(409, fallback, 'CLIENT_ACCOUNT_INACTIVE'), 'Clientul are contul dezactivat. Nu a fost trimisă nicio notificare.')
  assert.equal(userErrorMessage(409, fallback, 'UNKNOWN_CODE'), 'Acțiunea nu poate fi finalizată din cauza unei modificări existente.')
  assert.equal(userErrorMessage(400, fallback, 'CLIENT_ACCOUNT_INACTIVE'), 'Datele trimise nu sunt valide. Verifică informațiile și reîncearcă.')
})
