/** Sufixul pe care îl pune chiar funcția asta: „ (copie)” sau „ (copie 7)”. */
const COPY_SUFFIX = /\s*\(copie(?:\s+\d+)?\)$/

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
): string {
  const trimmed = (originalName ?? '').trim()
  const base = trimmed.replace(COPY_SUFFIX, '').trim() || 'Fără nume'

  const taken = new Set<string>()
  for (const name of existingNames) {
    const normalized = (name ?? '').trim().toLowerCase()
    if (normalized) taken.add(normalized)
  }

  const first = `${base} (copie)`
  if (!taken.has(first.toLowerCase())) return first

  let counter = 2
  while (taken.has(`${base} (copie ${counter})`.toLowerCase())) counter++
  return `${base} (copie ${counter})`
}
