// Încheierea și redeschiderea unui proiect (#109), scrise o singură dată.
//
// Le folosesc cronul de remindere, calendarul, tabloul de bord, Home și pagina
// proiectului. Fișierul nu importă calendarul: cronul are nevoie doar de
// regula „proiect activ", nu de toată aritmetica de calendar.
//
// Căi relative, cu extensie: fișierul are teste rulate direct cu `node --test`.
import { countLabel } from './count-label.ts'
import { getDaysUntilDeadline } from './document-reminder.ts'

/**
 * Proiect „în lucru". Gardă pe egalitate cu `active`, nu pe o listă de valori
 * încheiate: o valoare necunoscută sau lipsă cade în „încheiat" și se ascunde
 * implicit, în loc să se strecoare tăcut în listele pe care echipa le crede
 * curente. Același test oprește și reminderele automate, de aceea migrarea din
 * #109 a făcut coloana `not null` — un NULL ar fi oprit tăcut emailurile.
 */
export const isProjectActive = (project: { lifecycle_status?: string | null }): boolean =>
  project.lifecycle_status === 'active'

/**
 * Data încheierii, în formatul folosit deja în aplicație: „12 oct. 2026".
 * În ora României, ca toată echipa și clientul să vadă aceeași zi: o
 * încheiere la 00:30, ora României, e încă ziua precedentă în UTC.
 */
export function formatClosedDate(closedAt: string | null | undefined): string | null {
  if (!closedAt) return null
  const date = new Date(closedAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Bucharest' })
}

/**
 * Textul badge-ului de lângă titlu. Numele autorului apare doar pentru echipă:
 * clientul nu primește `closed_by`, deci nici numele.
 */
export function projectClosedLabel(closedAt: string | null | undefined, closerName?: string | null): string {
  const date = formatClosedDate(closedAt)
  const base = date ? `Încheiat pe ${date}` : 'Încheiat'
  const name = closerName?.trim()
  return name ? `${base} · de ${name}` : base
}

// Motivele refuzului, în câmpul `message` al răspunsului: `apiFetch` rescrie
// `error`, deci doar `message` ajunge la utilizator (convenția din #70).
export const PROJECT_ALREADY_CLOSED_MESSAGE = 'Proiectul e deja încheiat.'
export const PROJECT_NOT_CLOSED_MESSAGE = 'Proiectul nu e încheiat, deci nu are ce să se redeschidă.'
export const PROJECT_LIFECYCLE_PATCH_MESSAGE =
  'Proiectul se încheie și se redeschide din meniul „Mai multe acțiuni” al paginii lui.'

/** Titlul comutatorului de remindere cât timp proiectul e încheiat. */
export const PROJECT_CLOSED_REMINDERS_HINT = 'Proiectul e încheiat; reminderele automate sunt oprite.'

export function projectCloseConfirm(projectTitle: string) {
  return {
    title: `Închei proiectul „${projectTitle}”?`,
    description:
      'Reminderele automate se opresc, iar ce a rămas deschis iese din listele de lucru ale echipei și ale clientului. ' +
      'Proiectul rămâne de consultat și se poate redeschide oricând.',
    confirmText: 'Încheie proiectul',
  }
}

/**
 * La redeschidere, cronul de a doua zi trimite „Termen depășit" pentru tot ce a
 * trecut de termen între timp (câte unul, dacă nu fusese trimis înainte de
 * încheiere). Confirmarea spune dinainte câte sunt, ca valul de emailuri să nu
 * fie o surpriză.
 */
export function projectReopenConfirm(projectTitle: string, overdueCount: number, remindersEnabled = true) {
  const parts = [
    remindersEnabled
      ? 'Proiectul revine în listele de lucru, iar reminderele automate pornesc din nou.'
      : 'Proiectul revine în listele de lucru. Reminderele automate rămân oprite, cum erau.',
  ]
  if (overdueCount > 0) {
    const overdue = overdueCount === 1
      ? 'Un termen e deja depășit'
      : `${countLabel(overdueCount, 'termen', 'termene')} sunt deja depășite`
    parts.push(remindersEnabled
      ? `${overdue}: la următoarea rulare se trimite „Termen depășit” pentru ce nu l-a primit înainte de încheiere.`
      : `${overdue}.`)
  }
  return {
    title: `Redeschizi proiectul „${projectTitle}”?`,
    description: parts.join(' '),
    confirmText: 'Redeschide proiectul',
  }
}

type ActivityDeadline = { id?: string; status?: string | null; deadline_at?: string | null; visibility?: string | null }
type PhaseDeadline = { visibility?: string | null; activities?: readonly ActivityDeadline[] | null }
type RequestDeadlineItem = {
  status?: string | null
  deadline_at?: string | null
  visibility?: string | null
  activity_id?: string | null
  is_outgoing?: boolean | null
  deleted_at?: string | null
}

/**
 * Câte termene depășite va anunța cronul după redeschidere: aceleași reguli ca
 * `selectDeadlineReminderCandidates` (lib/deadline-reminder-candidates.ts) —
 * doar ce e publicat, activitățile în așteptare sau în lucru, cererile „De
 * încărcat” și „Respins”, fără documentele trimise clientului. Ziua se
 * socotește ca la cron, în fusul reminderelor. Altfel confirmarea ar fi promis
 * emailuri pentru ciorne sau pentru cereri aflate deja în verificare.
 */
export function countOverdueOpenItems(
  phases: readonly PhaseDeadline[],
  requests: readonly RequestDeadlineItem[],
  now = new Date(),
): number {
  const overdue = (deadlineAt: string | null | undefined) => {
    const days = getDaysUntilDeadline(deadlineAt ?? null, now)
    return days !== null && days < 0
  }
  const published = (visibility: string | null | undefined) => visibility === 'published'
  const visibleActivities = new Set<string>()
  let count = 0
  for (const phase of phases) {
    for (const activity of phase.activities ?? []) {
      if (!published(phase.visibility) || !published(activity.visibility)) continue
      if (activity.id) visibleActivities.add(activity.id)
      if ((activity.status === 'pending' || activity.status === 'in_progress') && overdue(activity.deadline_at)) count += 1
    }
  }
  for (const request of requests) {
    if (request.is_outgoing || request.deleted_at) continue
    if (request.status !== 'pending' && request.status !== 'rejected') continue
    if (!published(request.visibility)) continue
    if (request.activity_id && !visibleActivities.has(request.activity_id)) continue
    if (overdue(request.deadline_at)) count += 1
  }
  return count
}
