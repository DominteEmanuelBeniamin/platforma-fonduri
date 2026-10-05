// Stările unei cereri de documente, cu cuvântul și tonul lor, scrise o
// singură dată (#109).
//
// Înainte, cinci componente traduceau fiecare starea în etichetă și culoare,
// toate cu revenire pe „pending" pentru o valoare necunoscută: o cerere
// închisă i-ar fi apărut clientului drept „De încărcat". Dicționarul de aici e
// exhaustiv — TypeScript cere o intrare pentru fiecare stare — iar o valoare
// necunoscută se arată ca atare, nu ca „De încărcat".
import type { SignalTone } from './signage.ts'

export const REQUEST_STATUSES = ['pending', 'review', 'approved', 'rejected', 'closed'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export type RequestStatusInfo = {
  /** Cuvântul văzut de echipă. */
  label: string
  /** Cuvântul văzut de client: el are de încărcat, nu „așteaptă răspuns". */
  clientLabel: string
  /** Tonul semnalului, din vocabularul `lib/signage.ts`. */
  tone: SignalTone
}

export const REQUEST_STATUS_INFO: Record<RequestStatus, RequestStatusInfo> = {
  // Ceasul: mingea e la client.
  pending: { label: 'Așteaptă răspuns', clientLabel: 'De încărcat', tone: 'neutral' },
  // Ochiul: e rândul echipei să se uite.
  review: { label: 'În verificare', clientLabel: 'În verificare', tone: 'warn' },
  approved: { label: 'Aprobat', clientLabel: 'Aprobat', tone: 'ok' },
  rejected: { label: 'Respins', clientLabel: 'Respins', tone: 'danger' },
  // Separată de „Aprobat": cererea s-a încheiat fără să mai aștepte nimic.
  closed: { label: 'Închisă', clientLabel: 'Închisă', tone: 'closed' },
}

const UNKNOWN_STATUS: RequestStatusInfo = {
  label: 'Stare necunoscută',
  clientLabel: 'Stare necunoscută',
  tone: 'neutral',
}

export function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value)
}

export function requestStatusInfo(status: string | null | undefined): RequestStatusInfo {
  return isRequestStatus(status) ? REQUEST_STATUS_INFO[status] : UNKNOWN_STATUS
}

/** Cuvântul stării pentru cine se uită: clientul sau echipa. */
export function requestStatusLabel(status: string | null | undefined, isClient: boolean): string {
  const info = requestStatusInfo(status)
  return isClient ? info.clientLabel : info.label
}

/** Ce vede clientul pe o cerere închisă, în locul zonei de încărcare. */
export const CLOSED_REQUEST_CLIENT_NOTE = 'Consultantul a închis cererea; nu mai e nevoie să încarci nimic aici.'
