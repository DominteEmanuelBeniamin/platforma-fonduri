'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

const TEMPORARY_MESSAGE = 'Serviciul este temporar indisponibil. Încearcă din nou.'
const SENT_MESSAGE = 'Dacă există un cont cu această adresă, vei primi un email cu instrucțiuni.'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/recovery/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        cache: 'no-store',
      })

      if (response.status === 400) {
        setError('Introdu o adresă de email validă.')
        return
      }
      if (!response.ok) {
        setError(TEMPORARY_MESSAGE)
        return
      }

      setEmail('')
      setSent(true)
    } catch {
      setError(TEMPORARY_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4">
      <section className="relative w-full max-w-md rounded-[var(--radius-plate)] border border-rule bg-plate p-8 sm:p-10" aria-labelledby="forgot-title">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[var(--sg-rail)] rounded-t-[var(--radius-plate)]" style={{ background: 'var(--sg-accent)' }} />
        <div className="mb-8">
          <span aria-hidden="true" className="mb-4 flex h-10 w-10 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-accent)] text-base font-bold text-white">B</span>
          <h1 id="forgot-title" className="text-2xl font-bold tracking-tight text-ink">Ai uitat parola?</h1>
          <p className="mt-2 text-sm text-ink-soft">Introdu adresa asociată contului și îți trimitem instrucțiuni de resetare.</p>
        </div>

        {sent ? (
          <p role="status" aria-live="polite" className="rounded-[var(--radius-plate)] border border-rule bg-paper-sunk p-4 text-sm text-ink">
            {SENT_MESSAGE}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
            <label htmlFor="recovery-email" className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Email</span>
              <input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setError(null)
                }}
                aria-invalid={!!error}
                aria-describedby={error ? 'recovery-email-error' : undefined}
                className="h-12 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)]"
                placeholder="nume@companie.ro"
              />
            </label>

            {error && <p id="recovery-email-error" role="alert" aria-live="assertive" className="text-sm text-[var(--sg-danger)]">{error}</p>}

            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? 'Se trimite…' : 'Trimite instrucțiunile'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="font-semibold text-[var(--sg-accent-ink)] underline underline-offset-4">Înapoi la autentificare</Link>
        </p>
      </section>
    </div>
  )
}