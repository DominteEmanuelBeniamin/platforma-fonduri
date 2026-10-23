/**
 * Motorul comun al căutărilor din platformă (#112). Toate câmpurile de căutare
 * trec pe aici, cu aceleași reguli:
 *
 * - fără diacritice și fără majuscule: „timisoara" = „Timișoara";
 * - cuvintele pot fi în orice ordine și fiecare trebuie găsit undeva în câmpuri;
 * - un cuvânt se găsește întreg, după început, în interiorul unui cuvânt (de la
 *   3 litere) sau cu o greșeală de tastare (de la 5 litere);
 * - la CIF și telefon nu contează spațiile, punctele și prefixul.
 *
 * Rezultatul spune și unde s-a găsit fiecare cuvânt, cu pozițiile din textul
 * original, ca evidențierea să cadă exact pe literele scrise de om, cu tot cu
 * diacritice. Aceleași reguli le are și căutarea de pe server
 * (`search_tier` din migrarea #112).
 */

/** `cif` și `phone` se compară și fără separatori și fără prefix. */
export type SearchFieldKind = 'text' | 'cif' | 'phone'

export interface SearchField {
  /** Cheie stabilă, pentru React și pentru teste. */
  key: string
  /** Numele câmpului în „Găsit în: …". */
  label: string
  value: string | null | undefined
  kind?: SearchFieldKind
  /**
   * `false` când câmpul nu se vede în rezultat (CIF-ul pe cardul unui proiect):
   * potrivirea de acolo se arată separat, în „Găsit în: …".
   */
  shown?: boolean
}

/**
 * Cât de bună e potrivirea: 0 cuvânt întreg, 1 început de cuvânt, 2 în
 * interiorul cuvântului, 3 greșeală de tastare. Mai mic = mai sus în listă.
 */
export type MatchTier = 0 | 1 | 2 | 3

/** Interval [început, sfârșit) în textul original. */
export type MatchRange = readonly [number, number]

export interface FieldMatch {
  key: string
  label: string
  value: string
  kind: SearchFieldKind
  shown: boolean
  ranges: MatchRange[]
}

export interface SearchHit<T> {
  item: T
  tier: MatchTier
  /** Doar câmpurile în care s-a găsit ceva. Gol când nu se caută nimic. */
  matches: FieldMatch[]
}

/** Greșeala de tastare se acceptă doar de la lungimea asta a cuvântului căutat. */
export const TYPO_MIN_LENGTH = 5
/** Sub lungimea asta, un cuvânt căutat se găsește doar întreg sau ca început. */
export const INFIX_MIN_LENGTH = 3

// ─── Normalizarea, cu harta înapoi la textul original ─────────────────────────

const DIACRITIC = /\p{Diacritic}/gu
const WORD_CHAR = /[\p{L}\p{N}]/u

/** Forma de comparat: fără diacritice, fără majuscule. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(DIACRITIC, '').toLowerCase()
}

interface Folded {
  text: string
  /** Pentru fiecare literă din `text`, intervalul ei din original. */
  from: number[]
  to: number[]
}

function foldWithMap(value: string): Folded {
  let text = ''
  const from: number[] = []
  const to: number[] = []
  let i = 0
  for (const ch of value) {
    const folded = foldText(ch)
    for (const out of folded) {
      text += out
      from.push(i)
      to.push(i + ch.length)
    }
    i += ch.length
  }
  return { text, from, to }
}

/** Păstrează doar literele și cifrele, cu tot cu harta lor. */
function compactWithMap(folded: Folded): Folded {
  let text = ''
  const from: number[] = []
  const to: number[] = []
  for (let k = 0; k < folded.text.length; k++) {
    const ch = folded.text[k]
    if (!WORD_CHAR.test(ch)) continue
    text += ch
    from.push(folded.from[k])
    to.push(folded.to[k])
  }
  return { text, from, to }
}

