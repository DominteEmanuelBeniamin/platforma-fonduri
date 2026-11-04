'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FloatingSurface } from '@/components/ui/Surface'
import { FeedbackMessage } from '@/components/FeedbackMessage'

type Item = {
  id: string
  kind: string
  title: string
  reason: string
  project_name?: string
  template_name?: string
  project_id?: string
  template_id?: string
  state?: string
  source?: string
  url?: string
}

type Impact = {
  checked_at: string
  blockers: Item[]
  information: Item[]
  totals: { blockers: number; information: number }
  warnings: string[]
}

type User = {
  id: string
  role: 'admin' | 'consultant'
  full_name?: string | null
  email?: string | null
  specializare?: string | null
}

const kindLabels: Record<string, string> = {
  last_admin: 'Administrator',
  general_consultant: 'Consultant general',
  activity: 'Activitate',
  request: 'Cerere de documente',
  senior: 'Senior',
  template: 'Șablon',
  inactive_template: 'Șablon neutilizabil',
  legacy_client_data: 'Date de client păstrate',
  legacy_client_project: 'Proiect de client',
  internal_client_data: 'Date de client păstrate',
  internal_client_project: 'Proiect de client',
  membership: 'Membru',
  historical_project_closer: 'Autorul încheierii proiectului',
  historical_phase_closer: 'Autorul finalizării fazei',
  historical_activity_closer: 'Autorul finalizării activității',
  historical_review: 'Verificare anterioară',
  historical_upload: 'Încărcare anterioară',
  historical_activity: 'Activitate încheiată',
  historical_request: 'Cerere încheiată',
}

const stateLabels: Record<string, string> = {
  active: 'în lucru',
  completed: 'încheiat',
  closed: 'închis',
  pending: 'în așteptare',
  in_progress: 'în lucru',
  blocked: 'blocat',
  skipped: 'omis',
  suspended: 'suspendat',
  cancelled: 'anulat',
  archived: 'arhivat',
  review: 'în verificare',
  draft: 'ciornă',
  published: 'publicat',
  approved: 'aprobat',
  rejected: 'respins',
}

const sourceLabels: Record<string, string> = {
  direct: 'Atribuire directă',
  activity: 'Responsabilitate moștenită prin activitate',
  general_consultant: 'Responsabilitate moștenită prin consultantul general',
  draft: 'Ciornă',
  published: 'Publicată',
}

