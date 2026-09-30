'use client'

import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'

export interface SeniorConsultant {
  id: string
  full_name: string | null
  email: string
}

function initials(name: string | null, email: string) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return email.charAt(0).toUpperCase()
}

/**
 * Alegerea supervizorilor unui dosar nou: consultanții seniori care răspund de
 * el. Cel puțin unul e obligatoriu (verificat și pe server); fiecare devine
 * membru al proiectului și îl poate administra. Titlul și explicația vin din
 * secțiunea formularului care îl găzduiește.
 */
export default function SupervisorPicker({
  seniors,
  selected,
  onChange,
  loading,
  currentUserId,
  isAdmin,
  showError,
}: {
  seniors: SeniorConsultant[]
  selected: string[]
  onChange: (ids: string[]) => void
  loading: boolean
  currentUserId: string | null
  isAdmin: boolean
  showError: boolean
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])

  if (loading) {
    return (
      <p className="flex min-h-14 items-center gap-2 text-sm text-ink-soft" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Se încarcă consultanții seniori…
      </p>
    )
  }

  if (seniors.length === 0) {
    return (
      <div className="rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-5 py-5">
        <p className="text-sm font-semibold text-ink">Nu există încă niciun consultant senior.</p>
        <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-soft">
          {isAdmin ? (
            <>
              Un dosar nu se poate deschide fără supervizor. Promovează un consultant din{' '}
              <Link href="/admin/users" className="font-semibold text-[var(--sg-accent)] underline underline-offset-2 hover:text-[var(--sg-accent-ink)]">
                pagina utilizatorilor
              </Link>
              , apoi revino aici.
            </>
          ) : (
            'Un dosar nu se poate deschide fără supervizor. Cere unui administrator să promoveze un consultant la senior, apoi revino aici.'
          )}
        </p>
      </div>
    )
  }

  return (
    <fieldset>
      <legend className="sr-only">Supervizori, cel puțin unul</legend>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {seniors.map(senior => {
          const checked = selected.includes(senior.id)
          const isMe = senior.id === currentUserId
          return (
            <li key={senior.id}>
              <label
                className={`relative flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-plate)] border px-3 py-2.5 transition-colors duration-[120ms] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--sg-accent)] ${
                  checked
                    ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]'
                    : 'border-rule bg-plate hover:border-rule-strong hover:bg-paper-sunk/60'
                }`}
              >
                {/* Inputul acoperă toată plăcuța: ținta de atingere e plăcuța, nu un pătrat de 1px. */}
                <input type="checkbox" className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed" checked={checked} onChange={() => toggle(senior.id)} />
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-xs font-bold transition-colors duration-[120ms] ${
                    checked ? 'bg-[var(--sg-accent)] text-white' : 'bg-paper-sunk text-ink-soft'
                  }`}
                >
                  {initials(senior.full_name, senior.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{senior.full_name || senior.email}</span>
                    {isMe && (
                      <span className="shrink-0 rounded-[var(--radius-plate)] border border-rule-strong px-1.5 text-[11px] font-semibold text-ink-soft">
                        tu
                      </span>
                    )}
                  </span>
                  {senior.full_name && <span className="block truncate text-xs text-ink-soft">{senior.email}</span>}
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[1px] border transition-colors duration-[120ms] ${
                    checked ? 'border-[var(--sg-accent)] bg-[var(--sg-accent)] text-white' : 'border-rule-strong bg-plate'
                  }`}
                >
                  {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {showError && selected.length === 0 && (
        <p role="alert" className="mt-3 text-sm font-semibold text-[var(--sg-danger)]">
          Alege cel puțin un supervizor ca să poți deschide dosarul.
        </p>
      )}
    </fieldset>
  )
}
