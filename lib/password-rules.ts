import { RECOVERY_PASSWORD_RULE_MESSAGE } from './recovery-messages.ts'

// Aceeași regulă ca la resetarea prin email (#107) și ca în baza de date:
// cel puțin 6 caractere, cel mult 72 de octeți UTF-8 (limita bcrypt).
export const PASSWORD_MIN_CHARACTERS = 6
export const PASSWORD_MAX_BYTES = 72
export const PASSWORD_RULE_MESSAGE = RECOVERY_PASSWORD_RULE_MESSAGE

/** Un surogat UTF-16 fără pereche nu se poate scrie în UTF-8; bcrypt ar primi altceva decât a tastat omul. */
function wellFormed(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

export function passwordByteLength(value: string) {
  return new TextEncoder().encode(value).length
}

/** `null` dacă parola nouă respectă regula, altfel mesajul de arătat. */
export function newPasswordProblem(password: string): string | null {
  if (!wellFormed(password) || password.includes('\0')
    || [...password].length < PASSWORD_MIN_CHARACTERS
    || passwordByteLength(password) > PASSWORD_MAX_BYTES) return PASSWORD_RULE_MESSAGE
  return null
}
