'use client'

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Eye, EyeOff, KeyRound, LogOut } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Signal } from '@/components/ui/Signal'
import { Spinner } from '@/components/ui/Spinner'
import { serverMessage } from '@/lib/api-error'
import { newPasswordProblem } from '@/lib/password-rules'

const FIELD = 'h-12 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 pr-14 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] aria-[invalid=true]:border-[var(--sg-danger)]'

function roleLabel(role: string | undefined, level: string | null | undefined) {
  if (role === 'admin') return 'Administrator'
  if (role === 'consultant') return level === 'senior' ? 'Consultant senior' : 'Consultant'
  if (role === 'client') return 'Client'
  return '—'
}

/** O secțiune a contului: titlu, o frază de explicație, conținutul. */
function AccountSection({ title, description, aside, children }: { title: string; description: ReactNode; aside?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="border-t border-rule px-5 py-7 first:border-t-0 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id={id} className="text-lg font-bold text-ink">{title}</h2>
        {aside}
      </div>
      <p className="mt-1 max-w-[62ch] text-sm leading-6 text-ink-soft">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function PasswordField({
  id, label, value, onChange, autoComplete, describedBy, invalid, hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  describedBy?: string
  invalid?: boolean
  hint?: ReactNode
}) {
  const [shown, setShown] = useState(false)
  const hintId = hint ? `${id}-indiciu` : undefined
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">{label}</label>
      <span className="relative block">
        <input
          id={id}
          name={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={event => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(' ') || undefined}
          className={FIELD}
        />
        <IconButton
          type="button"
          label={shown ? `Ascunde: ${label.toLowerCase()}` : `Arată: ${label.toLowerCase()}`}
          data-tooltip={shown ? 'Ascunde ce ai scris' : 'Arată ce ai scris'}
          onClick={() => setShown(current => !current)}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        >
          {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </IconButton>
      </span>
      {hint && <p id={hintId} className="mt-1.5 text-xs leading-5 text-ink-soft">{hint}</p>}
    </div>
  )
}

export default function AccountPage() {
  const router = useRouter()
  const { loading: authLoading, token, profile, apiFetch, signOut, markPasswordChanged } = useAuth()
  const { showToast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<{ field: 'current' | 'next' | 'confirmation' | null; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState<{ otherSessions: number } | null>(null)

  useEffect(() => {
    if (!authLoading && !token) router.push('/login')
  }, [authLoading, router, token])

  if (authLoading || !token || !profile) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const temporary = profile.must_change_password === true && !changed
  const errorId = 'cont-parola-eroare'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!current) return setError({ field: 'current', message: 'Scrie parola cu care ai intrat acum în cont.' })
    const problem = newPasswordProblem(next)
    if (problem) return setError({ field: 'next', message: problem })
    if (next !== confirmation) return setError({ field: 'confirmation', message: 'Parolele noi nu coincid.' })
    if (next === current) return setError({ field: 'next', message: 'Parola nouă e la fel cu cea actuală. Alege alta.' })

    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next, confirmation }),
      })
      if (!res.ok) {
        const body: unknown = await res.clone().json().catch(() => null)
        const code = (body as { code?: unknown } | null)?.code
        const message = await serverMessage(res, 'Nu am putut schimba parola. Încearcă din nou.')
        setError({
          field: code === 'wrong_password' || code === 'rate_limited' ? 'current' : code === 'mismatch' ? 'confirmation' : code === 'same_password' || code === 'password_invalid' ? 'next' : null,
          message,
        })
        if (code === 'wrong_password') setCurrent('')
        return
      }
      const body = await res.json().catch(() => ({})) as { otherSessionsRevoked?: number }
      setCurrent('')
      setNext('')
      setConfirmation('')
      setChanged({ otherSessions: typeof body.otherSessionsRevoked === 'number' ? body.otherSessionsRevoked : 0 })
      markPasswordChanged()
      showToast('Parola a fost schimbată.', 'success')
    } catch {
      setError({ field: null, message: 'Nu am putut schimba parola. Verifică legătura la internet și încearcă din nou.' })
    } finally {
      setBusy(false)
    }
  }

  const details: Array<[string, ReactNode]> = [
    ['Nume', profile.full_name?.trim() || '—'],
    ['Email', profile.email || '—'],
    ['Rol', roleLabel(profile.role, profile.consultant_level)],
    ...(profile.role === 'client' && profile.nume_firma ? [['Firma', profile.nume_firma] as [string, ReactNode]] : []),
    ...(profile.telefon ? [['Telefon', profile.telefon] as [string, ReactNode]] : []),
  ]

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Contul meu"
        subtitle={profile.email ?? undefined}
        actions={
          <Button variant="secondary" data-tooltip="Ieși din cont pe acest dispozitiv" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Ieși din cont
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-3xl rounded-[var(--radius-plate)] border border-rule bg-plate">
        <AccountSection
          title="Parola"
          description="Cu ea intri în Bonie. Ca s-o schimbi, scrii întâi parola actuală, apoi pe cea nouă de două ori."
          aside={temporary ? <Signal tone="warn">Parolă temporară</Signal> : undefined}
        >
          {temporary && (
            <div className="mb-6 flex gap-3 rounded-[var(--radius-plate)] border border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] p-4" role="note">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-[var(--sg-warn)]" aria-hidden="true" />
              <p className="text-sm leading-6 text-ink">
                Folosești parola temporară primită pe email. Alege-ți acum o parolă a ta: doar tu o vei ști.
                La „Parola actuală” scrie parola temporară.
              </p>
            </div>
          )}

          {changed && (
            <div className="mb-6 flex gap-3 rounded-[var(--radius-plate)] border border-[var(--sg-ok)] bg-[var(--sg-ok-soft)] p-4" role="status" aria-live="polite">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--sg-ok)]" aria-hidden="true" />
              <div className="text-sm leading-6 text-ink">
                <p className="font-semibold">Parola a fost schimbată.</p>
                <p>
                  Pe acest dispozitiv rămâi conectat.
                  {changed.otherSessions > 0
                    ? ` Te-am deconectat de pe ${changed.otherSessions === 1 ? 'celălalt dispozitiv' : `celelalte ${changed.otherSessions} dispozitive`}; acolo intri cu parola nouă.`
                    : ' De acum intri cu parola nouă.'}
                  {' '}Primești și un email de confirmare.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={submit} noValidate className="space-y-5" aria-busy={busy}>
            <PasswordField
              id="parola-actuala"
              label="Parola actuală"
              value={current}
              onChange={value => { setCurrent(value); setError(null) }}
              autoComplete="current-password"
              invalid={error?.field === 'current'}
              describedBy={error?.field === 'current' ? errorId : undefined}
            />
            <PasswordField
              id="parola-noua"
              label="Parola nouă"
              value={next}
              onChange={value => { setNext(value); setError(null) }}
              autoComplete="new-password"
              invalid={error?.field === 'next'}
              describedBy={error?.field === 'next' ? errorId : undefined}
              hint="Cel puțin 6 caractere. O frază de câteva cuvinte se ține minte ușor și se ghicește greu."
            />
            <PasswordField
              id="parola-confirmare"
              label="Scrie din nou parola nouă"
              value={confirmation}
              onChange={value => { setConfirmation(value); setError(null) }}
              autoComplete="new-password"
              invalid={error?.field === 'confirmation'}
              describedBy={error?.field === 'confirmation' ? errorId : undefined}
            />

            {error && <p id={errorId} role="alert" className="text-sm text-[var(--sg-danger)]">{error.message}</p>}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-ink-soft">
                Nu mai știi parola actuală? Ieși din cont și folosește „Ai uitat parola?” de pe pagina de autentificare.
              </p>
              <Button type="submit" variant="primary" disabled={busy} data-tooltip="Salvează parola nouă" className="shrink-0">
                {busy ? 'Se salvează…' : 'Schimbă parola'}
              </Button>
            </div>
          </form>
        </AccountSection>

        <AccountSection
          title="Datele contului"
          description={profile.role === 'admin'
            ? 'Le modifici din pagina Utilizatori.'
            : 'Le schimbă administratorul. Dacă ceva nu e corect, scrie-i lui.'}
        >
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-semibold text-ink-soft">{label}</dt>
                <dd className="min-w-0 break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </AccountSection>
      </div>
    </div>
  )
}
