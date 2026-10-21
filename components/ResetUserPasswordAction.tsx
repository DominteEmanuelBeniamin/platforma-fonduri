'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { Button } from '@/components/ui/Button'
import { FloatingSurface } from '@/components/ui/Surface'
import { Spinner } from '@/components/ui/Spinner'
import { IconButton } from '@/components/ui/IconButton'

type ResetTarget = {
  id: string
  email: string
  full_name?: string | null
  is_active?: boolean | null
}

type DeliveryStatus = 'sent' | 'failed' | 'unknown' | 'skipped'
type Phase = 'confirm' | 'pending' | 'unknown' | 'rejected' | 'completed'

type CompletedResult = {
  attemptId: string
  replayed: boolean
  deliveryStatus: DeliveryStatus
  superseded: boolean
  deliveryAuditPending: boolean
  message: string
}

type VerificationKind = 'unknown' | 'audit' | null

const DELIVERY_STATUSES = new Set<DeliveryStatus>(['sent', 'failed', 'unknown', 'skipped'])
// Ruta răspunde cu aceste coduri numai înainte de commit. Orice alt eșec (500, 502, 504…)
// poate veni după ce parola a fost deja schimbată, deci rezultatul rămâne necunoscut.
const DEFINITE_REFUSAL_STATUSES = new Set([400, 401, 403, 404, 409])

function bodyMessage(body: unknown) {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  return null
}

function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === 'string' && DELIVERY_STATUSES.has(value as DeliveryStatus)
}

