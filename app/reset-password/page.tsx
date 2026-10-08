'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import { Eye, EyeOff } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'

const INVALID_MESSAGE = 'Linkul de resetare nu mai este valid. Solicită un link nou sau contactează administratorul.'
const FALLBACK_MESSAGE = 'Parola a fost schimbată. Autentifică-te cu noua parolă.'
const TEMPORARY_MESSAGE = 'Serviciul este temporar indisponibil. Încearcă din nou.'
const ATTEMPT_STORAGE_KEY = 'bonie:recovery-attempt'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i

type RecoveryAttempt = { flowId: string; attemptId: string }
type RecoveryResponse = {
  status?: string
  flowId?: string
  message?: string
  userId?: string
  session?: { access_token?: string; refresh_token?: string }
}
type ViewState = 'checking' | 'ready' | 'invalid' | 'completed' | 'temporary'
type StatusResult = 'valid' | 'invalid' | 'completed' | 'unavailable'

function readAttempt(): RecoveryAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(ATTEMPT_STORAGE_KEY)
    if (!raw) return null
    const attempt = JSON.parse(raw) as Partial<RecoveryAttempt>
    if (typeof attempt.flowId === 'string' && UUID_PATTERN.test(attempt.flowId) && typeof attempt.attemptId === 'string' && UUID_PATTERN.test(attempt.attemptId)) {
      return { flowId: attempt.flowId, attemptId: attempt.attemptId }
    }
  } catch {
    return null
  }
  return null
}

