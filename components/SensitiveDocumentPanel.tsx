'use client'

import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DateField } from '@/components/ui/DatePicker'
import { AutoGrowTextarea } from '@/components/template-editor/AutoGrowTextarea'
import {
  describeSensitiveTerms,
  formatSensitiveDate,
  isSensitiveKind,
  sensitiveClientNotice,
  SENSITIVE_LABELS,
} from '@/lib/sensitive-documents'

type SensitiveRequest = {
  id: string
  sensitive_kind?: string | null
  sensitive_purge_at?: string | null
  sensitive_purge_due_at?: string | null
  sensitive_hold_until?: string | null
  sensitive_hold_reason?: string | null
  sensitive_purged_at?: string | null
}

/**
 * Fișa unei cereri cu date sensibile. Clientul află de ce i se cere documentul
 * și când se șterge. Echipa vede termenul calculat, iar adminul îl poate amâna
 * cu un motiv scris (de exemplu, un control în curs); amânarea intră în jurnal.
 * Amânarea rămâne posibilă și pe un proiect încheiat: tocmai atunci curge
 * termenul copiilor de buletin.
 */
export function SensitiveDocumentPanel({
  request,
  isStaff,
  isAdmin,
  apiFetch,
  onUpdate,
  onError,
}: {
  request: SensitiveRequest
  isStaff: boolean
  isAdmin: boolean
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>
  onUpdate: () => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const kind = request.sensitive_kind
  if (!isSensitiveKind(kind)) return null

  const purgedOn = formatSensitiveDate(request.sensitive_purged_at)
  const holdUntil = request.sensitive_hold_until && !request.sensitive_purged_at ? request.sensitive_hold_until : null

  const submit = async (body: { until: string | null; reason?: string }) => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/document-requests/${request.id}/sensitive-hold`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Nu am putut salva amânarea.')
      setEditing(false)
      setUntil('')
      setReason('')
      onUpdate()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Nu am putut salva amânarea.')
    } finally {
      setSaving(false)
    }
  }

  if (!isStaff) {
    return (
      <div className="flex items-start gap-2 rounded-[var(--radius-plate)] border border-rule-strong bg-paper-sunk px-4 py-3 text-sm text-ink-soft">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <p>
          {purgedOn
            ? `Fișierele acestui document au fost șterse automat pe ${purgedOn}, pentru că conțineau date sensibile.`
            : sensitiveClientNotice(kind)}
        </p>
      </div>
    )
  }

  const status = describeSensitiveTerms({
    kind,
    purgeAt: request.sensitive_purge_at,
    dueAt: request.sensitive_purge_due_at,
    purgedAt: request.sensitive_purged_at,
  })
  const canHold = isAdmin && !request.sensitive_purged_at

  return (
    <div className="space-y-2 rounded-[var(--radius-plate)] border border-rule-strong bg-paper-sunk px-4 py-3 text-sm text-ink-soft">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p>
            <span className="font-semibold text-ink">Date sensibile: {SENSITIVE_LABELS[kind]}.</span> {status}
          </p>
          {holdUntil && request.sensitive_hold_reason && (
            <p className="text-xs">Motivul amânării: {request.sensitive_hold_reason}</p>
          )}
        </div>
      </div>

      {canHold && !editing && (
        <div className="flex flex-wrap gap-2 pl-6">
          <Button
            data-tooltip="Oprește ștergerea automată până la o dată aleasă, de exemplu pe durata unui control"
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setEditing(true)}
          >
            {holdUntil ? 'Schimbă amânarea' : 'Amână ștergerea'}
          </Button>
          {holdUntil && (
            <Button
              data-tooltip="Fișierele se șterg din nou la termenul normal"
              type="button"
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={() => { void submit({ until: null }) }}
            >
              Scoate amânarea
            </Button>
          )}
        </div>
      )}

      {canHold && editing && (
        <form
          className="space-y-3 pl-6"
          onSubmit={event => {
            event.preventDefault()
            if (!until || !reason.trim()) return
            void submit({ until, reason: reason.trim() })
          }}
        >
          <div>
            <span className="mb-1 block text-xs font-semibold text-ink">Păstrează fișierele până pe</span>
            <DateField value={until} onChange={setUntil} minToday allowClear={false} label="Data până la care se amână ștergerea" />
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink">Motiv</span>
            <AutoGrowTextarea value={reason} onChange={setReason} placeholder="De exemplu: control AFIR în curs" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button data-tooltip="Salvează amânarea și o scrie în jurnal" type="submit" variant="primary" size="sm" disabled={saving || !until || !reason.trim()}>
              Salvează amânarea
            </Button>
            <Button data-tooltip="Închide fără să schimbi nimic" type="button" variant="secondary" size="sm" disabled={saving} onClick={() => setEditing(false)}>
              Renunță
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
