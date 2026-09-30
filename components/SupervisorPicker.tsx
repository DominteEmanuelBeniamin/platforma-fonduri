'use client'

import Link from 'next/link'
import { Check, ShieldCheck, Loader2 } from 'lucide-react'

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
 * membru al proiectului și îl poate administra.
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

  const count = selected.length
  const missing = count === 0

  return (
    <section aria-labelledby="supervizori-titlu" className="bg-white rounded-xl border border-rule shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-paper-sunk px-6 py-4">
        <h2 id="supervizori-titlu" className="flex items-center gap-2 font-semibold text-ink">
          <ShieldCheck className="h-4 w-4 text-[var(--sg-accent)]" aria-hidden="true" />
          Supervizori
        </h2>
        <span
          className={`text-xs font-medium tabular-nums ${missing ? 'text-ink-faint' : 'text-[var(--sg-accent-ink)]'}`}
          aria-live="polite"
        >
          {missing ? 'Obligatoriu · minim 1' : count === 1 ? '1 supervizor' : `${count} supervizori`}
        </span>
      </div>

      <div className="space-y-4 p-6">
        <p className="max-w-prose text-sm leading-relaxed text-ink-soft">
          Consultanții seniori care răspund de dosar. Intră în echipa proiectului și îl pot administra:
          echipa, fazele și activitățile, chatul.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-ink-faint" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Se încarcă consultanții seniori…
          </div>
        ) : seniors.length === 0 ? (
          <div className="rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-4 py-5 text-sm">
            <p className="font-medium text-ink">Nu există încă niciun consultant senior.</p>
            <p className="mt-1 text-ink-soft">
              {isAdmin ? (
                <>
                  Promovează un consultant din{' '}
                  <Link href="/admin/users" className="font-medium text-[var(--sg-accent)] underline underline-offset-2 hover:text-[var(--sg-accent-ink)]">
                    pagina utilizatorilor
                  </Link>
                  , apoi revino aici.
                </>
              ) : (
                'Cere unui administrator să promoveze un consultant la senior, apoi revino aici.'
              )}
            </p>
          </div>
        ) : (
          <fieldset>
            <legend className="sr-only">Alege cel puțin un supervizor</legend>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {seniors.map(senior => {
                const checked = selected.includes(senior.id)
                const isMe = senior.id === currentUserId
                return (
                  <li key={senior.id}>
                    <label
                      className={`group flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-plate)] border px-3 py-2.5 transition-colors duration-[120ms] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--sg-accent)] ${
                        checked
                          ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]'
                          : 'border-rule bg-white hover:border-rule-strong'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggle(senior.id)}
                      />
                      <span
                        aria-hidden="true"
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-xs font-semibold tracking-wide transition-colors duration-[120ms] ${
                          checked ? 'bg-[var(--sg-accent)] text-white' : 'bg-paper-sunk text-ink-soft'
                        }`}
                      >
                        {initials(senior.full_name, senior.email)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">{senior.full_name || senior.email}</span>
                          {isMe && (
                            <span className="shrink-0 rounded-[var(--radius-plate)] border border-rule px-1.5 text-[11px] font-medium text-ink-soft">
                              tu
                            </span>
                          )}
                        </span>
                        {senior.full_name && <span className="block truncate text-xs text-ink-soft">{senior.email}</span>}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-plate)] border transition-colors duration-[120ms] ${
                          checked ? 'border-[var(--sg-accent)] bg-[var(--sg-accent)] text-white' : 'border-rule-strong bg-white'
                        }`}
                      >
                        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        )}

        {showError && missing && seniors.length > 0 && (
          <p role="alert" className="text-sm font-medium text-[var(--sg-danger)]">
            Alege cel puțin un supervizor ca să poți crea dosarul.
          </p>
        )}
      </div>
    </section>
  )
}
