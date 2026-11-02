'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { Pencil } from 'lucide-react'
import { useToast } from '@/app/providers/ToastProvider'
import { Button } from '@/components/ui/Button'
import CifInput, { type CifInputError, type CifInputValue } from '@/components/CifInput'
import { parseCif, validateCif } from '@/lib/cif'
import { serverMessage } from '@/lib/api-error'
import { PROFILE_FIELDS, isEditableRole, normalizeProfileEmail, profileFieldProblem, type ProfileTextField } from '@/lib/profile-edit'

export type EditableProfile = {
  id: string
  role: string
  email: string | null
  full_name: string | null
  telefon: string | null
  cif: string | null
  nume_firma: string | null
  adresa_firma: string | null
  departament: string | null
  specializare: string | null
  creation_pending?: boolean | null
}

const inputClass =
  'h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] ' +
  'aria-[invalid=true]:border-[var(--sg-danger)] sm:h-10'

function initialValues(source: EditableProfile): Record<ProfileTextField, string> {
  return {
    email: source.email ?? '', full_name: source.full_name ?? '', telefon: source.telefon ?? '',
    nume_firma: source.nume_firma ?? '', adresa_firma: source.adresa_firma ?? '',
    departament: source.departament ?? '', specializare: source.specializare ?? '',
  }
}

function cifValue(cif: string | null): CifInputValue {
  const parsed = parseCif(cif)
  return parsed.ok ? { country: parsed.country, number: parsed.number } : { country: 'RO', number: cif ?? '' }
}

/**
 * Datele contului, pe pagina utilizatorului din Administrare. Le modifică doar
 * adminul (pagina e deja doar a lui, iar serverul verifică din nou). Se trimit
 * numai câmpurile schimbate; o schimbare de email cere confirmare, fiindcă
 * omul va intra în cont cu adresa nouă.
 */
