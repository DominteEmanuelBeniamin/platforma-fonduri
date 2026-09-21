// Categoria unei cereri de document.
// Înlocuiește vechiul boolean `is_mandatory` (păstrat în DB pentru compatibilitate).
export type RequirementType = 'obligatoriu' | 'daca_e_cazul' | 'optional'

export const REQUIREMENT_TYPES: RequirementType[] = ['obligatoriu', 'daca_e_cazul', 'optional']

export const REQUIREMENT_LABELS: Record<RequirementType, string> = {
  obligatoriu: 'Obligatoriu',
  daca_e_cazul: 'Dacă este cazul',
  optional: 'Opțional',
}

/**
 * Stilul plăcuței, per categorie.
 *
 * Tipul de cerință e o clasificare, nu o stare: un document obligatoriu nu
 * arde prin simplul fapt că e obligatoriu. De aceea nu poartă roșu — semnalele
 * rămân rezervate pentru termene depășite și respingeri. Ierarhia se face din
 * greutate și din muchie, nu din culoare.
 */
export const REQUIREMENT_BADGE: Record<RequirementType, { bg: string; text: string; border: string }> = {
  obligatoriu: { bg: 'bg-paper-sunk', text: 'text-ink', border: 'border-rule-strong' },
  daca_e_cazul: { bg: 'bg-paper-sunk', text: 'text-ink-soft', border: 'border-rule' },
  optional: { bg: 'bg-transparent', text: 'text-ink-faint', border: 'border-rule' },
}

export function isRequirementType(value: unknown): value is RequirementType {
  return value === 'obligatoriu' || value === 'daca_e_cazul' || value === 'optional'
}

// Acceptă fie un requirement_type explicit, fie (fallback) vechiul is_mandatory.
export function normalizeRequirementType(
  value?: string | null,
  isMandatory?: boolean | null,
): RequirementType {
  if (isRequirementType(value)) return value
  return isMandatory ? 'obligatoriu' : 'optional'
}

export function requirementTypeToMandatory(type: RequirementType): boolean {
  return type === 'obligatoriu'
}
