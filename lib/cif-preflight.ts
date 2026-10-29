import { validateCif } from './cif.ts'

/** Numai totaluri: inventarul de lansare nu expune CIF-uri sau titulari în loguri. */
export function inspectCifProfiles(profiles: readonly { role: string; cif: string | null }[]) {
  const counts = { missing: 0, invalid: 0, nonCanonical: 0, duplicates: 0 }
  const seen = new Set<string>()
  for (const profile of profiles) {
    if (profile.cif === null) {
      if (profile.role === 'client') counts.missing++
      continue
    }
    const result = validateCif(profile.cif)
    if (!result.ok) {
      if (profile.role === 'client' && result.code === 'CIF_REQUIRED') counts.missing++
      else counts.invalid++
      continue
    }
    if (profile.cif !== result.cif) counts.nonCanonical++
    if (seen.has(result.cif)) counts.duplicates++
    seen.add(result.cif)
  }
  return { valid: Object.values(counts).every(count => count === 0), ...counts }
}
