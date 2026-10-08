// Ce înseamnă „finalizat" pentru o fază, o activitate și o cerere de documente
// (#109), și regula după care pagina proiectului ascunde ce e finalizat.
//
// Un singur loc, fiindcă îl citesc calendarul, tabloul de bord, „Panoul cu
// chei", contoarele, ascunderea și rutele de tranziție: dacă două ecrane ar
// număra altfel „finalizat", s-ar contrazice la vedere.
//
// Căi relative, cu extensie: fișierul are teste rulate direct cu `node --test`.
import { countLabel } from './count-label.ts'
import { requestStatusInfo } from './request-status.ts'

type RequestLike = {
  id?: string
  name?: string | null
  status?: string | null
  is_outgoing?: boolean | null
  deleted_at?: string | null
  activity_id?: string | null
}

type ActivityLike = { id: string; name?: string; status?: string | null }

type PhaseLike = {
  id: string
  name?: string
  status?: string | null
  activities?: readonly ActivityLike[] | null
}

// ─── Ce e finalizat ───────────────────────────────────────────────────────────

/**
 * Cerere finalizată: aprobată sau închisă (D4). Un document trimis clientului
 * nu e niciodată finalizat (D12): rămâne `pending`, nu intră la numărătoare și
 * nu se ascunde singur. Se ascunde doar odată cu activitatea lui finalizată
 * (vezi `waitsForNothing`).
 */
export const isRequestFinal = (request: Pick<RequestLike, 'status' | 'is_outgoing'>): boolean =>
  !request.is_outgoing && (request.status === 'approved' || request.status === 'closed')

/**
 * Nu mai așteaptă nimic: e finalizată, sau e un document trimis clientului
 * (care nu așteaptă nimic de la el). Asta decide dacă o activitate finalizată
 * se ascunde cu totul.
 */
const waitsForNothing = (request: Pick<RequestLike, 'status' | 'is_outgoing'>): boolean =>
  !!request.is_outgoing || isRequestFinal(request)

/**
 * Pe `status`, nu și pe `completed_at`: după #109 baza ține cele două legate
 * printr-un CHECK, deci a le citi pe amândouă ar fi o a doua definiție.
 */
export const isActivityFinal = (activity: { status?: string | null }): boolean =>
  activity.status === 'completed'

export const isPhaseFinal = (phase: { status?: string | null }): boolean =>
  phase.status === 'completed'

/**
 * Se închid „De încărcat”, „Respins” (D3) și „Aprobat” (decizia din 7 octombrie
 * 2026: închisă, rămâne „Aprobat”, dar devine finală). Niciodată „În verificare”,
 * care se verifică întâi, și niciodată un document trimis clientului (D12).
 */
export const canCloseRequest = (request: Pick<RequestLike, 'status' | 'is_outgoing' | 'deleted_at'>): boolean =>
  requestCloseRefusal(request) === null

export const isRequestClosed = (request: Pick<RequestLike, 'status'>): boolean => request.status === 'closed'

// ─── Refuzurile tranzițiilor ──────────────────────────────────────────────────
//
// Rutele răspund cu motivul în `message`: `apiFetch` rescrie `error`, deci doar
// `message` ajunge la utilizator (convenția din #70).

export type TransitionRefusal = { status: 400 | 409; message: string }

export const REQUEST_CLOSED_EDIT_MESSAGE = 'Cererea e închisă. Redeschide-o ca s-o modifici.'
export const REQUEST_REVIEW_FIRST_MESSAGE = 'Verifică întâi documentele încărcate.'
export const STATUS_PATCH_MESSAGE =
  'Starea nu se schimbă de aici: folosește „Marchează ca finalizată” sau „Readu în lucru”.'

