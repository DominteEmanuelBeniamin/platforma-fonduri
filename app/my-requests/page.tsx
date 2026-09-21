/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import {
  FileText,
  Clock,
  AlertTriangle,
  Mail,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Signal } from '@/components/ui/Signal'
import { TONE, formatDate, type SignalTone } from '@/lib/signage'
import {
  getManualReminderType,
  REMINDER_LABELS,
  REMINDER_BADGE,
} from '@/lib/document-reminder'
import { useReminderStates } from '@/hooks/useReminderStates'
import { getReminderDisplayStatus } from '@/components/ReminderStatus'
import { Spinner } from '@/components/ui/Spinner'

export default function MyRequestsPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()
  const { showToast, confirm } = useToast()
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const sendingLock = useRef(false)
  const { states: reminderStates, refresh: refreshReminderStates, loading: reminderStatesLoading } = useReminderStates(
    apiFetch,
    'request',
    requests.map(request => request.id),
    profile?.role === 'admin' || profile?.role === 'consultant',
  )

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.push('/login'); return }
    if (profile?.role === 'client') { router.push('/'); return }

    apiFetch('/api/my-document-requests')
      .then(r => r.json())
      .then(d => setRequests(d.requests ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, profile?.role])

  const sendReminder = async (reqId: string, reqName: string) => {
    if (sendingLock.current) return
    if (!await confirm({
      title: 'Trimiți reminder clientului?',
      description: `Se trimite acum un email real către client pentru „${reqName}”.`,
      confirmText: 'Trimite email',
    })) return
    sendingLock.current = true
    setSendingId(reqId)
    try {
      const res = await apiFetch(`/api/document-requests/${reqId}/reminder`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (res.ok) {
        await refreshReminderStates()
        showToast(json?.warning || 'Reminder-ul a fost trimis clientului.', json?.warning ? 'warning' : 'success')
      } else {
        showToast(json?.error || 'Nu am putut trimite reminder-ul. Reîncearcă.', 'error')
      }
    } catch {
      showToast('Nu am putut trimite reminder-ul. Reîncearcă.', 'error')
    } finally {
      sendingLock.current = false
      setSendingId(null)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center" role="status" aria-live="polite">
        <Spinner />
        <span className="sr-only">Se încarcă cererile…</span>
      </div>
    )
  }

  const overdue = requests.filter((r: any) => {
    const d = r.deadline_at ? new Date(r.deadline_at) : null
    d?.setHours(0, 0, 0, 0)
    return d && d < today
  })
  const upcoming = requests.filter((r: any) => {
    const d = r.deadline_at ? new Date(r.deadline_at) : null
    d?.setHours(0, 0, 0, 0)
    return d && d >= today
  })
  const noDeadline = requests.filter((r: any) => !r.deadline_at)

  const groups: { key: string; label: string; items: any[]; tone: SignalTone }[] = [
    { key: 'overdue', label: 'Cu termen depășit', items: overdue, tone: 'danger' as SignalTone },
    { key: 'upcoming', label: 'Cu termen în față', items: upcoming, tone: 'warn' as SignalTone },
    { key: 'none', label: 'Fără termen', items: noDeadline, tone: 'neutral' as SignalTone },
  ].filter(g => g.items.length > 0)

  return (
    <div className="flex flex-col">
      <LocationStrip
        segments={[{ label: 'Bonie', href: '/' }, { label: 'Cereri de documente' }]}
        action={overdue.length > 0
          ? <Signal tone="danger">{overdue.length} cu termen depășit</Signal>
          : undefined}
      />

      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Cereri de documente</h1>
      <p className="mt-2 mb-8 text-sm text-ink-soft">
        {requests.length === 0
          ? 'Nicio cerere în așteptare.'
          : `${requests.length} ${requests.length === 1 ? 'cerere așteaptă' : 'cereri așteaptă'} răspuns de la clienți.`}
      </p>

      {/* Empty */}
      {requests.length === 0 ? (
        <EmptyState
          title="Totul e la zi"
          action={<ButtonLink href="/" variant="secondary">Înapoi la proiecte</ButtonLink>}
        >
          Nicio cerere nu așteaptă răspuns. Când trimiți una nouă, apare aici, ordonată după termen.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(group => (
            <div key={group.key}>
              {/* Group label */}
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                <Signal tone={group.tone}>{group.label}</Signal>
                <span className="font-medium text-ink-soft">{group.items.length}</span>
              </h2>

              {/* Cards */}
              <div className="divide-y divide-rule overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
                {group.items.map((req: any) => {
                  const reminderType = getManualReminderType(req.deadline_at) ?? '1_week'
                  const state = reminderStates[req.id]
                  const threshold = state?.current_threshold ?? reminderType
                  const thresholdState = state?.thresholds[threshold]
                  const badge = REMINDER_BADGE[threshold]
                  const canRemind = req.status === 'pending' || req.status === 'rejected'
                  const isSending = sendingId === req.id
                  const displayStatus = getReminderDisplayStatus(state, threshold)

                  // Reminder-ul trimite clientul în platformă, deci are sens doar dacă
                  // cererea e publicată (altfel n-o găsește acolo) și are un termen de
                  // comunicat. Motivul e afișat pe buton, ca să nu pară stricat.
                  const reminderBlockedReason = !req.deadline_at
                    ? 'Fără termen limită'
                    : req.client_visible === false
                    ? 'Cererea nu e publicată — clientul nu o vede încă'
                    : !req.client_email
                    ? 'Fără email client'
                    : null

                  const deadline = req.deadline_at ? new Date(req.deadline_at) : null
                  deadline?.setHours(0, 0, 0, 0)
                  const isOverdue = deadline && deadline < today
                  const isSoon =
                    deadline &&
                    !isOverdue &&
                    deadline.getTime() - today.getTime() <= 3 * 24 * 60 * 60 * 1000

                  const tone: SignalTone = isOverdue
                    ? 'danger'
                    : isSoon || reminderType === 'same_day' || reminderType === '1_day' || reminderType === '3_days'
                    ? 'warn'
                    : 'neutral'

                  return (
                    <div key={req.id} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-paper-sunk sm:flex-nowrap sm:gap-4">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-plate)]"
                        style={{ background: TONE[tone].bg, color: TONE[tone].fg }}
                      >
                        {isOverdue ? <AlertTriangle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{req.name}</p>
                        {/* O frază, nu un rând de flex: linkul rămâne inline în
                            text, cum îl vrea și excepția din 2.5.8, iar
                            interlinia îi dă înălțimea. */}
                        <p className="mt-0.5 truncate text-xs leading-6 text-ink-soft">
                          <Link
                            href={`/projects/${req.project_id}`}
                            className="font-medium text-[var(--sg-accent)] underline-offset-4 hover:underline"
                          >
                            {req.project_title}
                          </Link>
                          {req.client_name && <> · {req.client_name}</>}
                        </p>
                      </div>

                      {/* Deadline */}
                      {deadline ? (
                        <span
                          className="hidden shrink-0 items-center gap-1 rounded-[var(--radius-plate)] px-2.5 py-1 text-xs font-semibold sm:inline-flex"
                          style={{ background: TONE[tone].bg, color: TONE[tone].fg }}
                        >
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {formatDate(deadline)}
                        </span>
                      ) : (
                        <span className="hidden shrink-0 text-xs text-ink-soft sm:block">Fără termen</span>
                      )}

                      {/* Status */}
                      <Signal
                        tone={req.status === 'rejected' ? 'danger' : req.status === 'review' ? 'warn' : 'neutral'}
                        className="hidden shrink-0 md:inline-flex"
                      >
                        {req.status === 'review' ? 'De verificat' : req.status === 'rejected' ? 'Respins' : 'La client'}
                      </Signal>

                      {canRemind && (
                        reminderBlockedReason ? (
                          <span
                            title={reminderBlockedReason}
                            className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-3 text-xs font-medium text-ink-faint"
                          >
                            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                            Reminder
                          </span>
                        ) : reminderStatesLoading ? (
                          <span className="shrink-0 p-2 text-ink-faint" role="status" aria-label="Se verifică reminderul">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          </span>
                        ) : (() => {
                          const sentAt = thresholdState?.sent_at ?? null
                          const isSent = displayStatus === 'sent'
                          const isSkipped = displayStatus === 'skipped'
                          const isClaimed = displayStatus === 'claimed'
                          const sentDate = sentAt
                            ? new Date(sentAt).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })
                            : null
                          const tooltipTitle = isSent
                            ? `Trimis pe ${sentDate} — apasă pentru a retrimite`
                            : REMINDER_LABELS[threshold]
                          return (
                            <button
                              onClick={() => sendReminder(req.id, req.name)}
                              disabled={!!sendingId || isClaimed}
                              title={tooltipTitle}
                              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-plate)] border px-3 text-xs font-semibold transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-55 sm:min-h-9 ${
                                isSent
                                  ? 'border-[var(--sg-ok)] bg-[var(--sg-ok-soft)] text-[var(--sg-ok)]'
                                  : isSkipped
                                  ? 'border-rule bg-paper-sunk text-ink-soft'
                                  : `${badge.bg} ${badge.text} ${badge.border}`
                              }`}
                            >
                              {isSending
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : isSent || isSkipped
                                ? <CheckCircle2 className="w-3.5 h-3.5" />
                                : <Mail className="w-3.5 h-3.5" />}
                              <span className="hidden sm:inline">
                                {isSending ? 'Se trimite…' : isClaimed ? 'În curs' : isSent || isSkipped ? 'Trimite din nou' : 'Reminder'}
                              </span>
                            </button>
                          )
                        })()
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
