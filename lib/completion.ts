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
 * nu e niciodată finalizat, nici pentru numărătoare, nici pentru ascundere
 * (D12): rămâne `pending` pentru totdeauna și e mereu de văzut.
 */
export const isRequestFinal = (request: Pick<RequestLike, 'status' | 'is_outgoing'>): boolean =>
  !request.is_outgoing && (request.status === 'approved' || request.status === 'closed')

/**
 * Pe `status`, nu și pe `completed_at`: după #109 baza ține cele două legate
 * printr-un CHECK, deci a le citi pe amândouă ar fi o a doua definiție.
 */
export const isActivityFinal = (activity: { status?: string | null }): boolean =>
  activity.status === 'completed'

export const isPhaseFinal = (phase: { status?: string | null }): boolean =>
  phase.status === 'completed'

/** Doar „De încărcat" și „Respins" se închid (D3), niciodată un document trimis clientului (D12). */
export const canCloseRequest = (request: Pick<RequestLike, 'status' | 'is_outgoing' | 'deleted_at'>): boolean =>
  !request.is_outgoing && !request.deleted_at && (request.status === 'pending' || request.status === 'rejected')

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
      return null
    case 'review':
      return { status: 409, message: REQUEST_REVIEW_FIRST_MESSAGE }
    case 'approved':
      return { status: 409, message: 'Cererea e aprobată, deci deja finalizată.' }
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
  if (request.status_before_close !== 'pending' && request.status_before_close !== 'rejected') {
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
    : { status: 409, message: `${ITEM_WORDS[kind].subject} nu e finalizată, deci e deja în lucru.` }
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
 * încă „În verificare". O activitate cu un document trimis clientului nu se
 * ascunde niciodată, fiindcă documentul nu e niciodată finalizat (D12).
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
      if (isActivityFinal(activity) && own.every(isRequestFinal)) hidden.activities.add(activity.id)
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

// ─── Confirmări ───────────────────────────────────────────────────────────────

function openRequestsLine(open: number): string | null {
  if (open === 0) return null
  return open === 1
    ? 'O cerere de documente e încă deschisă: rămâne deschisă și își păstrează reminderele.'
    : `${countLabel(open, 'cerere de documente', 'cereri de documente')} sunt încă deschise: rămân deschise și își păstrează reminderele.`
}

const liveRequestsOf = (activityId: string, requests: readonly RequestLike[]) =>
  requests.filter(request => request.activity_id === activityId && !request.deleted_at)

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
  const wouldHide = activities.every((activity, i) => isActivityFinal(activity) && own[i].every(isRequestFinal))

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
  if (own.every(isRequestFinal)) {
    parts.push('Cât timp elementele finalizate sunt ascunse, activitatea nu mai apare în listă.')
  }
  return {
    title: `Marchezi activitatea „${activity.name ?? ''}” ca finalizată?`,
    description: parts.join(' '),
    confirmText: 'Marchează ca finalizată',
  }
}

export function requestCloseConfirm(requestName: string) {
  return {
    title: `Închizi cererea „${requestName}”?`,
    description:
      'Cererea nu mai așteaptă nimic de la client: nu mai primește remindere și nu se mai pot încărca fișiere în ea. ' +
      'Nu se mai poate modifica până o redeschizi.',
    confirmText: 'Închide cererea',
  }
}

export function requestReopenConfirm(requestName: string, statusBeforeClose: string | null | undefined) {
  return {
    title: `Redeschizi cererea „${requestName}”?`,
    description:
      `Revine la „${requestStatusInfo(statusBeforeClose).label}”. Clientul nu e anunțat acum; ` +
      'reminderele automate o readuc în atenția lui la următorul prag.',
    confirmText: 'Redeschide cererea',
  }
}