export function UserRoleChangeDialog({
  user,
  apiFetch,
  onClose,
  onSaved,
  onSyncIncomplete,
  targetLevel,
  deactivate = false,
}: {
  user: User
  deactivate?: boolean
  targetLevel?: 'junior' | 'senior'
  apiFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>
  onClose: () => void
  onSaved: (profile: unknown) => void | Promise<void>
  onSyncIncomplete?: () => void | Promise<void>
}) {
  const role = targetLevel || deactivate ? user.role : user.role === 'admin' ? 'consultant' : 'admin'
  const [specializare, setSpecializare] = useState(user.specializare ?? '')
  const [level, setLevel] = useState<'junior' | 'senior'>('junior')
  const [impact, setImpact] = useState<Impact | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)
  const check = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch(`/api/users/${user.id}/role-impact`, {
        method: 'POST',
        body: JSON.stringify(deactivate
          ? { is_active: false }
          : targetLevel
            ? { consultant_level: targetLevel }
            : { role, ...(role === 'consultant' ? { consultant_level: level } : {}) }),
      })
      const data = await response.json()
      if (request !== requestRef.current) return
      if (!response.ok || !data?.totals || !Number.isSafeInteger(data.totals.blockers)
        || data.totals.blockers < 0 || !Number.isSafeInteger(data.totals.information)
        || !Array.isArray(data.blockers) || !Array.isArray(data.information)) throw new Error()
      setImpact(data)
    } catch {
      if (request === requestRef.current) {
        setImpact(null)
        setError('Nu am putut verifica impactul. Reîncearcă înainte de confirmare.')
      }
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [apiFetch, user.id, role, level, targetLevel, deactivate])

  useEffect(() => {
    void check()
    return () => { requestRef.current += 1 }
  }, [check])

  useEffect(() => {
    const recheck = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [check])

  async function save() {
    if (!impact || impact.totals.blockers !== 0 || loading || saving
      || (!deactivate && !targetLevel && role === 'consultant' && !specializare.trim())) return
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch(`/api/users/${user.id}${deactivate ? '/deactivate' : ''}`, {
        method: deactivate ? 'POST' : 'PATCH',
        body: JSON.stringify(deactivate
          ? {}
          : targetLevel
            ? { consultant_level: targetLevel }
            : { role, ...(role === 'consultant' ? { consultant_level: level, specializare: specializare.trim() } : {}) }),
      })
      const body = await response.json().catch(() => null)
      if (deactivate && response.status === 503 && body?.code === 'AUTH_SYNC_INCOMPLETE') {
        await onSyncIncomplete?.()
        return
      }
      if (response.status === 409) {
        await check()
        setError(body?.message || 'Situația s-a schimbat. Verifică din nou impactul înainte de confirmare.')
        return
      }
      if (!response.ok) {
        setError(body?.message || body?.error || 'Nu am putut schimba rolul.')
        return
      }
      await onSaved(body?.profile)
    } catch {
      setError('Nu am putut schimba rolul. Reîncearcă.')
    } finally {
      setSaving(false)
    }
  }

  function entries(items: Item[], blockers = false) {
    const groups = new Map<string, Item[]>()
    for (const item of items) {
      const key = item.project_id ? `project:${item.project_id}` : item.template_id ? `template:${item.template_id}` : 'other'
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups].map(([group, rows]) => (
      <details key={group} className="group mt-3 rounded-[var(--radius-plate)] border border-rule bg-plate">
        <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 font-semibold transition-colors [&::-webkit-details-marker]:hidden ${blockers ? 'bg-[color-mix(in_srgb,var(--sg-warn-soft)_45%,var(--sg-plate))] hover:bg-[var(--sg-warn-soft)]' : 'bg-[color-mix(in_srgb,var(--sg-accent-soft)_45%,var(--sg-plate))] hover:bg-[var(--sg-accent-soft)]'}`}>
          {rows[0].project_name || rows[0].template_name || 'Alte referințe'} ({rows.length})
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <ul className="space-y-2 px-3 py-3">
          {rows.map((item) => {
            const activityId = blockers && item.kind === 'request' && item.source === 'activity' && item.url
              ? new URL(item.url, 'http://localhost').searchParams.get('activity') : null
            const activeParent = activityId && rows.find(row => row.kind === 'activity' && row.id === activityId)
            if (activeParent) return null
            const activity = activityId && impact?.information.find(info => info.kind === 'historical_activity' && info.id === activityId && info.state === 'completed')
            const related = activity ? rows.filter(row => row.kind === 'request' && row.source === 'activity' && row.url && new URL(row.url, 'http://localhost').searchParams.get('activity') === activityId) : []
            if (activity && related[0] !== item) return null
            const renderItem = (entry: Item) => (
            <li key={entry.id} className="border-l-2 border-rule pl-3">
              <p className="font-semibold">{entry.reason}</p>
              <p className="text-ink-soft">
                {kindLabels[entry.kind] || 'Referință'}: {entry.title}
                {entry.state && !(blockers && entry.state === 'active') ? ` · ${stateLabels[entry.state] || 'stare necunoscută'}` : ''}
              </p>
              {entry.source && entry.source !== entry.state && sourceLabels[entry.source] && <p className="text-ink-soft">{sourceLabels[entry.source]}</p>}
              {entry.url && (
                <a className="text-[var(--sg-accent)] underline" href={entry.url} target="_blank" rel="noopener noreferrer">
                  {entry.kind.includes('request') || entry.kind === 'historical_review' || entry.kind === 'historical_upload' ? 'Deschide cererea'
                    : entry.kind === 'senior' || entry.kind === 'membership' ? 'Deschide echipa'
                    : entry.kind.includes('activity') ? 'Deschide activitatea'
                    : entry.kind === 'historical_phase_closer' ? 'Deschide faza'
                    : entry.kind.includes('template') ? 'Editează șablonul'
                    : entry.project_id ? 'Deschide proiectul' : 'Vezi detaliile'} <span className="sr-only">(filă nouă)</span>
                </a>
              )}
            </li>
            )
            if (blockers && item.kind === 'activity') {
              const inherited = rows.filter(row => row.kind === 'request' && row.source === 'activity' && row.url && new URL(row.url, 'http://localhost').searchParams.get('activity') === item.id)
              if (inherited.length) return (
                <li key={`activity-group-${item.id}`}>
                  <ul>{renderItem(item)}</ul>
                  <p className="mt-2 text-ink-soft">Cererile de mai jos au preluat responsabilul din această activitate.</p>
                  <ul className="mt-2 space-y-2 pl-3">{inherited.map(renderItem)}</ul>
                </li>
              )
            }
            return activity ? (
              <li key={`activity-context-${activity.id}`}>
                <p className="font-semibold">Activitate: {activity.title} · Finalizată</p>
                <p className="text-ink-soft">Cererile de mai jos au preluat responsabilul din această activitate.</p>
                {activity.url && <a className="text-[var(--sg-accent)] underline" href={activity.url} target="_blank" rel="noopener noreferrer">Deschide activitatea <span className="sr-only">(filă nouă)</span></a>}
                <ul className="mt-2 space-y-2 pl-3">{related.map(renderItem)}</ul>
              </li>
            ) : renderItem(item)
          })}
        </ul>
      </details>
    ))
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !saving) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999999] bg-black/45 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[1000000] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 focus:outline-none">
          <FloatingSurface className="flex max-h-[calc(100dvh_-_2rem)] flex-col overflow-hidden rounded-[var(--radius-plate-lg)]">
          <div className="min-h-0 overflow-y-auto px-5 py-4">
          <Dialog.Title className="text-xl font-bold">
            {deactivate ? 'Dezactivează contul' : targetLevel ? 'Schimbă nivelul' : 'Schimbă rolul'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-ink-soft">
            Cont: {user.full_name || user.email}.
          </Dialog.Description>
          <p className="mt-3 text-sm font-semibold">
            {deactivate ? 'Acțiune: dezactivarea contului' : targetLevel ? `Nivel nou: consultant ${targetLevel}` : `Rol actual: ${user.role === 'admin' ? 'administrator' : 'consultant'} → Rol nou: ${role === 'admin' ? 'administrator' : 'consultant'}`}
          </p>
          <p className="mt-3 text-sm">
            {deactivate ? 'Contul nu se va mai putea conecta. Istoricul și apartenențele rămân.'
              : targetLevel ? 'Schimbarea nivelului păstrează atribuțiile și apartenențele consultantului.'
              : role === 'consultant' ? 'Consultantul are acces la proiectele în care este membru. Apartenențele existente rămân; nu este adăugat automat în alte proiecte.'
              : 'Administratorul are acces general. Responsabilitățile incompatibile trebuie predate înainte de schimbare.'}
          </p>
          {impact && !loading && (
            <FeedbackMessage variant={impact.totals.blockers > 0 ? 'warning' : 'success'} className="mt-4">
              {impact.totals.blockers > 0
                ? `Acțiunea nu poate fi confirmată încă. Rezolvă ${impact.totals.blockers === 1 ? 'blocajul' : `cele ${impact.totals.blockers} blocaje`} de mai jos.`
                : 'Nu există blocaje. Verifică informațiile de mai jos înainte de confirmare.'}
            </FeedbackMessage>
          )}
          {!deactivate && !targetLevel && role === 'consultant' && (
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-semibold">
                Specializare
                <input value={specializare} onChange={e => setSpecializare(e.target.value)} maxLength={300} required className="mt-1 block h-11 w-full border border-rule px-3 font-normal" />
              </label>
              <label className="block text-sm font-semibold">
                Nivel
                <select
                  value={level}
                  onChange={e => { setImpact(null); setLevel(e.target.value as 'junior' | 'senior') }}
                  className="mt-1 block h-11 w-full border border-rule bg-plate px-3 font-normal"
                >
                  <option value="junior">Junior</option>
                  <option value="senior">Senior</option>
                </select>
              </label>
            </div>
          )}
          {loading && <p role="status" className="mt-4">Se verifică impactul…</p>}
          {error && <p role="alert" className="mt-4 text-[var(--sg-danger)]">{error}</p>}
          {impact && (
            <div className="mt-4 text-sm">
              <p>Ultima verificare: {new Date(impact.checked_at).toLocaleString('ro-RO')}</p>
              {impact.warnings?.map(w => <p key={w} className="mt-2 text-[var(--sg-warn)]">
                {w === 'Nu va mai exista niciun consultant senior activ.'
                  ? 'După această acțiune, nu va mai exista niciun consultant senior activ în aplicație. Acest avertisment nu blochează singur confirmarea; eventualele blocaje pe proiecte sunt afișate mai jos.'
                  : w}
              </p>)}
              <section className="mt-4 rounded-[var(--radius-plate)] border border-rule bg-plate p-3 text-ink">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]"><AlertTriangle className="h-4 w-4" aria-hidden="true" /></span>
                  <div>
                    <h3 className="font-bold">De rezolvat înainte de schimbare ({impact.totals.blockers})</h3>
                    <p className="mt-1 text-ink-soft">Aceste situații împiedică acțiunea și trebuie rezolvate înainte de confirmare.</p>
                  </div>
                </div>
                {impact.totals.blockers === 0 ? <p className="mt-2">Nu există blocaje.</p> : entries(impact.blockers, true)}
              </section>
              <section className="mt-4 rounded-[var(--radius-plate)] border border-rule bg-plate p-3 text-ink">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]"><Info className="h-4 w-4" aria-hidden="true" /></span>
                  <div>
                    <h3 className="font-bold">Se păstrează fără modificări ({impact.totals.information})</h3>
                    <p className="mt-1 text-ink-soft">Aceste apartenențe și înregistrări rămân asociate contului. Nu împiedică acțiunea și nu necesită rezolvare.</p>
                  </div>
                </div>
                {impact.totals.information === 0 ? <p className="mt-2">Nu există înregistrări de afișat.</p> : entries(impact.information)}
              </section>
            </div>
          )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-3">
            {!loading && !saving && impact && (impact.totals.blockers > 0 || (!deactivate && !targetLevel && role === 'consultant' && !specializare.trim())) && (
              <p className="w-full text-right text-xs text-ink-soft">
                {impact.totals.blockers > 0 ? 'Confirmarea devine disponibilă după rezolvarea blocajelor.' : 'Completează specializarea pentru a putea confirma.'}
              </p>
            )}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button variant="quiet" type="button" onClick={onClose} disabled={saving}>Renunță</Button>
            <Button type="button" data-tooltip="Verifică din nou impactul" onClick={() => void check()} disabled={loading || saving}>Reverifică</Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={!impact || impact.totals.blockers !== 0 || loading || saving || (!deactivate && !targetLevel && role === 'consultant' && !specializare.trim())}
              variant={deactivate ? 'danger' : 'primary'}
            >
              {deactivate ? 'Dezactivează contul' : 'Confirmă schimbarea'}
            </Button>
            </div>
          </div>
          </FloatingSurface>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
