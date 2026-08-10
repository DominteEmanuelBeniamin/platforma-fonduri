// Regula din #70: un element nu poate trece în „Public" fără termen limită.
// Se aplică activităților și cererilor de documente, inclusiv celor generale.
// Exceptate: fazele (nu au coloană de termen) și documentele informative
// (`is_outgoing`), unde trimiterea către client *este* momentul publicării.

const DEADLINE_REQUIRED_CODE = 'deadline_required'
const DEADLINE_REQUIRED_MESSAGE =
  'Nu poți publica fără termen limită. Setează un termen, apoi publică.'

// Ce termen va avea rândul după update: cel trimis acum, dacă a fost trimis în
// aceeași cerere, altfel cel existent. Șirurile goale contează ca „fără termen".
/**
 * @param {string | null | undefined} currentDeadline
 * @param {string | null | undefined} incomingDeadline
 * @returns {string | null}
 */
function resolveDeadline(currentDeadline, incomingDeadline) {
  const next = incomingDeadline === undefined ? currentDeadline : incomingDeadline
  return typeof next === 'string' && next.trim() ? next : null
}

/**
 * @param {{
 *   isOutgoing?: boolean,
 *   currentDeadline?: string | null,
 *   incomingDeadline?: string | null,
 * }} [params]
 * @returns {boolean}
 */
function missingDeadlineForPublish(params = {}) {
  const { isOutgoing = false, currentDeadline = null, incomingDeadline } = params
  if (isOutgoing) return false
  return resolveDeadline(currentDeadline, incomingDeadline) === null
}

// `error` este textul canonic al serverului, dar `apiFetch` îl înlocuiește cu un
// mesaj generic pe orice răspuns non-2xx (vezi app/providers/AuthProvider.tsx).
// `message` trece nealterat, deci motivul real ajunge la utilizator.
function deadlineRequiredError() {
  return {
    error: DEADLINE_REQUIRED_MESSAGE,
    code: DEADLINE_REQUIRED_CODE,
    message: DEADLINE_REQUIRED_MESSAGE,
  }
}

module.exports = {
  DEADLINE_REQUIRED_CODE,
  DEADLINE_REQUIRED_MESSAGE,
  resolveDeadline,
  missingDeadlineForPublish,
  deadlineRequiredError,
}
