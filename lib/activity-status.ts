// Starea unei activități în tabelul proiectului: un singur cuvânt, derivat din
// activitate și din cererile ei. Tabelul o pune în celula „Status”, plină, ca
// în monday — deci trebuie să spună întâi ce arde.
//
// Căi relative, cu extensie: ca `completion.ts`, se poate testa cu `node --test`.
import type { SignalTone } from './signage.ts'
import { isActivityFinal, isRequestFinal } from './completion.ts'
import { displayedRequestStatus } from './request-status.ts'

type RequestLike = {
  status?: string | null
  status_before_close?: string | null
  deadline_at?: string | null
  is_outgoing?: boolean | null
  deleted_at?: string | null
}

/** Ziua de azi, la miezul nopții, ca toate comparațiile de termen să fie pe zile. */
export function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayOf(value: string | null | undefined): number | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Tonul unei cereri. Ordinea contează: ce arde întâi. Închisă = finalizată
 * (D4), deci un termen trecut nu mai arde; o cerere închisă din „Aprobat”
 * rămâne „Aprobat”.
 */
export function requestTone(request: RequestLike, todayTs: number): SignalTone {
  const status = displayedRequestStatus(request)
  if (status === 'approved') return 'ok'
  if (status === 'closed') return 'closed'
  const due = dayOf(request.deadline_at)
  if (due !== null && due < todayTs) return 'danger'
  if (status === 'rejected') return 'danger'
  if (status === 'review') return 'review'
  if (status === 'pending') return 'pending'
  return 'neutral'
}

export type ActivityStatus = { tone: SignalTone; label: string }

/**
 * Starea activității, pentru cine se uită.
 *
 * Echipa și clientul citesc aceleași cereri altfel: pentru echipă un document
 * încărcat e „De verificat”, iar unul cerut e „La client”; pentru client primul
 * e „În verificare”, al doilea „De încărcat” — și pe acela îl vede întâi.
 */
export function activityStatus(
  activity: { status?: string | null; deadline_at?: string | null },
  requests: readonly RequestLike[],
  todayTs: number,
  isClient: boolean,
): ActivityStatus {
  if (isActivityFinal(activity)) return { tone: 'ok', label: 'Finalizată' }

  const own = requests.filter(r => !r.deleted_at && !r.is_outgoing)
  const tones = own.map(r => requestTone(r, todayTs))
  const due = dayOf(activity.deadline_at)
  const overdueRequest = own.some(r => {
    if (isRequestFinal(r)) return false
    const d = dayOf(r.deadline_at)
    return d !== null && d < todayTs
  })

  if ((due !== null && due < todayTs) || overdueRequest) return { tone: 'danger', label: 'Depășită' }
  if (own.some(r => r.status === 'rejected')) return { tone: 'danger', label: 'Document respins' }

  const review = tones.includes('review')
  const pending = tones.includes('pending')
  if (isClient) {
    if (pending) return { tone: 'pending', label: 'De încărcat' }
    if (review) return { tone: 'review', label: 'În verificare' }
  } else {
    if (review) return { tone: 'review', label: 'De verificat' }
    if (pending) return { tone: 'pending', label: 'La client' }
  }

  if (own.length > 0 && own.every(r => isRequestFinal(r))) return { tone: 'ok', label: 'Toate primite' }
  return { tone: 'neutral', label: 'În curs' }
}

/**
 * Intervalul de termene al unei faze — „6 – 20 oct” — pentru rândul de sumar al
 * grupului. Doar ce încă nu e finalizat; `overdue` dacă primul termen a trecut.
 */
export function deadlineRange(
  deadlines: readonly (string | null | undefined)[],
  todayTs: number,
): { label: string; overdue: boolean } | null {
  const days = deadlines.map(dayOf).filter((d): d is number => d !== null).sort((a, b) => a - b)
  if (days.length === 0) return null
  const first = new Date(days[0])
  const last = new Date(days[days.length - 1])
  // Luna fără punct („21 oct – 4 nov”): intervalul stă într-o pastilă îngustă.
  const fmt = (d: Date, withMonth: boolean) =>
    withMonth ? `${d.getDate()} ${d.toLocaleDateString('ro-RO', { month: 'short' }).replace(/\.$/, '')}` : String(d.getDate())
  let label: string
  if (days[0] === days[days.length - 1]) label = fmt(first, true)
  else if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) label = `${fmt(first, false)} – ${fmt(last, true)}`
  else label = `${fmt(first, true)} – ${fmt(last, true)}`
  // Anul, doar când intervalul se termină în alt an decât cel curent — ca
  // datele din rânduri.
  if (last.getFullYear() !== new Date(todayTs).getFullYear()) label += ` ${last.getFullYear()}`
  return { label, overdue: days[0] < todayTs }
}
