// Textele fluxului de resetare a parolei, comune rutelor și paginilor publice:
// o singură sursă, ca mesajul de pe pagină să fie același cu cel de la server.

export const RECOVERY_REQUEST_MESSAGE = 'Dacă există un cont cu această adresă, vei primi un email cu instrucțiuni. Verifică și folderul Spam. Pentru aceeași adresă, se poate solicita un email nou o dată la 15 minute.'
export const RECOVERY_INVALID_MESSAGE = 'Linkul de resetare nu mai este valid. Solicită un link nou sau contactează administratorul.'
export const RECOVERY_FALLBACK_MESSAGE = 'Parola a fost schimbată. Autentifică-te cu noua parolă.'
export const RECOVERY_TEMPORARY_MESSAGE = 'Serviciul este temporar indisponibil. Încearcă din nou.'
export const RECOVERY_PASSWORD_RULE_MESSAGE = 'Parola trebuie să aibă cel puțin 6 caractere și cel mult 72 de octeți UTF-8.'
