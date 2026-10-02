import { randomBytes } from 'node:crypto'

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateTemporaryPassword() {
  return Array.from(randomBytes(20), byte => PASSWORD_ALPHABET[byte & 31]).join('')
}