/** De ce nu se poate închide cererea; `null` dacă se poate. */
export function requestCloseRefusal(
  request: Pick<RequestLike, 'status' | 'is_outgoing' | 'deleted_at'>,
): TransitionRefusal | null {
  if (request.is_outgoing) {
    return { status: 400, message: 'Documentele trimise clientului nu se închid.' }
  }
  if (request.deleted_at) {
    return { status: 409, message: 'Cererea a fost ștearsă între timp. Reîncarcă pagina.' }
  }
  switch (request.status) {
    case 'pending':
    case 'rejected':
    case 'approved':
      return null
    case 'review':
      return { status: 409, message: REQUEST_REVIEW_FIRST_MESSAGE }
    case 'closed':
      return { status: 409, message: 'Cererea e deja închisă.' }
    default:
      return { status: 409, message: 'Cererea nu se poate închide din starea în care e. Reîncarcă pagina.' }
  }
}

/** De ce nu se poate redeschide cererea; `null` dacă se poate. */
export function requestReopenRefusal(
  request: Pick<RequestLike, 'status' | 'deleted_at'> & { status_before_close?: string | null },
): TransitionRefusal | null {
  if (request.deleted_at) {
    return { status: 409, message: 'Cererea a fost ștearsă între timp. Reîncarcă pagina.' }
  }
  if (request.status !== 'closed') {
    return { status: 409, message: 'Cererea nu e închisă, deci nu are ce să se redeschidă.' }
  }
  if (request.status_before_close !== 'pending' && request.status_before_close !== 'rejected' && request.status_before_close !== 'approved') {
    return { status: 409, message: 'Nu știu în ce stare să readuc cererea. Reîncarcă pagina.' }
  }
  return null
}

type ItemKind = 'phase' | 'activity'

const ITEM_WORDS: Record<ItemKind, { subject: string }> = {
  phase: { subject: 'Faza' },
  activity: { subject: 'Activitatea' },
}

/** De ce nu se poate marca faza sau activitatea ca finalizată; `null` dacă se poate. */
export function completeRefusal(kind: ItemKind, status: string | null | undefined): TransitionRefusal | null {
  return status === 'completed'
    ? { status: 409, message: `${ITEM_WORDS[kind].subject} e deja finalizată.` }
    : null
}

/** De ce nu se poate readuce în lucru; `null` dacă se poate. */
export function reopenRefusal(kind: ItemKind, status: string | null | undefined): TransitionRefusal | null {
  return status === 'completed'
    ? null
    // Fără „deci e în lucru”: o stare scrisă din bază (blocked, skipped) nu e
    // finalizată, dar nici în lucru.
    : { status: 409, message: `${ITEM_WORDS[kind].subject} nu e finalizată.` }
}

// ─── Ascunderea ───────────────────────────────────────────────────────────────

export type HiddenItems = {
  phases: Set<string>
  activities: Set<string>
  requests: Set<string>
}

/**
 * Ce se ascunde când „Arată și ce e finalizat" e oprit (A9).
 *
 * Ascunderea e un filtru de afișare, nu de date: API-urile întorc tot, deci
 * căutarea, contoarele și deep-link-urile lucrează pe datele complete.
 *
 * Regula subarborelui: un element se ascunde doar dacă el *și tot ce e în el*
 * sunt finalizate. Altfel rămâne vizibil, marcat „Finalizată", iar copiii lui
 * finalizați se ascund. Fără ea, o fază finalizată ar ascunde o cerere aflată
 * încă „În verificare". Un document trimis clientului nu se ascunde singur
 * (D12), dar nici nu ține la vedere o activitate finalizată: nu așteaptă nimic
 * de la client, deci se ascunde odată cu ea (decizia din 8 octombrie 2026,
 * aceeași regulă ca la finalizare).
 *
 * `revealedIds` sunt țintele dezvăluite — deep-link, căutare, salt din panou:
 * rămân vizibile împreună cu strămoșii lor, altfel pagina ar derula spre nimic.
 */
