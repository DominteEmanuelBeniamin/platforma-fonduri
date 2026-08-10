// Ce trebuie completat ca un element să poată trece din „În pregătire" în
// „Public" (#70). Aceleași reguli pe server și în interfață — serverul decide,
// interfața doar arată din timp ce lipsește.
//
// Exceptate: fazele (nu au nici termen, nici consultant) și documentele
// informative (`is_outgoing`), unde trimiterea *este* momentul publicării.

const BLOCKER_DEADLINE = 'deadline'
const BLOCKER_ASSIGNEE = 'assignee'

// Eticheta scurtă apare pe „ce lipsește" în interfață; cea lungă, în mesajul
// de eroare al serverului.
const PUBLISH_BLOCKERS = {
  [BLOCKER_DEADLINE]: { short: 'termen limită', long: 'termen limită' },
  [BLOCKER_ASSIGNEE]: { short: 'consultant', long: 'un consultant atribuit' },
}

// Ce valoare va avea rândul după update: cea trimisă acum, dacă a fost trimisă
// în aceeași cerere, altfel cea existentă. Șirurile goale contează ca lipsă.
/**
 * @param {string | null | undefined} current
 * @param {string | null | undefined} incoming
 * @returns {string | null}
 */
function resolveField(current, incoming) {
  const next = incoming === undefined ? current : incoming
  return typeof next === 'string' && next.trim() ? next : null
}

/**
 * Ce lipsește ca elementul să poată fi publicat. Listă goală = se poate publica.
 *
 * @param {{
 *   kind?: 'activity' | 'document',
 *   isOutgoing?: boolean,
 *   currentDeadline?: string | null,
 *   incomingDeadline?: string | null,
 *   currentAssignee?: string | null,
 *   incomingAssignee?: string | null,
 * }} [item]
 * @returns {string[]}
 */
function publishBlockers(item = {}) {
  const {
    kind = 'document',
    isOutgoing = false,
    currentDeadline,
    incomingDeadline,
    currentAssignee,
    incomingAssignee,
  } = item

  if (isOutgoing) return []

  const blockers = []
  if (resolveField(currentDeadline, incomingDeadline) === null) blockers.push(BLOCKER_DEADLINE)
  // Consultantul se cere doar pe activități: cererile de documente sunt adresate
  // clientului, iar responsabilul lor este consultantul activității-părinte.
  if (kind === 'activity' && resolveField(currentAssignee, incomingAssignee) === null) {
    blockers.push(BLOCKER_ASSIGNEE)
  }
  return blockers
}

/**
 * Răspunsul de 400 pentru o publicare respinsă.
 *
 * `error` este textul canonic al serverului, dar `apiFetch` îl înlocuiește cu un
 * mesaj generic pe orice răspuns non-2xx (vezi app/providers/AuthProvider.tsx).
 * `message` trece nealterat, deci motivul real ajunge la utilizator.
 *
 * @param {string[]} blockers
 */
function publishBlockedError(blockers) {
  const missing = blockers
    .map(blocker => PUBLISH_BLOCKERS[blocker]?.long ?? blocker)
    .join(' și ')
  const message = `Nu poți publica fără ${missing}. Completează, apoi publică.`

  return { error: message, message, missing: blockers }
}

module.exports = {
  BLOCKER_ASSIGNEE,
  BLOCKER_DEADLINE,
  PUBLISH_BLOCKERS,
  publishBlockedError,
  publishBlockers,
}
