// Documentele cu date sensibile: copiile actelor de identitate (au CNP) și
// cazierele judiciare. Cererea le poartă marcajul, iar fișierele lor se șterg
// automat, mai devreme decât restul dosarului: Legea 190/2018 art. 4 cere
// termene de stocare pentru CNP, iar cazierul e dată din art. 10 GDPR.
//
// Modulul e pur (fără I/O): îl folosesc rutele, interfața și jobul de
// ștergere, ca termenul să fie calculat într-un singur loc.
//
// Căi relative, cu extensie: fișierul are teste rulate direct cu `node --test`.

export type SensitiveKind = 'identitate' | 'cazier'

export const SENSITIVE_KINDS: readonly SensitiveKind[] = ['identitate', 'cazier']

export const SENSITIVE_LABELS: Record<SensitiveKind, string> = {
  identitate: 'Act de identitate (CNP)',
  cazier: 'Cazier judiciar',
}

/** Cazierul se cere pentru eligibilitate; după aprobare nu mai e nevoie de el. */
export const CAZIER_DAYS_AFTER_APPROVAL = 90

/** Orice document sensibil pleacă la cel mult atât după încheierea proiectului. */
export const DAYS_AFTER_PROJECT_CLOSURE = 30

/** O amânare pusă de admin nu poate trece de atât. */
export const MAX_HOLD_DAYS = 3 * 365

const DAY_MS = 24 * 60 * 60 * 1000

export function isSensitiveKind(value: unknown): value is SensitiveKind {
  return value === 'identitate' || value === 'cazier'
}

/** Ce vine din baza de date: orice altceva decât un tip cunoscut înseamnă „nesensibil”. */
export function normalizeSensitiveKind(value: unknown): SensitiveKind | null {
  return isSensitiveKind(value) ? value : null
}

/**
 * Ce vine dintr-o cerere HTTP. `undefined` = câmpul nu a fost trimis,
 * `null` = fără marcaj, `false` = valoare nevalidă (răspuns 400).
 */
export function parseSensitiveKindInput(value: unknown): SensitiveKind | null | undefined | false {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  return isSensitiveKind(value) ? value : false
}

function addDays(iso: string | null | undefined, days: number): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  return Number.isFinite(time) ? time + days * DAY_MS : null
}

export type SensitivePurgeInput = {
  kind: string | null | undefined
  /** Starea cererii: ceasul cazierului pornește doar cât e aprobată. */
  status?: string | null
  /** Ultima aprobare a cererii (`document_request_reviews`). */
  approvedAt?: string | null
  projectClosedAt?: string | null
  holdUntil?: string | null
  purgedAt?: string | null
}

/** Termenul fără amânare. `null` = încă nu există unul (proiect deschis, cazier neaprobat). */
export function sensitivePurgeDueAt(input: SensitivePurgeInput): string | null {
  if (!isSensitiveKind(input.kind)) return null
  const candidates: number[] = []
  if (input.kind === 'cazier' && input.status === 'approved') {
    const afterApproval = addDays(input.approvedAt, CAZIER_DAYS_AFTER_APPROVAL)
    if (afterApproval !== null) candidates.push(afterApproval)
  }
  const afterClosure = addDays(input.projectClosedAt, DAYS_AFTER_PROJECT_CLOSURE)
  if (afterClosure !== null) candidates.push(afterClosure)
  if (candidates.length === 0) return null
  return new Date(Math.min(...candidates)).toISOString()
}

/** Termenul efectiv: amânarea adminului îl mută mai târziu, niciodată mai devreme. */
export function sensitivePurgeAt(input: SensitivePurgeInput): string | null {
  if (input.purgedAt) return null
  const due = sensitivePurgeDueAt(input)
  if (!due) return null
  const hold = input.holdUntil ? Date.parse(input.holdUntil) : Number.NaN
  return Number.isFinite(hold) && hold > Date.parse(due) ? new Date(hold).toISOString() : due
}

export function isSensitivePurgeDue(input: SensitivePurgeInput, now: number): boolean {
  const at = sensitivePurgeAt(input)
  return at !== null && Date.parse(at) <= now
}

/** Ce vede clientul lângă cererea marcată. */
export function sensitiveClientNotice(kind: SensitiveKind): string {
  return kind === 'cazier'
    ? `Cazierul judiciar conține date sensibile. Îl folosim doar pentru verificarea eligibilității și îl ștergem automat după cel mult ${CAZIER_DAYS_AFTER_APPROVAL} de zile de la aprobare.`
    : `Copia actului de identitate conține CNP-ul. O folosim doar pentru dosarul de finanțare și o ștergem automat la ${DAYS_AFTER_PROJECT_CLOSURE} de zile după încheierea proiectului.`
}

/** Explicația din formular, pentru consultant. */
export function sensitiveRuleHint(kind: SensitiveKind | null): string {
  if (kind === 'cazier') {
    return `Fișierele se șterg automat la ${CAZIER_DAYS_AFTER_APPROVAL} de zile după aprobare sau la ${DAYS_AFTER_PROJECT_CLOSURE} de zile după încheierea proiectului, care vine prima.`
  }
  if (kind === 'identitate') {
    return `Fișierele se șterg automat la ${DAYS_AFTER_PROJECT_CLOSURE} de zile după încheierea proiectului.`
  }
  return 'Marchează cererile care primesc copii de buletin sau caziere: fișierele lor se șterg automat, mai devreme decât restul dosarului.'
}

export function formatSensitiveDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' })
}

/**
 * Rândul scurt de stare, pentru echipă, din termenele calculate deja (ruta de
 * listă le trimite gata calculate). `null` = cererea nu e marcată.
 */
export function describeSensitiveTerms(terms: {
  kind: string | null | undefined
  purgeAt?: string | null
  dueAt?: string | null
  purgedAt?: string | null
}): string | null {
  if (!isSensitiveKind(terms.kind)) return null
  const purged = formatSensitiveDate(terms.purgedAt)
  if (purged) return `Fișierele au fost șterse automat pe ${purged}.`
  if (!terms.purgeAt || !terms.dueAt) {
    return terms.kind === 'cazier'
      ? 'Termenul de ștergere pornește la aprobare sau la încheierea proiectului.'
      : 'Termenul de ștergere pornește la încheierea proiectului.'
  }
  const date = formatSensitiveDate(terms.purgeAt)
  return terms.purgeAt !== terms.dueAt ? `Ștergerea automată e amânată până pe ${date}.` : `Se șterge automat pe ${date}.`
}

/** La fel, pornind de la datele brute ale cererii. */
export function sensitiveStatusLine(input: SensitivePurgeInput): string | null {
  return describeSensitiveTerms({
    kind: input.kind,
    purgeAt: sensitivePurgeAt(input),
    dueAt: sensitivePurgeDueAt(input),
    purgedAt: input.purgedAt,
  })
}