export function hiddenFinalItems(
  phases: readonly PhaseLike[],
  requests: readonly RequestLike[],
  revealedIds: ReadonlySet<string> = new Set(),
): HiddenItems {
  const hidden: HiddenItems = { phases: new Set(), activities: new Set(), requests: new Set() }

  const liveRequests = requests.filter(request => !request.deleted_at)
  const byActivity = new Map<string, RequestLike[]>()
  for (const request of liveRequests) {
    if (request.id && isRequestFinal(request)) hidden.requests.add(request.id)
    if (!request.activity_id) continue
    const own = byActivity.get(request.activity_id) ?? []
    own.push(request)
    byActivity.set(request.activity_id, own)
  }

  for (const phase of phases) {
    let everyActivityHidden = true
    for (const activity of phase.activities ?? []) {
      const own = byActivity.get(activity.id) ?? []
      if (isActivityFinal(activity) && own.every(waitsForNothing)) hidden.activities.add(activity.id)
      else everyActivityHidden = false
    }
    if (isPhaseFinal(phase) && everyActivityHidden) hidden.phases.add(phase.id)
  }

  if (revealedIds.size === 0) return hidden

  const phaseOfActivity = new Map<string, string>()
  for (const phase of phases) {
    for (const activity of phase.activities ?? []) phaseOfActivity.set(activity.id, phase.id)
  }
  const activityOfRequest = new Map<string, string | null>()
  for (const request of liveRequests) {
    if (request.id) activityOfRequest.set(request.id, request.activity_id ?? null)
  }

  for (const id of revealedIds) {
    let activityId: string | null = null
    let phaseId: string | null = null
    if (activityOfRequest.has(id)) {
      hidden.requests.delete(id)
      activityId = activityOfRequest.get(id) ?? null
    } else if (phaseOfActivity.has(id)) {
      activityId = id
    } else {
      phaseId = id
    }
    if (activityId) {
      hidden.activities.delete(activityId)
      phaseId = phaseOfActivity.get(activityId) ?? null
    }
    if (phaseId) hidden.phases.delete(phaseId)
  }
  return hidden
}

/**
 * Câte rânduri dispar din pagină: fazele ascunse, activitățile ascunse din faze
 * vizibile și cererile ascunse din activități vizibile sau din „Cereri
 * generale". Ce stă sub un părinte ascuns nu se mai numără o dată.
 */
export function countHiddenRoots(
  hidden: HiddenItems,
  phases: readonly PhaseLike[],
  requests: readonly RequestLike[],
): number {
  let count = hidden.phases.size
  const visibleActivityIds = new Set<string>()
  for (const phase of phases) {
    if (hidden.phases.has(phase.id)) continue
    for (const activity of phase.activities ?? []) {
      if (hidden.activities.has(activity.id)) count += 1
      else visibleActivityIds.add(activity.id)
    }
  }
  for (const request of requests) {
    if (request.deleted_at || !request.id || !hidden.requests.has(request.id)) continue
    if (!request.activity_id || visibleActivityIds.has(request.activity_id)) count += 1
  }
  return count
}

/**
 * Rândul care ține locul celor ascunse dintr-o listă (D9: și la client). Toate
 * cuvintele sunt de genul feminin — fază, activitate, cerere — deci acordul e
 * mereu „finalizată / finalizate".
 */
export function hiddenFinalSummary(
  hiddenCount: number,
  total: number,
  singular: string,
  plural: string,
): { text: string; action: string } {
  if (hiddenCount >= total) {
    return total === 1
      ? { text: `Singura ${singular} e finalizată.`, action: 'Arat-o' }
      : { text: `Toate cele ${countLabel(total, singular, plural)} sunt finalizate.`, action: 'Arată-le' }
  }
  // Cu numele lucrului în text: rândul fazelor stă chiar deasupra „Cererilor
  // generale", iar un „1 finalizată ascunsă" singur s-ar fi citit ca al lor.
  return {
    text: countLabel(hiddenCount, `${singular} finalizată ascunsă`, `${plural} finalizate ascunse`),
    action: 'Arată',
  }
}

// ─── Contoare ─────────────────────────────────────────────────────────────────

export type Progress = { done: number; total: number }

export function phaseProgress(phase: Pick<PhaseLike, 'activities'>): Progress {
  const activities = phase.activities ?? []
  return { done: activities.filter(isActivityFinal).length, total: activities.length }
}