export function UserProfileEditor({
  user,
  apiFetch,
  onSaved,
}: {
  user: EditableProfile
  apiFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>
  onSaved: (profile: EditableProfile) => void
}) {
  const { showToast, confirm } = useToast()
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState<Record<ProfileTextField, string>>(() => initialValues(user))
  const [cif, setCif] = useState<CifInputValue>(() => cifValue(user.cif))
  const [cifError, setCifError] = useState<CifInputError | null>(null)
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null)

  if (!isEditableRole(user.role)) return null
  const role = user.role
  const fields = PROFILE_FIELDS[role]
  const isClient = role === 'client'
  const editable = !user.creation_pending

  const startEditing = () => {
    setValues(initialValues(user))
    setCif(cifValue(user.cif))
    setCifError(null)
    setError(null)
    setEditing(true)
  }

  const focusField = (name: string) => {
    const input = formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`)
    input?.focus()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setError(null)

    const changes: Record<string, string | null> = {}
    for (const field of fields) {
      const next = values[field.key].trim()
      const before = (user[field.key] ?? '').trim()
      const same = field.key === 'email' ? normalizeProfileEmail(next) === normalizeProfileEmail(before) : next === before
      if (!same) changes[field.key] = field.key === 'email' ? normalizeProfileEmail(next) : next || null
    }
    const problem = profileFieldProblem(role, changes)
    if (problem) {
      setError({ field: problem.field, message: problem.message })
      focusField(problem.field)
      return
    }
    let cifCountry: string | undefined
    if (isClient) {
      const result = validateCif(cif.number, cif.country)
      if (!result.ok) {
        setCifError(result)
        focusField(result.field)
        return
      }
      if (result.cif !== user.cif) {
        changes.cif = result.cif
        cifCountry = result.country
      }
    }
    if (Object.keys(changes).length === 0) {
      setEditing(false)
      showToast('Nimic de salvat: datele erau deja așa.', 'info')
      return
    }
    if (changes.email && !await confirm({
      title: 'Schimbi emailul de autentificare?',
      description: `De acum, contul intră cu ${changes.email}, nu cu ${user.email}. Parola rămâne aceeași; anunțăm ambele adrese pe email.`,
      confirmText: 'Schimbă emailul',
    })) return

    setSaving(true)
    try {
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cifCountry ? { ...changes, cifCountry } : changes),
      })
      if (!res.ok) {
        const body: unknown = await res.clone().json().catch(() => null)
        const field = (body as { field?: unknown } | null)?.field
        const message = await serverMessage(res, 'Nu am putut salva datele. Încearcă din nou.')
        if (field === 'cif' || field === 'cifCountry') {
          setCifError({ field, message })
        } else {
          setError({ field: typeof field === 'string' ? field : null, message })
        }
        if (typeof field === 'string') focusField(field)
        return
      }
      const { profile } = await res.json() as { profile: EditableProfile }
      onSaved({ ...user, ...profile })
      setEditing(false)
      showToast(changes.email ? 'Datele și emailul de autentificare au fost schimbate.' : 'Datele contului au fost salvate.', 'success')
    } catch {
      setError({ field: null, message: 'Nu am putut salva datele. Verifică legătura la internet și încearcă din nou.' })
    } finally {
      setSaving(false)
    }
  }

  const rows: Array<[string, string | null]> = [
    ...(isClient ? [['CUI / CIF', user.cif] as [string, string | null]] : []),
    ...fields.map(field => [field.label.replace(/ \(.*\)$/, ''), user[field.key]] as [string, string | null]),
  ]
  const errorId = `${formId}-eroare`

  return (
    <section aria-labelledby={`${formId}-titlu`} className="mb-6 rounded-[var(--radius-plate)] border border-rule bg-plate">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4 sm:px-6">
        <div>
          <h2 id={`${formId}-titlu`} className="text-lg font-bold text-ink">Datele contului</h2>
          <p className="text-sm text-ink-soft">
            {isClient ? 'Firma, persoana de contact și emailul cu care intră în cont.' : 'Persoana și emailul cu care intră în cont.'}
          </p>
        </div>
        {!editing && editable && (
          <Button variant="secondary" size="sm" onClick={startEditing} data-tooltip="Modifică datele acestui cont">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editează datele
          </Button>
        )}
      </div>

      {!editing ? (
        <dl className="grid gap-x-6 gap-y-3 px-5 py-5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)] sm:px-6">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-semibold text-ink-soft">{label}</dt>
              <dd className="min-w-0 break-words text-ink">{value?.trim() || <span className="text-ink-faint">—</span>}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <form ref={formRef} onSubmit={submit} noValidate aria-busy={saving} className="space-y-5 px-5 py-5 sm:px-6">
          {isClient && (
            <CifInput
              value={cif}
              disabled={saving}
              error={cifError}
              onChange={value => {
                setCif(value)
                if (cifError || value.country !== cif.country) {
                  const result = validateCif(value.number, value.country)
                  setCifError(result.ok ? null : result)
                }
              }}
              onBlur={() => {
                const result = validateCif(cif.number, cif.country)
                setCifError(result.ok ? null : result)
              }}
            />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map(field => {
              const id = `${formId}-${field.key}`
              const invalid = error?.field === field.key
              return (
                <div key={field.key} className={field.key === 'adresa_firma' || field.key === 'nume_firma' ? 'sm:col-span-2' : undefined}>
                  <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
                    {field.label}{field.required && <span className="ml-0.5 text-[var(--sg-danger)]" aria-hidden="true">*</span>}
                  </label>
                  <input
                    id={id}
                    name={field.key}
                    type={field.type}
                    autoComplete={field.autoComplete}
                    required={field.required}
                    disabled={saving}
                    value={values[field.key]}
                    onChange={event => {
                      const value = event.target.value
                      setValues(current => ({ ...current, [field.key]: value }))
                      if (error?.field === field.key) setError(null)
                    }}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errorId : undefined}
                    className={inputClass}
                  />
                  {field.key === 'email' && (
                    <p className="mt-1 text-xs leading-5 text-ink-soft">Dacă o schimbi, omul intră cu adresa nouă; parola rămâne aceeași.</p>
                  )}
                </div>
              )
            })}
          </div>

          {error && <p id={errorId} role="alert" className="text-sm text-[var(--sg-danger)]">{error.message}</p>}

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="quiet" disabled={saving} onClick={() => setEditing(false)} data-tooltip="Renunță la modificări">
              Renunță
            </Button>
            <Button type="submit" variant="primary" disabled={saving} data-tooltip="Salvează datele contului">
              {saving ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
