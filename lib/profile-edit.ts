import { isValidReminderEmail } from './reminder-email.ts'

// Datele unui cont pe care le modifică adminul, pe rol. Aceleași câmpuri și
// aceleași obligatorii ca la crearea contului (#111); CIF-ul clientului are
// regulile lui, în lib/cif.ts.

export type EditableRole = 'client' | 'consultant' | 'admin'
export type ProfileTextField = 'email' | 'full_name' | 'telefon' | 'nume_firma' | 'adresa_firma' | 'departament' | 'specializare'
export type ProfileFieldSpec = {
  key: ProfileTextField
  label: string
  required: boolean
  type: 'email' | 'tel' | 'text'
  autoComplete?: string
}

const EMAIL: ProfileFieldSpec = { key: 'email', label: 'Email (cu el intră în cont)', required: true, type: 'email', autoComplete: 'off' }
const TELEFON: ProfileFieldSpec = { key: 'telefon', label: 'Telefon', required: false, type: 'tel', autoComplete: 'off' }

export const PROFILE_FIELDS: Record<EditableRole, ProfileFieldSpec[]> = {
  client: [
    { key: 'nume_firma', label: 'Nume firmă', required: true, type: 'text' },
    { key: 'adresa_firma', label: 'Adresă firmă', required: true, type: 'text' },
    { key: 'full_name', label: 'Persoana de contact', required: true, type: 'text' },
    EMAIL,
    TELEFON,
  ],
  consultant: [
    { key: 'full_name', label: 'Nume complet', required: true, type: 'text' },
    EMAIL,
    TELEFON,
    { key: 'specializare', label: 'Specializare', required: true, type: 'text' },
    { key: 'departament', label: 'Departament', required: false, type: 'text' },
  ],
  admin: [
    { key: 'full_name', label: 'Nume complet', required: true, type: 'text' },
    EMAIL,
    TELEFON,
    { key: 'departament', label: 'Departament', required: false, type: 'text' },
  ],
}

export function isEditableRole(role: unknown): role is EditableRole {
  return role === 'client' || role === 'consultant' || role === 'admin'
}

export function normalizeProfileEmail(value: string) {
  return value.trim().toLowerCase()
}

/** Prima problemă din datele trimise pentru rolul dat, sau `null`. Câmpurile lipsă rămân neatinse. */
export function profileFieldProblem(
  role: EditableRole,
  values: Partial<Record<ProfileTextField, unknown>>,
): { field: ProfileTextField; message: string } | null {
  const specs = PROFILE_FIELDS[role]
  for (const key of Object.keys(values) as ProfileTextField[]) {
    const spec = specs.find(item => item.key === key)
    if (!spec) return { field: key, message: 'Câmpul acesta nu există pentru acest tip de cont.' }
    const value = values[key]
    if (value !== null && typeof value !== 'string') return { field: key, message: 'Datele trimise nu sunt valide.' }
    const text = typeof value === 'string' ? value.trim() : ''
    if (spec.required && !text) return { field: key, message: `Completează ${spec.label.toLowerCase().replace(/ \(.*\)$/, '')}.` }
    if (text.length > 300) return { field: key, message: `${spec.label.replace(/ \(.*\)$/, '')}: cel mult 300 de caractere.` }
    if (key === 'email' && (!isValidReminderEmail(text) || text.length > 254)) {
      return { field: key, message: 'Completează un email valid.' }
    }
  }
  return null
}