/** Ce se compară la CIF și telefon: textul fără separatori. */
export function compactText(value: string): string {
  return foldText(value).replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Câte litere din fața formei compacte sunt prefix, nu număr: la CIF codul
 * de țară („ro"), la telefon prefixul internațional al României.
 */
function prefixLength(compact: string, kind: SearchFieldKind): number {
  if (kind === 'cif') return /^[a-z]{2}\d/.test(compact) ? 2 : 0
  if (kind === 'phone') {
    // „0040 722…" și „+40 722…" sunt același număr cu „0722…".
    if (compact.startsWith('0040')) return 3
    if (/^40\d{9}$/.test(compact)) return 1
  }
  return 0
}

interface Word { start: number; end: number; text: string }

function wordsOf(text: string): Word[] {
  const words: Word[] = []
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    words.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  }
  return words
}

// ─── Interogarea ──────────────────────────────────────────────────────────────

export interface ParsedQuery {
  raw: string
  tokens: string[]
  /** Toată interogarea fără separatori, pentru CIF și telefon scrise cu spații. */
  compact: string
}

export function parseQuery(query: string): ParsedQuery {
  const folded = foldText(query.trim())
  const tokens = [...new Set(wordsOf(folded).map(w => w.text))]
  return { raw: query, tokens, compact: folded.replace(/[^\p{L}\p{N}]/gu, '') }
}

export function isEmptyQuery(query: string | ParsedQuery): boolean {
  return (typeof query === 'string' ? parseQuery(query) : query).tokens.length === 0
}

// ─── Potrivirea unui cuvânt ───────────────────────────────────────────────────

/**
 * Distanța de editare cu transpoziții (Damerau restrânsă), oprită devreme:
 * întoarce `limit + 1` imediat ce e clar că trece de limită.
 */
export function editDistance(a: string, b: string, limit = 1): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, rows[i - 2][j - 2] + 1)
      }
      row.push(d)
      best = Math.min(best, d)
    }
    if (best > limit) return limit + 1
    rows.push(row)
  }
  return rows[a.length][b.length]
}

interface WordMatch { tier: MatchTier; start: number; end: number }

/** Cea mai bună potrivire a unui cuvânt căutat într-un cuvânt din text. */
function matchWord(token: string, word: string): WordMatch | null {
  if (word === token) return { tier: 0, start: 0, end: word.length }
  if (word.startsWith(token)) return { tier: 1, start: 0, end: token.length }
  if (token.length >= INFIX_MIN_LENGTH) {
    const at = word.indexOf(token)
    if (at > 0) return { tier: 2, start: at, end: at + token.length }
  }
  if (token.length >= TYPO_MIN_LENGTH) {
    // Cuvântul întreg, sau începutul lui cât s-a tastat până acum („popsec").
    for (const len of [word.length, token.length, token.length + 1, token.length - 1]) {
      if (len < TYPO_MIN_LENGTH - 1 || len > word.length) continue
      if (editDistance(token, word.slice(0, len)) <= 1) return { tier: 3, start: 0, end: len }
    }
  }
  return null
}

// ─── Potrivirea unui câmp ─────────────────────────────────────────────────────

interface PreparedField {
  field: SearchField
  kind: SearchFieldKind
  value: string
  folded: Folded
  words: Word[]
  compact: Folded | null
  /** Litere de prefix în `compact`. */
  prefix: number
}

function prepareField(field: SearchField): PreparedField | null {
  const value = field.value?.trim() ? field.value : ''
  if (!value) return null
  const kind = field.kind ?? 'text'
  const folded = foldWithMap(value)
  const compact = kind === 'text' ? null : compactWithMap(folded)
  return {
    field,
    kind,
    value,
    folded,
    words: wordsOf(folded.text),
    compact,
    prefix: compact ? prefixLength(compact.text, kind) : 0,
  }
}

function toOriginal(map: Folded, start: number, end: number): MatchRange {
  return [map.from[start], map.to[end - 1]]
}