/** Cererile unei activități, fără documentele trimise clientului — ca până acum. */
export function activityProgress(activityId: string, requests: readonly RequestLike[]): Progress {
  const own = requests.filter(request =>
    request.activity_id === activityId && !request.deleted_at && !request.is_outgoing
  )
  return { done: own.filter(isRequestFinal).length, total: own.length }
}

/**
 * „3 din 5 activități finalizate". Adjectivul se acordă cu totalul: „0 din 1
 * activitate finalizată". Fără nimic de numărat rămâne doar totalul.
 */
export function progressLabel({ done, total }: Progress, singular: string, plural: string): string {
  if (total === 0) return `0 ${plural}`
  return `${done} din ${countLabel(total, singular, plural)} ${total === 1 ? 'finalizată' : 'finalizate'}`
}

// ─── Reordonarea cu elemente ascunse ──────────────────────────────────────────

/**
 * Ordinea completă după un drag & drop făcut doar printre elementele vizibile.
 *
 * Cele ascunse își păstrează locurile, iar locurile celor vizibile se umplu, în
 * ordine, cu noua ordine vizibilă. Fără asta, ruta de reordonare ar fi primit
 * `1..n` doar pentru lista afișată și ar fi pus cererile ascunse peste ele.
 */
export function mergeVisibleOrder(fullIds: readonly string[], visibleNewOrder: readonly string[]): string[] {
  const known = new Set(fullIds)
  const queue = [...new Set(visibleNewOrder)].filter(id => known.has(id))
  const moving = new Set(queue)
  let next = 0
  return fullIds.map(id => (moving.has(id) ? queue[next++] : id))
}

// ─── Ce trebuie să fie gata înainte de finalizare ─────────────────────────────
//
// Decizia din 7 octombrie 2026: o activitate se finalizează doar cu toate
// cererile ei aprobate sau închise, iar o fază doar cu toate activitățile ei
// finalizate. Doar blocare: nimic nu se finalizează singur, iar ce se redeschide
// după aceea nu atinge elementul de deasupra. Documentele trimise clientului
// nu așteaptă nimic de la el, deci nu blochează. Aceeași regulă în interfață
// (mesajul de dinainte de apel) și pe server (409).

const liveRequestsOf = (activityId: string, requests: readonly RequestLike[]) =>
  requests.filter(request => request.activity_id === activityId && !request.deleted_at)

const numeInGhilimele = (names: readonly (string | null | undefined)[]) =>
  names.slice(0, 3).map(name => `„${name ?? ''}”`).join(', ') + (names.length > 3 ? ', …' : '')

/** De ce nu se poate finaliza încă activitatea; `null` dacă se poate. */
export function activityCompletionBlocker(activityId: string, requests: readonly RequestLike[]): string | null {
  const open = liveRequestsOf(activityId, requests).filter(request => !request.is_outgoing && !isRequestFinal(request))
  if (open.length === 0) return null
  return open.length === 1
    ? `Activitatea nu se poate finaliza: cererea ${numeInGhilimele([open[0].name])} nu e încă aprobată sau închisă.`
    : `Activitatea nu se poate finaliza: ${open.length} cereri nu sunt încă aprobate sau închise (${numeInGhilimele(open.map(request => request.name))}).`
}

/** De ce nu se poate finaliza încă faza; `null` dacă se poate. */
export function phaseCompletionBlocker(activities: readonly ActivityLike[]): string | null {
  const open = activities.filter(activity => !isActivityFinal(activity))
  if (open.length === 0) return null
  return open.length === 1
    ? `Faza nu se poate finaliza: activitatea ${numeInGhilimele([open[0].name])} nu e încă finalizată.`
    : `Faza nu se poate finaliza: ${open.length} activități nu sunt încă finalizate (${numeInGhilimele(open.map(activity => activity.name))}).`
}

// ─── Confirmări ───────────────────────────────────────────────────────────────

function openRequestsLine(open: number): string | null {
  if (open === 0) return null
  return open === 1
    ? 'O cerere de documente e încă deschisă: rămâne deschisă și își păstrează reminderele.'
    : `${countLabel(open, 'cerere de documente', 'cereri de documente')} sunt încă deschise: rămân deschise și își păstrează reminderele.`
}

