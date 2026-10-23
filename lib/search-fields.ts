import type { SearchField } from './search.ts'

/**
 * Ce se caută la un proiect (#112), într-un singur loc, ca Home, tabloul de
 * bord și calendarul să găsească același proiect după aceleași lucruri.
 *
 * Câmpurile lipsă nu se caută: fiecare pagină trimite doar ce rolul curent are
 * voie să vadă, iar API-ul nu aduce mai mult.
 */
export interface ProjectSearchInfo {
  cod_intern?: string | null
  firm?: string | null
  cif?: string | null
  address?: string | null
  /** Consultantul general și echipa, deduplicați. */
  consultants?: string[]
  template?: string | null
  /** „Program / Măsură". */
  program?: string | null
}

export function projectSearchFields(
  project: { title: string | null | undefined; client_name?: string | null; search?: ProjectSearchInfo | null },
  options: { clientShown?: boolean } = {},
): SearchField[] {
  const s = project.search ?? {}
  return [
    { key: 'title', label: 'Titlu', value: project.title },
    { key: 'client', label: 'Client', value: project.client_name, shown: options.clientShown !== false },
    { key: 'cod', label: 'Cod', value: s.cod_intern, shown: false },
    { key: 'firma', label: 'Firmă', value: s.firm, shown: false },
    { key: 'cif', label: 'CIF', value: s.cif, kind: 'cif', shown: false },
    { key: 'adresa', label: 'Adresă', value: s.address, shown: false },
    { key: 'consultanti', label: 'Consultanți', value: s.consultants?.join(', '), shown: false },
    { key: 'sablon', label: 'Șablon', value: s.template, shown: false },
    { key: 'program', label: 'Program', value: s.program, shown: false },
  ]
}

/** „Program / Măsură" din relația `measure → program` a unui șablon. */
export function programLabel(measure: { name?: string | null; program?: { name?: string | null } | null } | null | undefined): string | null {
  return [measure?.program?.name, measure?.name].filter(Boolean).join(' / ') || null
}

/** Numele afișate ale consultanților, fără repetiții. */
export function consultantNames(people: ({ full_name?: string | null; email?: string | null } | null | undefined)[]): string[] {
  return [...new Set(people.map(p => p?.full_name?.trim() || p?.email?.trim() || '').filter(Boolean))]
}
