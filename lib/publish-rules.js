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
 *   parentAssignee?: string | null,
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
    parentAssignee,
  } = item

  // Scutirea e a documentelor informative, unde trimiterea *este* momentul
  // publicării. Legată de `kind`, ca un apel care trimite tot rândul să nu
  // scutească din greșeală o activitate.
  if (kind === 'document' && isOutgoing) return []

  const blockers = []
  if (resolveField(currentDeadline, incomingDeadline) === null) blockers.push(BLOCKER_DEADLINE)

  // Fiecare element publicat are un responsabil. Pe o cerere, acela poate fi și
  // consultantul activității-părinte — cererea e adresată clientului, dar de ea
  // răspunde cineva. O cerere generală, fără activitate, are nevoie de al ei.
  const hasOwner =
    resolveField(currentAssignee, incomingAssignee) !== null ||
    (kind === 'document' && resolveField(parentAssignee) !== null)
  if (!hasOwner) blockers.push(BLOCKER_ASSIGNEE)

  return blockers
}

/**
 * Răspunsul de 400 pentru o publicare respinsă sau pentru o modificare care ar
 * lăsa incomplet un element deja publicat.
 *
 * `error` este textul canonic al serverului, dar `apiFetch` îl înlocuiește cu un
 * mesaj generic pe orice răspuns non-2xx (vezi app/providers/AuthProvider.tsx).
 * `message` trece nealterat, deci motivul real ajunge la utilizator.
 *
 * @param {string[]} blockers
 * @param {{ alreadyPublished?: boolean }} [opts]
 */
function publishBlockedError(blockers, opts = {}) {
  const missing = blockers
    .map(blocker => PUBLISH_BLOCKERS[blocker]?.long ?? blocker)
    .join(' și ')
  const message = opts.alreadyPublished
    ? `Elementul e publicat și nu poate rămâne fără ${missing}. Retrage-l din „Public" dacă vrei să-l golești.`
    : `Nu poți publica fără ${missing}. Completează, apoi publică.`

  return { error: message, message, missing: blockers }
}

module.exports = {
  BLOCKER_ASSIGNEE,
  BLOCKER_DEADLINE,
  PUBLISH_BLOCKERS,
  publishBlockedError,
  publishBlockers,
}
