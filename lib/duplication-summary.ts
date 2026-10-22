// Ce anunță interfața după o duplicare (#15).
//
// Serverul întoarce numerele, dar regula lui — „structura și fișierele-model se
// copiază, fișierele urcate de client nu” — nu apare nicăieri altundeva în
// interfață. Textul e scris o dată aici, ca bara laterală și panoul central să
// spună același lucru.

// Cale relativă, cu extensie: fișierul e importat și din teste rulate direct cu
// `node --test`, iar Node nu cunoaște aliasul `@/`.
import { countLabel } from './calendar.ts'

const CLIENT_FILES_NOTE = 'Fișierele încărcate de client nu se copiază.'
const DRAFT_NOTE = 'Copia este în pregătire.'

export function omittedAssignmentsMessage(count: number): string {
  if (count <= 0) return ''
  if (count === 1) {
    return 'O atribuire implicită a fost omisă: consultantul nu mai este disponibil, iar elementul a rămas neatribuit.'
  }
  return `${countLabel(count, 'atribuire', 'atribuiri')} implicite au fost omise: consultanții nu mai sunt disponibili, iar elementele au rămas neatribuite.`
}

/** Toast-ul de succes după duplicarea unei faze. */
export function phaseDuplicatedMessage(
  phaseName: string,
  counts: { activities: number; documentRequests: number },
  omittedAssignments = 0,
): string {
  return [
    `Faza „${phaseName}” a fost duplicată: ${countLabel(counts.activities, 'activitate', 'activități')}`
      + `, ${countLabel(counts.documentRequests, 'cerere de documente', 'cereri de documente')}.`,
    omittedAssignmentsMessage(omittedAssignments),
    CLIENT_FILES_NOTE,
    DRAFT_NOTE,
  ].filter(Boolean).join(' ')
}

/** Toast-ul de succes după duplicarea unei activități. */
export function activityDuplicatedMessage(activityName: string, documentRequests: number, omittedAssignments = 0): string {
  return [
    `Activitatea „${activityName}” a fost duplicată: `
      + `${countLabel(documentRequests, 'cerere de documente', 'cereri de documente')}.`,
    omittedAssignmentsMessage(omittedAssignments),
    CLIENT_FILES_NOTE,
    DRAFT_NOTE,
  ].filter(Boolean).join(' ')
}

/**
 * Confirmarea dinaintea duplicării: un clic greșit în „⋯” crea o copie
 * întreagă (feedback-ul lui Sandu, 22 octombrie 2026). Aceleași texte în
 * tabel și în panoul fazelor.
 */
export function phaseDuplicateConfirm(name: string) {
  return {
    title: `Duplici faza «${name}»?`,
    description: `Copia apare sub ea, cu activitățile și cererile ei. ${CLIENT_FILES_NOTE} ${DRAFT_NOTE}`,
    confirmText: 'Duplică',
  }
}

export function activityDuplicateConfirm(name: string) {
  return {
    title: `Duplici activitatea «${name}»?`,
    description: `Copia apare sub ea, cu cererile ei. ${CLIENT_FILES_NOTE} ${DRAFT_NOTE}`,
    confirmText: 'Duplică',
  }
}
