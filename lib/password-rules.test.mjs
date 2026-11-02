import assert from 'node:assert/strict'
import test from 'node:test'

import { PASSWORD_RULE_MESSAGE, newPasswordProblem, passwordByteLength } from './password-rules.ts'

test('a new password needs at least 12 characters, counted as the person sees them', () => {
  assert.equal(newPasswordProblem('1'.repeat(11)), PASSWORD_RULE_MESSAGE)
  assert.equal(newPasswordProblem('1'.repeat(12)), null)
  // Diacriticele și emoji contează câte un caracter, nu câte octeți au.
  assert.equal(newPasswordProblem('ă'.repeat(11)), PASSWORD_RULE_MESSAGE)
  assert.equal(newPasswordProblem('ă'.repeat(12)), null)
  assert.equal(newPasswordProblem('🔒'.repeat(12)), null)
})

test('a new password stays within the 72 UTF-8 bytes bcrypt reads', () => {
  assert.equal(newPasswordProblem('a'.repeat(72)), null)
  assert.equal(newPasswordProblem('a'.repeat(73)), PASSWORD_RULE_MESSAGE)
  assert.equal(passwordByteLength('ș'.repeat(36)), 72)
  assert.equal(newPasswordProblem('ș'.repeat(36)), null)
  assert.equal(newPasswordProblem('ș'.repeat(37)), PASSWORD_RULE_MESSAGE)
})

test('malformed text is refused instead of being hashed as something else', () => {
  assert.equal(newPasswordProblem('abcdef\uD800'), PASSWORD_RULE_MESSAGE)
  assert.equal(newPasswordProblem('abc\0defg'), PASSWORD_RULE_MESSAGE)
})