/** Cereri care încă așteaptă ceva; documentele trimise clientului nu așteaptă nimic. */
const openRequestCount = (own: readonly RequestLike[]) =>
  own.filter(request => !request.is_outgoing && !isRequestFinal(request)).length

/** Ce spune dialogul înainte de a marca faza ca finalizată (D2). */
export function phaseCompletionConfirm(phase: PhaseLike, requests: readonly RequestLike[]) {
  const activities = phase.activities ?? []
  const openActivities = activities.filter(activity => !isActivityFinal(activity)).length
  const own = activities.map(activity => liveRequestsOf(activity.id, requests))
  const openRequests = own.reduce((sum, list) => sum + openRequestCount(list), 0)
  // Aceeași regulă ca `hiddenFinalItems`, pentru faza deja marcată.
  const wouldHide = activities.every((activity, i) => isActivityFinal(activity) && own[i].every(waitsForNothing))

  const parts = ['Faza va apărea ca finalizată.']
  if (openActivities > 0) {
    parts.push(openActivities === 1
      ? 'O activitate din ea nu e finalizată și rămâne așa.'
      : `${countLabel(openActivities, 'activitate', 'activități')} din ea nu sunt finalizate și rămân așa.`)
  }
  const requestsLine = openRequestsLine(openRequests)
  if (requestsLine) parts.push(requestsLine)
  if (wouldHide) parts.push('Cât timp elementele finalizate sunt ascunse, faza nu mai apare în listă.')
  return {
    title: `Marchezi faza „${phase.name ?? ''}” ca finalizată?`,
    description: parts.join(' '),
    confirmText: 'Marchează ca finalizată',
  }
}

/** Ce spune dialogul înainte de a marca activitatea ca finalizată (D2). */
export function activityCompletionConfirm(activity: ActivityLike, requests: readonly RequestLike[]) {
  const own = liveRequestsOf(activity.id, requests)
  const parts = ['Activitatea va apărea ca finalizată.']
  const requestsLine = openRequestsLine(openRequestCount(own))
  if (requestsLine) parts.push(requestsLine)
  // Aceeași regulă ca `hiddenFinalItems`, pentru activitatea deja marcată.
  if (own.every(waitsForNothing)) {
    parts.push('Cât timp elementele finalizate sunt ascunse, activitatea nu mai apare în listă.')
  }
  return {
    title: `Marchezi activitatea „${activity.name ?? ''}” ca finalizată?`,
    description: parts.join(' '),
    confirmText: 'Marchează ca finalizată',
  }
}

export function requestCloseConfirm(requestName: string, status?: string | null) {
  return {
    title: `Închizi cererea „${requestName}”?`,
    description: status === 'approved'
      // Aprobată, cererea e deja finalizată; închiderea doar o încuie.
      ? 'Cererea rămâne „Aprobat”, dar devine finală: nu se mai pot încărca fișiere noi în ea și nu se mai poate modifica până o redeschizi.'
      : 'Cererea nu mai așteaptă nimic de la client: nu mai primește remindere și nu se mai pot încărca fișiere în ea. ' +
        'Nu se mai poate modifica până o redeschizi. Cât timp elementele finalizate sunt ascunse, nu mai apare în listă.',
    confirmText: 'Închide cererea',
  }
}

export function requestReopenConfirm(requestName: string, statusBeforeClose: string | null | undefined) {
  return {
    title: `Redeschizi cererea „${requestName}”?`,
    description: statusBeforeClose === 'approved'
      // O cerere aprobată nu primește remindere, deci nu are ce să-i readucă.
      ? 'Rămâne „Aprobat”, dar se poate modifica din nou, iar clientul poate încărca alte fișiere (o încărcare nouă o trimite la verificare).'
      : `Revine la „${requestStatusInfo(statusBeforeClose).label}”. Clientul nu e anunțat acum; ` +
        'reminderele automate o readuc în atenția lui la următorul prag.',
    confirmText: 'Redeschide cererea',
  }
}
