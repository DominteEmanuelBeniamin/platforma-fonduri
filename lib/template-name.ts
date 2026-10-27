/**
 * Numele unui șablon trebuie să fie unic (D10, S-31): două șabloane cu exact
 * același nume nu se pot deosebi la crearea unui proiect. Fără spațiile de la
 * capete și fără diferențe de majuscule, ca „Start-Up Nation” și
 * „start-up nation ” să fie același nume.
 *
 * Fără importuri cu alias: testele (`node --test`) îl încarcă direct.
 */

export function normalizeTemplateName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro-RO')
}

/**
 * Numele altui șablon cu care s-ar confunda `name`, sau `null`. `ownId` e
 * șablonul care se redenumește: propriul nume nu e conflict.
 */
export function templateNameConflict(
  name: string,
  others: readonly { id: string; name: string | null }[],
  ownId?: string | null,
): string | null {
  const wanted = normalizeTemplateName(name)
  if (!wanted) return null
  const clash = others.find(other => other.id !== ownId && normalizeTemplateName(other.name) === wanted)
  return clash?.name ?? null
}

/**
 * Verificarea se face doar când numele chiar se schimbă: șabloanele vechi,
 * duplicate dinainte de regulă, rămân editabile cât își păstrează numele.
 */
export function templateNameChanged(before: string | null | undefined, after: string | null | undefined): boolean {
  return normalizeTemplateName(before) !== normalizeTemplateName(after)
}

export function templateNameTakenMessage(name: string): string {
  return `Există deja un șablon numit «${name.trim()}». Alege alt nume.`
}
