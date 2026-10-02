import assert from 'node:assert/strict'
import test from 'node:test'

import { generateTemporaryPassword } from './temporary-password.ts'

test('temporary passwords use 20 independent characters from the 32-symbol alphabet', () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  assert.equal(alphabet.length, 32)
  assert.equal(new Set(alphabet).size, 32)

  const passwords = Array.from({ length: 8 }, () => generateTemporaryPassword())
  for (const password of passwords) {
    assert.equal(password.length, 20)
    assert.ok([...password].every(character => alphabet.includes(character)))
  }
  assert.equal(new Set(passwords).size, passwords.length)
})