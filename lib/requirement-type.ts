// Categoria unei cereri de document.
// Înlocuiește vechiul boolean `is_mandatory` (păstrat în DB pentru compatibilitate).
export type RequirementType = 'obligatoriu' | 'daca_e_cazul' | 'optional'

export const REQUIREMENT_TYPES: RequirementType[] = ['obligatoriu', 'daca_e_cazul', 'optional']

export const REQUIREMENT_LABELS: Record<RequirementType, string> = {
  obligatoriu: 'Obligatoriu',
  daca_e_cazul: 'Dacă este cazul',
  optional: 'Opțional',
}

// Stil badge per categorie.
export const REQUIREMENT_BADGE: Record<RequirementType, { bg: string; text: string; border: string }> = {
  obligatoriu: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  daca_e_cazul: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  optional: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
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