function saveAttempt(attempt: RecoveryAttempt): boolean {
  try {
    window.sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(attempt))
    return true
  } catch {
    return false
  }
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const { installSession } = useAuth()
  const [view, setView] = useState<ViewState>('checking')
  const [attempt, setAttempt] = useState<RecoveryAttempt | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingToken = useRef<string | null>(null)
  const started = useRef(false)

  const inspectAttempt = useCallback(async (current: RecoveryAttempt): Promise<StatusResult> => {
    try {
      const query = new URLSearchParams({ flowId: current.flowId, attemptId: current.attemptId })
      const response = await fetch(`/api/auth/recovery/status?${query}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const body = await response.json().catch(() => null) as RecoveryResponse | null
      if (body?.status === 'completed') return 'completed'
      if (response.ok && body?.status === 'valid' && body.flowId === current.flowId) return 'valid'
      if (response.status === 400 || body?.status === 'invalid') return 'invalid'
      return 'unavailable'
    } catch {
      return 'unavailable'
    }
  }, [])

  const refreshAttempt = useCallback(async (current: RecoveryAttempt) => {
    setView('checking')
    setError(null)
    const result = await inspectAttempt(current)
    if (result === 'valid') {
      setAttempt(current)
      setView('ready')
    } else if (result === 'completed') {
      setPassword('')
      setConfirmation('')
      setView('completed')
    } else if (result === 'invalid') {
      setPassword('')
      setConfirmation('')
      setView('invalid')
    } else {
      setView('temporary')
      setError(TEMPORARY_MESSAGE)
    }
  }, [inspectAttempt])

  const exchangeToken = useCallback(async (token: string) => {
    setView('checking')
    setError(null)
    try {
      const response = await fetch('/api/auth/recovery/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const body = await response.json().catch(() => null) as RecoveryResponse | null
      if (response.ok && body?.status === 'valid' && typeof body.flowId === 'string' && UUID_PATTERN.test(body.flowId)) {
        const saved = readAttempt()
        const nextAttempt = saved?.flowId === body.flowId
          ? saved
          : { flowId: body.flowId, attemptId: crypto.randomUUID() }
        if (!saveAttempt(nextAttempt)) {
          pendingToken.current = token
          setView('temporary')
          setError('Activează stocarea sesiunii browserului și încearcă din nou.')
          return
        }
        setAttempt(nextAttempt)
        pendingToken.current = null
        setView('ready')
        return
      }
      if (response.status === 503 || body?.status === 'unavailable') {
        setView('temporary')
        setError(TEMPORARY_MESSAGE)
        return
      }
      pendingToken.current = null
      setView('invalid')
    } catch {
      setView('temporary')
      setError(TEMPORARY_MESSAGE)
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true

    const fragment = window.location.hash
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
    const token = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment).get('token')
    if (token !== null) {
      if (!TOKEN_PATTERN.test(token)) {
        setView('invalid')
        return
      }
      pendingToken.current = token
      void exchangeToken(token)
      return
    }

    const saved = readAttempt()
    if (!saved) {
      setView('invalid')
      return
    }
    setAttempt(saved)
    void refreshAttempt(saved)
  }, [exchangeToken, refreshAttempt])

  const retryCheck = () => {
    if (pendingToken.current) {
      void exchangeToken(pendingToken.current)
    } else if (attempt) {
      void refreshAttempt(attempt)
    } else {
      setView('invalid')
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!attempt) {
      setView('invalid')
      return
    }
    if (password !== confirmation) {
      setError('Parolele nu coincid.')
      return
    }

    setBusy(true)
    try {
      const response = await fetch('/api/auth/recovery/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: attempt.flowId, attemptId: attempt.attemptId, password, confirmation }),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const body = await response.json().catch(() => null) as RecoveryResponse | null

      if (body?.status === 'completed') {
        setPassword('')
        setConfirmation('')
        setError(null)
        if (!response.ok || !body.session || typeof body.session.access_token !== 'string' || typeof body.session.refresh_token !== 'string' || typeof body.userId !== 'string') {
          setView('completed')
          return
        }

        try {
          const installed = await installSession({
            access_token: body.session.access_token,
            refresh_token: body.session.refresh_token,
          }, body.userId)
          if (!installed) {
            setView('completed')
            return
          }
        } catch {
          setView('completed')
          return
        }

        router.replace('/')
        return
      }
      if (response.status === 503 || body?.status === 'unavailable') {
        setError(TEMPORARY_MESSAGE)
        return
      }
      if (body?.status === 'password_invalid') {
        setError(typeof body.message === 'string' ? body.message : 'Parola trebuie să aibă cel puțin 6 caractere și cel mult 72 de bytes UTF-8.')
        return
      }
      if (body?.status === 'same_password') {
        setPassword('')
        setConfirmation('')
        setError('Alege o parolă diferită de cea curentă.')
        return
      }
      if (response.status === 400 || body?.status === 'invalid') {
        setPassword('')
        setConfirmation('')
        setView('invalid')
        return
      }
      setError(TEMPORARY_MESSAGE)
    } catch {
      const result = await inspectAttempt(attempt)
      if (result === 'completed') {
        setPassword('')
        setConfirmation('')
        setError(null)
        setView('completed')
      } else if (result === 'invalid') {
        setPassword('')
        setConfirmation('')
        setView('invalid')
      } else {
        setError(TEMPORARY_MESSAGE)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <section className="relative w-full max-w-md rounded-[var(--radius-plate)] border border-rule bg-plate p-8 sm:p-10" aria-labelledby="reset-title">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[var(--sg-rail)] rounded-t-[var(--radius-plate)]" style={{ background: 'var(--sg-accent)' }} />
        <div className="mb-8">
          <span aria-hidden="true" className="mb-4 flex h-10 w-10 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-accent)] text-base font-bold text-white">B</span>
          <h1 id="reset-title" className="text-2xl font-bold tracking-tight text-ink">Alege o parolă nouă</h1>
          <p className="mt-2 text-sm text-ink-soft">Linkul de resetare este valabil o oră și poate fi folosit o singură dată.</p>
        </div>

        {view === 'checking' && <p role="status" aria-live="polite" className="text-sm text-ink-soft">Se verifică linkul de resetare…</p>}

        {view === 'temporary' && (
          <div className="space-y-4">
            <p role="alert" aria-live="assertive" className="text-sm text-[var(--sg-danger)]">{error ?? TEMPORARY_MESSAGE}</p>
            <Button type="button" variant="secondary" onClick={retryCheck} className="w-full">Încearcă din nou</Button>
          </div>
        )}

        {view === 'invalid' && (
          <div className="space-y-4">
            <p role="alert" aria-live="assertive" className="text-sm text-[var(--sg-danger)]">{INVALID_MESSAGE}</p>
            <ButtonLink href="/forgot-password" variant="primary" className="w-full">Solicită un link nou</ButtonLink>
          </div>
        )}

        {view === 'completed' && <p role="status" aria-live="polite" className="rounded-[var(--radius-plate)] border border-rule bg-paper-sunk p-4 text-sm text-ink">{FALLBACK_MESSAGE}</p>}

        {view === 'ready' && (
          <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
            <label htmlFor="new-password" className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Parolă nouă</span>
              <span className="relative block">
                <input
                  id="new-password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError(null)
                  }}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'reset-password-error' : undefined}
                  className="h-12 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 pr-14 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)]"
                />
                <IconButton
                  type="button"
                  label={showPassword ? 'Ascunde parola nouă' : 'Arată parola nouă'}
                  onClick={() => setShowPassword((shown) => !shown)}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </IconButton>
              </span>
            </label>

            <label htmlFor="confirm-password" className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Confirmă parola nouă</span>
              <span className="relative block">
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type={showConfirmation ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirmation}
                  onChange={(event) => {
                    setConfirmation(event.target.value)
                    setError(null)
                  }}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'reset-password-error' : undefined}
                  className="h-12 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 pr-14 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)]"
                />
                <IconButton
                  type="button"
                  label={showConfirmation ? 'Ascunde confirmarea parolei' : 'Arată confirmarea parolei'}
                  onClick={() => setShowConfirmation((shown) => !shown)}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                >
                  {showConfirmation ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </IconButton>
              </span>
            </label>

            {error && <p id="reset-password-error" role="alert" aria-live="assertive" className="text-sm text-[var(--sg-danger)]">{error}</p>}

            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? 'Se salvează…' : 'Schimbă parola'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm">
          <Link href={view === 'completed' ? '/login?recovery=complete' : '/login'} className="font-semibold text-[var(--sg-accent-ink)] underline underline-offset-4">Înapoi la autentificare</Link>
        </p>
      </section>
    </div>
  )
}