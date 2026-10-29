/**
 * Sufixul pe care îl pune chiar funcția asta: „ (copie)” sau „ (copie 7)”. Fără
 * diferențe de majuscule, ca să recunoască și „ (Copie)” pus de duplicarea
 * veche a șabloanelor (Z-01).
 */
const COPY_SUFFIX = /\s*\(copie(?:\s+\d+)?\)$/i

/**
 * Numele unei copii, în stilul „X (copie)” / „X (copie 2)”.
 *
 * `existingNames` sunt numele fraților (inclusiv originalul), ca o a doua
 * duplicare să nu mai producă încă un „X (copie)” identic.
 *
 * Duplicarea unei copii repornește de la numele-rădăcină: altfel se ajungea la
 * „X (copie) (copie) (copie)”, cu numărul de copieri citit din coadă în loc de
 * numele elementului.
 */
export function buildCopyName(
  originalName: string | null | undefined,
  existingNames: Iterable<string | null | undefined>,
  normalize = (name: string | null | undefined) => (name ?? '').trim().toLowerCase(),
): string {
  const trimmed = (originalName ?? '').trim()
  // Toate sufixele: o copie veche poate fi deja „X (Copie) (Copie)”.
  let base = trimmed
  while (COPY_SUFFIX.test(base)) base = base.replace(COPY_SUFFIX, '').trim()
  base = base || 'Fără nume'

  const taken = new Set<string>()
  for (const name of existingNames) {
    const normalized = normalize(name)
    if (normalized) taken.add(normalized)
  }

  const first = `${base} (copie)`
  if (!taken.has(normalize(first))) return first

  let counter = 2
  while (taken.has(normalize(`${base} (copie ${counter})`))) counter++
  return `${base} (copie ${counter})`
}