export function ResetUserPasswordAction({
  target,
  onReset,
}: {
  target: ResetTarget
  onReset?: () => void | Promise<void>
}) {
  const { apiFetch, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('confirm')
  const [pending, setPending] = useState(false)
  const [verificationKind, setVerificationKind] = useState<VerificationKind>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<CompletedResult | null>(null)
  const [fallbackPassword, setFallbackPassword] = useState<string | null>(null)

  const inFlightRef = useRef(false)
  const requestSequenceRef = useRef(0)
  const activeControllerRef = useRef<AbortController | null>(null)
  const attemptIdRef = useRef<string | null>(null)
  const openRef = useRef(false)
  const openTargetRef = useRef<string | null>(null)
  const targetIdentity = JSON.stringify([target.id, target.email, target.full_name ?? null, target.is_active ?? null])
  const targetIdentityRef = useRef(targetIdentity)
  targetIdentityRef.current = targetIdentity
  const previousTargetIdentityRef = useRef(targetIdentity)

  const allowed = profile?.role === 'admin' && profile.id !== target.id && target.is_active === true && !!target.email
  const previousAllowedRef = useRef(allowed)
  const name = target.full_name?.trim() || target.email
  const dialogOpen = open && openTargetRef.current === targetIdentity

  const clearDialog = useCallback((close: boolean) => {
    requestSequenceRef.current += 1
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    attemptIdRef.current = null
    inFlightRef.current = false
    openRef.current = false
    openTargetRef.current = null
    setPhase('confirm')
    setPending(false)
    setVerificationKind(null)
    setAttemptId(null)
    setNotice(null)
    setResult(null)
    setFallbackPassword(null)
    if (close) setOpen(false)
  }, [])

  useEffect(() => {
    if (previousTargetIdentityRef.current === targetIdentity) return
    previousTargetIdentityRef.current = targetIdentity
    clearDialog(true)
  }, [clearDialog, targetIdentity])

  useEffect(() => {
    if (previousAllowedRef.current && !allowed) clearDialog(true)
    previousAllowedRef.current = allowed
  }, [allowed, clearDialog])

  useEffect(() => () => {
    requestSequenceRef.current += 1
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    attemptIdRef.current = null
    inFlightRef.current = false
    openRef.current = false
    openTargetRef.current = null
  }, [])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      clearDialog(true)
      return
    }
    clearDialog(false)
    openRef.current = true
    openTargetRef.current = targetIdentityRef.current
    setOpen(true)
  }, [clearDialog])

  const runAttempt = useCallback(async (id: string, verification: VerificationKind = null) => {
    if (inFlightRef.current || !openRef.current) return
    const identity = targetIdentityRef.current
    if (openTargetRef.current !== identity) return

    const seq = ++requestSequenceRef.current
    const controller = new AbortController()
    activeControllerRef.current = controller
    inFlightRef.current = true
    if (verification !== 'audit') setPhase('pending')
    setPending(true)
    setVerificationKind(verification)
    setNotice(null)
    // Verificarea auditului nu poate reda parola, deci nu o ștergem înainte ca adminul s-o copieze.
    if (verification !== 'audit') {
      setResult(null)
      setFallbackPassword(null)
    }

    const isCurrent = () => requestSequenceRef.current === seq
      && openRef.current
      && openTargetRef.current === identity
      && targetIdentityRef.current === identity

    try {
      const response = await apiFetch(`/api/users/${encodeURIComponent(target.id)}/reset-password`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: id, expectedEmail: target.email }),
      })
      const body = await response.json().catch(() => null) as Record<string, unknown> | null
      if (!isCurrent()) return

      if (!response.ok) {
        const message = bodyMessage(body)
        if (verification === 'audit') {
          setPhase('completed')
          setNotice(message || 'Nu am putut verifica înregistrarea livrării. Resetarea rămâne confirmată; reîncearcă verificarea aceleiași încercări.')
        } else if (verification === 'unknown' || !DEFINITE_REFUSAL_STATUSES.has(response.status)) {
          setPhase('unknown')
          setNotice(message || (verification === 'unknown'
            ? 'Verificarea nu a putut confirma rezultatul. Resetarea inițială poate să fi fost reușită; reîncearcă aceeași încercare.'
            : 'Nu am putut confirma rezultatul. Verifică aceeași încercare înainte de a porni o resetare nouă.'))
        } else {
          setPhase('rejected')
          setNotice(message || 'Serverul a refuzat resetarea. Parola contului nu a fost schimbată.')
        }
        return
      }

      const deliveryStatus = body?.deliveryStatus
      if (body?.status !== 'completed'
        || body.attemptId !== id
        || typeof body.replayed !== 'boolean'
        || !isDeliveryStatus(deliveryStatus)
        || typeof body.message !== 'string') {
        if (verification === 'audit') {
          setPhase('completed')
          setNotice('Nu am putut confirma înregistrarea livrării. Resetarea rămâne confirmată; reîncearcă verificarea aceleiași încercări.')
        } else {
          setPhase('unknown')
          setNotice(verification === 'unknown'
            ? 'Verificarea nu a putut confirma rezultatul. Resetarea inițială poate să fi fost reușită; reîncearcă aceeași încercare.'
            : 'Nu am putut confirma rezultatul. Verifică aceeași încercare înainte de a porni o resetare nouă.')
        }
        return
      }

      const superseded = body.superseded === true
      const deliveryAuditPending = body.deliveryAuditPending === true
      setPhase('completed')
      if (verification === 'audit') {
        // Păstrăm rezultatul inițial și parola afișată; actualizăm doar starea auditului.
        setResult(previous => previous && previous.attemptId === id
          ? { ...previous, deliveryAuditPending, superseded: previous.superseded || superseded }
          : previous)
        if (superseded) setFallbackPassword(null)
        if (onReset) void Promise.resolve().then(onReset).catch(() => undefined)
        return
      }
      setResult({
        attemptId: id,
        replayed: body.replayed,
        deliveryStatus,
        superseded,
        deliveryAuditPending,
        message: body.message,
      })

      if (!body.replayed && !superseded && deliveryStatus === 'failed'
        && typeof body.temporaryPassword === 'string' && body.temporaryPassword.length > 0) {
        setFallbackPassword(body.temporaryPassword)
      } else {
        setFallbackPassword(null)
      }

      if (onReset) void Promise.resolve().then(onReset).catch(() => undefined)
    } catch {
      if (!isCurrent()) return
      if (verification === 'audit') {
        setPhase('completed')
        setNotice('Nu am putut verifica înregistrarea livrării. Resetarea rămâne confirmată; reîncearcă verificarea aceleiași încercări.')
      } else {
        setPhase('unknown')
        setNotice(verification === 'unknown'
          ? 'Verificarea nu a putut confirma rezultatul. Resetarea inițială poate să fi fost reușită; reîncearcă aceeași încercare.'
          : 'Nu am putut confirma rezultatul. Verifică aceeași încercare înainte de a porni o resetare nouă.')
      }
    } finally {
      if (isCurrent()) {
        inFlightRef.current = false
        if (activeControllerRef.current === controller) activeControllerRef.current = null
        setPending(false)
        setVerificationKind(null)
      }
    }
  }, [apiFetch, onReset, target.email, target.id])

  const confirmReset = () => {
    if (inFlightRef.current || phase !== 'confirm') return
    const id = crypto.randomUUID()
    attemptIdRef.current = id
    setAttemptId(id)
    void runAttempt(id)
  }

  const verifyAttempt = () => {
    const id = attemptIdRef.current
    if (!id || inFlightRef.current || phase !== 'unknown') return
    void runAttempt(id, 'unknown')
  }

  const verifyDeliveryAudit = () => {
    if (!result?.deliveryAuditPending || inFlightRef.current) return
    void runAttempt(result.attemptId, 'audit')
  }

  const beginNewReset = () => {
    if (inFlightRef.current) return
    attemptIdRef.current = null
    setAttemptId(null)
    setNotice(null)
    setResult(null)
    setFallbackPassword(null)
    setPhase('confirm')
  }

  if (!allowed) return null

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <Button variant="secondary">Resetează parola</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999999] backdrop-blur-sm" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[1000000] max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 focus:outline-none">
          <FloatingSurface className="max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-[var(--radius-plate-lg)]">
            <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-bold text-ink">Resetarea parolei</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-ink-soft">
                  {phase === 'confirm' && `Resetezi parola contului ${name}, cu adresa ${target.email}? Parola actuală nu va mai funcționa, iar sesiunile existente vor fi închise. Vom încerca trimiterea unei parole temporare pe email.`}
                  {phase === 'pending' && (verificationKind === 'unknown'
                    ? 'Verificăm rezultatul aceleiași încercări.'
                    : 'Se procesează resetarea. Poți închide dialogul; rezultatul nu va mai fi afișat aici.')}
                  {phase === 'unknown' && 'Rezultatul resetării nu este confirmat. Verificarea va folosi aceeași încercare.'}
                  {phase === 'rejected' && 'Serverul a refuzat resetarea; parola contului nu a fost schimbată.'}
                  {phase === 'completed' && (result?.superseded
                    ? 'Resetarea a fost confirmată, dar contul a fost schimbat ulterior.'
                    : 'Resetarea parolei a fost confirmată.')}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton label="Închide"><X className="h-4 w-4" aria-hidden="true" /></IconButton>
              </Dialog.Close>
            </div>

            <div className="space-y-4 px-5 py-5">
              {phase === 'pending' && (
                <p className="flex items-center gap-2 text-sm text-ink-soft" role="status" aria-live="polite">
                  <Spinner size="sm" /> {verificationKind === 'unknown' ? 'Se verifică rezultatul…' : 'Se resetează parola…'}
                </p>
              )}

              {phase === 'unknown' && (
                <FeedbackMessage variant="warning">
                  {notice || 'Nu am putut confirma rezultatul. Verifică aceeași încercare înainte de a porni o resetare nouă.'}
                </FeedbackMessage>
              )}

              {phase === 'rejected' && (
                <FeedbackMessage variant="error">
                  {notice || 'Serverul a refuzat resetarea. Parola contului nu a fost schimbată.'}
                </FeedbackMessage>
              )}

              {phase === 'completed' && result && (
                <div className="space-y-3">
                  {pending && verificationKind === 'audit' && (
                    <p className="flex items-center gap-2 text-sm text-ink-soft" role="status" aria-live="polite">
                      <Spinner size="sm" /> Se verifică înregistrarea livrării…
                    </p>
                  )}

                  <FeedbackMessage variant="success">
                    {result.superseded
                      ? 'La acel moment, parola a fost resetată și sesiunile existente au fost închise. Ulterior, contul a fost modificat (parola, adresa de email sau starea contului).'
                      : 'Parola a fost resetată; parola anterioară nu mai funcționează, iar sesiunile existente au fost închise.'}
                  </FeedbackMessage>

                  {result.superseded ? (
                    <FeedbackMessage variant="warning">
                      Această încercare nu mai este cea curentă, așa că parola temporară nu este afișată. Dacă utilizatorul nu se poate autentifica, poate folosi „Am uitat parola” sau poți porni o resetare nouă.
                    </FeedbackMessage>
                  ) : result.deliveryStatus === 'sent' ? (
                    <FeedbackMessage variant="success">
                      Emailul cu parola temporară a fost acceptat pentru trimitere. {result.message}
                    </FeedbackMessage>
                  ) : result.deliveryStatus === 'failed' ? (
                    <FeedbackMessage variant="warning">
                      Emailul nu a putut fi trimis. {result.message}
                    </FeedbackMessage>
                  ) : result.deliveryStatus === 'unknown' ? (
                    <FeedbackMessage variant="warning">
                      Nu se poate confirma predarea emailului. {result.message}
                    </FeedbackMessage>
                  ) : (
                    <FeedbackMessage variant="info">
                      Emailul nu a fost trimis. {result.message}
                    </FeedbackMessage>
                  )}

                  {notice && <FeedbackMessage variant="warning">{notice}</FeedbackMessage>}

                  {result.deliveryAuditPending && (
                    <FeedbackMessage variant="warning">
                      Înregistrarea rezultatului emailului nu este confirmată. Verifică aceeași încercare din nou; dacă rămâne neconfirmată, reîncearcă peste un minut. Verificarea nu trimite un alt email.
                    </FeedbackMessage>
                  )}

                  {fallbackPassword && (
                    <div className="space-y-2 rounded-[var(--radius-plate)] border border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] p-4">
                      <p className="text-sm font-semibold text-ink">Parolă temporară, disponibilă numai acum</p>
                      <p className="text-sm text-ink-soft">Copiaz-o și transmite-o utilizatorului printr-un canal sigur. Este temporară; dacă dorește, poate alege o altă parolă prin „Am uitat parola”.</p>
                      <label className="block text-sm font-semibold text-ink" htmlFor="reset-temporary-password">Parolă temporară</label>
                      <input
                        id="reset-temporary-password"
                        type="text"
                        readOnly
                        autoComplete="off"
                        spellCheck={false}
                        value={fallbackPassword}
                        onFocus={event => event.currentTarget.select()}
                        className="h-11 w-full select-all rounded-[var(--radius-plate)] border border-rule-strong bg-plate px-3 font-mono text-sm text-ink"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-rule bg-paper-sunk px-5 py-4 sm:flex-row sm:flex-wrap sm:justify-end">
              {phase === 'confirm' && (
                <>
                  <Dialog.Close asChild><Button variant="secondary">Anulează</Button></Dialog.Close>
                  <Button variant="danger" disabled={pending} onClick={confirmReset}>Confirmă resetarea</Button>
                </>
              )}
              {phase === 'pending' && <Button variant="secondary" onClick={() => clearDialog(true)}>Închide</Button>}
              {phase === 'unknown' && (
                <>
                  <Button variant="secondary" onClick={beginNewReset}>Începe o resetare nouă</Button>
                  <Dialog.Close asChild><Button variant="secondary">Închide</Button></Dialog.Close>
                  <Button variant="primary" disabled={pending || !attemptId} onClick={verifyAttempt}>
                    {pending ? <Spinner size="sm" on="accent" /> : null}Verifică rezultatul
                  </Button>
                </>
              )}
              {phase === 'rejected' && (
                <>
                  <Button variant="secondary" onClick={beginNewReset}>Începe o resetare nouă</Button>
                  <Dialog.Close asChild><Button variant="secondary">Închide</Button></Dialog.Close>
                </>
              )}
              {phase === 'completed' && (
                <>
                  {result?.deliveryAuditPending && (
                    <Button variant="secondary" disabled={pending} onClick={verifyDeliveryAudit}>
                      {pending && verificationKind === 'audit' ? <Spinner size="sm" /> : null}Verifică înregistrarea
                    </Button>
                  )}
                  <Dialog.Close asChild><Button variant="primary">Gata</Button></Dialog.Close>
                </>
              )}
            </div>
          </FloatingSurface>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
