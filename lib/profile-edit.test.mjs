import assert from 'node:assert/strict'
import test from 'node:test'

import { PROFILE_FIELDS, normalizeProfileEmail, profileFieldProblem, completeProfileProblem } from './profile-edit.ts'

test('a client account carries the company, the contact person, email and phone', () => {
  assert.deepEqual(PROFILE_FIELDS.client.map(field => field.key), ['nume_firma', 'adresa_firma', 'full_name', 'email', 'telefon'])
  assert.deepEqual(PROFILE_FIELDS.client.filter(field => field.required).map(field => field.key), ['nume_firma', 'adresa_firma', 'full_name', 'email'])
})

test('required fields cannot be emptied, optional ones can', () => {
  assert.deepEqual(profileFieldProblem('client', { nume_firma: '  ' }), { field: 'nume_firma', message: 'Completează nume firmă.' })
  assert.equal(profileFieldProblem('client', { telefon: '' }), null)
  assert.equal(profileFieldProblem('client', { telefon: null }), null)
  assert.equal(profileFieldProblem('consultant', { departament: '' }), null)
  assert.equal(profileFieldProblem('consultant', { specializare: '' })?.field, 'specializare')
})

test('fields of another account type are refused', () => {
  assert.equal(profileFieldProblem('consultant', { nume_firma: 'Agro Verde SRL' })?.field, 'nume_firma')
  assert.equal(profileFieldProblem('client', { specializare: 'AFIR' })?.field, 'specializare')
  assert.equal(profileFieldProblem('admin', { departament: 'Conducere' }), null)
})

test('the login email must look like an email and is stored in lower case', () => {
  assert.equal(profileFieldProblem('client', { email: 'ion@agroverde' })?.message, 'Completează un email valid.')
  assert.equal(profileFieldProblem('client', { email: 'Ion.Vasilescu@AgroVerde.ro' }), null)
  assert.equal(normalizeProfileEmail('  Ion.Vasilescu@AgroVerde.ro '), 'ion.vasilescu@agroverde.ro')
  assert.equal(profileFieldProblem('client', { email: 42 })?.message, 'Datele trimise nu sunt valide.')
})

test('complete profile validation checks inherited required fields', () => {
  assert.equal(completeProfileProblem('consultant', { full_name: 'Ana', email: 'ana@example.com', specializare: ' ' })?.field, 'specializare')
  assert.equal(completeProfileProblem('consultant', { full_name: 'Ana', email: 'ana@example.com', specializare: 'AFIR' }), null)
  assert.equal(completeProfileProblem('admin', { full_name: '', email: 'ana@example.com' })?.field, 'full_name')
})