/** Potrivirea unui cuvânt căutat (sau a interogării compacte) în forma compactă. */
function matchCompact(token: string, f: PreparedField): WordMatch | null {
  const compact = f.compact!.text
  if (!token) return null
  const body = compact.slice(f.prefix)
  if (compact === token) return { tier: 0, start: 0, end: compact.length }
  if (body === token) return { tier: 0, start: f.prefix, end: compact.length }
  if (body.startsWith(token)) return { tier: 1, start: f.prefix, end: f.prefix + token.length }
  if (compact.startsWith(token)) return { tier: 1, start: 0, end: token.length }
  if (token.length >= INFIX_MIN_LENGTH) {
    const at = compact.indexOf(token)
    if (at >= 0) return { tier: 2, start: at, end: at + token.length }
  }
  return null
}

/** Unde se potrivește un cuvânt căutat într-un câmp: cel mai bun nivel și toate locurile. */
function matchTokenInField(token: string, f: PreparedField): { tier: MatchTier; ranges: MatchRange[] } | null {
  let tier: MatchTier | null = null
  const ranges: MatchRange[] = []
  for (const w of f.words) {
    const m = matchWord(token, w.text)
    if (!m) continue
    tier = tier === null ? m.tier : (Math.min(tier, m.tier) as MatchTier)
    ranges.push(toOriginal(f.folded, w.start + m.start, w.start + m.end))
  }
  if (f.compact) {
    const m = matchCompact(token, f)
    if (m) {
      tier = tier === null ? m.tier : (Math.min(tier, m.tier) as MatchTier)
      ranges.push(toOriginal(f.compact, m.start, m.end))
    }
  }
  return tier === null ? null : { tier, ranges }
}

/**
 * Lipește intervalele care se suprapun; la CIF și telefon și pe cele despărțite
 * doar de un separator („123.456" se evidențiază dintr-o bucată).
 */
function mergeRanges(value: string, ranges: MatchRange[], kind: SearchFieldKind): MatchRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const out: [number, number][] = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && (s <= last[1] || (kind !== 'text' && s - last[1] <= 1 && /^[\s.\-/]*$/.test(value.slice(last[1], s))))) {
      last[1] = Math.max(last[1], e)
    } else {
      out.push([s, e])
    }
  }
  return out
}

/**
 * Potrivește interogarea pe câmpurile unui rezultat. `null` când un cuvânt
 * căutat nu se găsește nicăieri. Interogarea goală se potrivește cu orice.
 */
export function matchFields(
  query: string | ParsedQuery,
  fields: readonly SearchField[],
): { tier: MatchTier; matches: FieldMatch[] } | null {
  const q = typeof query === 'string' ? parseQuery(query) : query
  if (q.tokens.length === 0) return { tier: 0, matches: [] }

  const prepared = fields.map(prepareField).filter((f): f is PreparedField => f !== null)
  const rangesByField = new Map<PreparedField, MatchRange[]>()
  const add = (f: PreparedField, ranges: MatchRange[]) => {
    rangesByField.set(f, [...(rangesByField.get(f) ?? []), ...ranges])
  }

  // CIF sau telefon scris cu spații/puncte („RO 123.456.78", „0722 123 456"):
  // toată interogarea, lipită, se caută ca un singur număr.
  let compactTier: MatchTier | null = null
  if (q.tokens.length > 1 && /\d/.test(q.compact)) {
    for (const f of prepared) {
      if (!f.compact) continue
      const m = matchCompact(q.compact, f)
      if (!m) continue
      compactTier = compactTier === null ? m.tier : (Math.min(compactTier, m.tier) as MatchTier)
      add(f, [toOriginal(f.compact, m.start, m.end)])
    }
  }

  let worst: MatchTier = 0
  let allTokens = true
  for (const token of q.tokens) {
    let best: MatchTier | null = null
    for (const f of prepared) {
      const m = matchTokenInField(token, f)
      if (!m) continue
      best = best === null ? m.tier : (Math.min(best, m.tier) as MatchTier)
      add(f, m.ranges)
    }
    if (best === null) allTokens = false
    else worst = Math.max(worst, best) as MatchTier
  }

  if (!allTokens && compactTier === null) return null
  const tier = allTokens
    ? (compactTier === null ? worst : (Math.min(worst, compactTier) as MatchTier))
    : compactTier!

  const matches: FieldMatch[] = []
  for (const f of prepared) {
    const ranges = rangesByField.get(f)
    if (!ranges?.length) continue
    matches.push({
      key: f.field.key,
      label: f.field.label,
      value: f.value,
      kind: f.kind,
      shown: f.field.shown !== false,
      ranges: mergeRanges(f.value, ranges, f.kind),
    })
  }
  return { tier, matches }
}

