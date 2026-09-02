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

/** Toast-ul de succes după duplicarea unei faze. */
export function phaseDuplicatedMessage(
  phaseName: string,
  counts: { activities: number; documentRequests: number },
): string {
  return [
    `Faza „${phaseName}” a fost duplicată: ${countLabel(counts.activities, 'activitate', 'activități')}`
      + `, ${countLabel(counts.documentRequests, 'cerere de documente', 'cereri de documente')}.`,
    CLIENT_FILES_NOTE,
    DRAFT_NOTE,
  ].join(' ')
}

/** Toast-ul de succes după duplicarea unei activități. */
export function activityDuplicatedMessage(activityName: string, documentRequests: number): string {
  return [
    `Activitatea „${activityName}” a fost duplicată: `
      + `${countLabel(documentRequests, 'cerere de documente', 'cereri de documente')}.`,
    CLIENT_FILES_NOTE,
    DRAFT_NOTE,
  ].join(' ')
}