/**
 * Filtrează și ordonează: întâi potrivirile exacte, apoi cele după început de
 * cuvânt, apoi restul; în fiecare grup rămâne ordinea primită.
 */
export function searchItems<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly SearchField[],
): SearchHit<T>[] {
  const q = parseQuery(query)
  if (q.tokens.length === 0) return items.map(item => ({ item, tier: 0 as MatchTier, matches: [] }))
  const hits: SearchHit<T>[] = []
  for (const item of items) {
    const m = matchFields(q, fields(item))
    if (m) hits.push({ item, ...m })
  }
  // `sort` e stabil: ordinea paginii rămâne în fiecare grup.
  return hits.sort((a, b) => a.tier - b.tier)
}

/** Ca `searchItems`, doar elementele. */
export function filterItems<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly SearchField[],
): T[] {
  return searchItems(items, query, fields).map(hit => hit.item)
}

/** Unde se potrivește interogarea într-un text oarecare, pentru evidențiere. */
export function findRanges(text: string | null | undefined, query: string | ParsedQuery, kind: SearchFieldKind = 'text'): MatchRange[] {
  if (!text) return []
  const q = typeof query === 'string' ? parseQuery(query) : query
  const f = prepareField({ key: '', label: '', value: text, kind })
  if (!f || q.tokens.length === 0) return []
  const ranges: MatchRange[] = []
  for (const token of q.tokens) ranges.push(...(matchTokenInField(token, f)?.ranges ?? []))
  if (f.compact && q.tokens.length > 1) {
    const m = matchCompact(q.compact, f)
    if (m) ranges.push(toOriginal(f.compact, m.start, m.end))
  }
  return mergeRanges(text, ranges, kind)
}

/** Potrivirile din câmpuri care nu se văd în rezultat, pentru „Găsit în: …". */
export function hiddenMatches(matches: readonly FieldMatch[]): FieldMatch[] {
  return matches.filter(m => !m.shown)
}

/**
 * Bucata din text din jurul primei potriviri, cu pozițiile mutate pe bucată:
 * pentru descrieri lungi, din care se arată doar o frântură.
 */
export function snippetAround(
  text: string,
  ranges: readonly MatchRange[],
  radius = 44,
): { text: string; ranges: MatchRange[] } {
  if (ranges.length === 0 || text.length <= radius * 2) return { text, ranges: [...ranges] }
  const first = ranges[0]
  const start = Math.max(0, first[0] - radius)
  const end = Math.min(text.length, first[1] + radius)
  const lead = start > 0 ? '…' : ''
  const shift = lead.length - start
  return {
    text: `${lead}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
    ranges: ranges
      .filter(([s, e]) => s >= start && e <= end)
      .map(([s, e]) => [s + shift, e + shift] as const),
  }
}

/** Pozițiile de evidențiat într-un câmp anume al rezultatului. */
export function rangesOf(matches: readonly FieldMatch[], key: string): MatchRange[] {
  return matches.find(m => m.key === key)?.ranges ?? []
}
