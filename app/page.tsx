/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from './providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { useToast } from '@/app/providers/ToastProvider'
import {
  AlertTriangle, Bell, Check, MessageSquare, FileText, Plus, MoreVertical, Trash2,
  SlidersHorizontal, ArrowUpDown, LayoutGrid, List, X, ChevronRight, ChevronDown, Info, Clock,
  BellOff, Loader2,
} from 'lucide-react'
import { useProjectChatUnread } from '@/app/providers/ProjectChatUnreadProvider'
import { useNotifications } from '@/app/providers/NotificationsProvider'
import { GENERAL_PHASE_ID } from '@/lib/calendar'
import { Plate } from '@/components/ui/Plate'
import { FloatingSurface, Scrim } from '@/components/ui/Surface'
import { IconButton } from '@/components/ui/IconButton'
import { Counter } from '@/components/ui/Counter'
import { SearchInput } from '@/components/ui/SearchInput'
import { Signal } from '@/components/ui/Signal'
import { Button, ButtonLink, buttonClass } from '@/components/ui/Button'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { EmptyState } from '@/components/ui/EmptyState'
import { TONE, type SignalTone } from '@/lib/signage'
import { ToneIcon } from '@/components/ui/ToneIcon'
import { Spinner } from '@/components/ui/Spinner'
import {
  REMINDERS_ERROR_MESSAGE,
  automaticRemindersEnabled,
  remindersActionLabel,
  remindersDoneMessage,
  remindersOffConfirm,
  saveAutomaticReminders,
} from '@/lib/automatic-reminders'

type Att = {
  overdue: number
  total: number
  review: number
  pending: number
  unreadChat: number
  unreadNotifications: number
  todo: boolean
  clean: boolean
}

type FilterOption = { key: string; name: string; count?: number }
type FilterGroup = { id: string; title: string; options: FilterOption[]; selected: Set<string>; toggle: (k: string) => void }

const SORT_OPTIONS: { key: string; label: string }[] = [
  { key: 'recent', label: 'Cele mai recente' },
  { key: 'urgency', label: 'Urgență' },
  { key: 'title', label: 'Alfabetic (A–Z)' },
  { key: 'client', label: 'După client' },
]

const ATTENTION_OPTIONS: { key: string; label: string; tone: SignalTone }[] = [
  { key: 'overdue', label: 'Depășite', tone: 'danger' },
  { key: 'todo', label: 'De rezolvat', tone: 'warn' },
  { key: 'unread', label: 'Necitite', tone: 'neutral' },
  { key: 'clean', label: 'La zi', tone: 'ok' },
]

/** Pastila de ton: culoare, glifă și cuvânt, niciodată doar culoare. */
function ToneDot({ tone }: { tone: SignalTone }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[1px] text-[10px] font-bold leading-none"
      style={{ background: TONE[tone].bg, color: TONE[tone].fg }}
    >
      <ToneIcon tone={tone} />
    </span>
  )
}

const clientKey = (p: any) => p?.client_id || '__none__'
const clientName = (p: any) => p?.profiles?.full_name || 'Fără client'
const templateKey = (p: any) => p?.template?.id || '__none__'
const templateName = (p: any) => p?.template?.name || 'Fără șablon'

// Opțiuni de filtrare (cheie, nume, număr) derivate din proiecte
function buildOptions(projects: any[], keyFn: (p: any) => string, nameFn: (p: any) => string): FilterOption[] {
  const m = new Map<string, FilterOption>()
  for (const p of projects) {
    const key = keyFn(p)
    const cur = m.get(key) ?? { key, name: nameFn(p), count: 0 }
    cur.count = (cur.count ?? 0) + 1
    m.set(key, cur)
  }
  return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, 'ro'))
}

// Bifă pătrată mică
function Tick({ on }: { on: boolean }) {
  return (
    <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[1px] border transition-colors duration-[120ms] ${on ? 'border-[var(--sg-accent)] bg-[var(--sg-accent)]' : 'border-rule-strong'}`}>
      {on && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
    </span>
  )
}

function buildBadges(att: Att, isClient: boolean): { key: string; tone: SignalTone; icon: React.ReactNode; label: string; title: string }[] {
  const badges: { key: string; tone: SignalTone; icon: React.ReactNode; label: string; title: string }[] = []
  if (att.overdue > 0) {
    badges.push({ key: 'overdue', tone: 'danger', icon: <AlertTriangle className="h-3 w-3" />, label: `${att.overdue} depășite`, title: `${att.overdue} cereri cu termen depășit` })
  }
  if (isClient) {
    if (att.total > 0) badges.push({ key: 'todo', tone: 'warn', icon: <FileText className="h-3 w-3" />, label: `${att.total} de încărcat`, title: `${att.total} documente de încărcat` })
  } else {
    if (att.review > 0) badges.push({ key: 'review', tone: 'warn', icon: <FileText className="h-3 w-3" />, label: `${att.review} de verificat`, title: `${att.review} cereri care așteaptă verificarea ta` })
    if (att.pending > 0) badges.push({ key: 'pending', tone: 'neutral', icon: <FileText className="h-3 w-3" />, label: `${att.pending} la client`, title: `${att.pending} cereri așteaptă documente de la client` })
  }
  if (att.unreadChat > 0) {
    badges.push({ key: 'chat', tone: 'neutral', icon: <MessageSquare className="h-3 w-3" />, label: `${att.unreadChat > 99 ? '99+' : att.unreadChat} mesaje`, title: `${att.unreadChat} mesaje necitite în chat` })
  }
  if (att.unreadNotifications > 0) {
    badges.push({ key: 'notifications', tone: 'neutral', icon: <Bell className="h-3 w-3" />, label: `${att.unreadNotifications > 99 ? '99+' : att.unreadNotifications} notificări`, title: `${att.unreadNotifications} notificări necitite` })
  }
  if (att.clean) {
    badges.push({ key: 'clean', tone: 'ok', icon: <Check className="h-3 w-3" strokeWidth={3} />, label: 'La zi', title: 'Nimic de făcut' })
  }
  return badges
}

/** Semnalul cel mai urgent al unui proiect decide culoarea railului plăcuței. */
function railFor(att: Att): string | undefined {
  if (att.overdue > 0) return 'var(--sg-danger)'
  if (att.todo) return 'var(--sg-warn)'
  if (att.unreadChat > 0 || att.unreadNotifications > 0) return 'var(--sg-accent)'
  if (att.clean) return 'var(--sg-ok)'
  return 'var(--sg-rule-strong)'
}

function AttentionBadges({ att, isClient, className = '' }: { att: Att; isClient: boolean; className?: string }) {
  const badges = buildBadges(att, isClient)
  if (badges.length === 0) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {badges.map((b) => (
        <Signal key={b.key} tone={b.tone} className="whitespace-nowrap">
          <span title={b.title} className="inline-flex items-center gap-1">
            {b.icon}
            {b.label}
          </span>
        </Signal>
      ))}
    </div>
  )
}

function AdminMenu({
  project, openMenuId, setOpenMenuId, onRequestDelete, onToggleAutomaticReminders, reminderToggleLoadingId,
  className = '', dropUp = false,
}: {
  project: any
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
  onRequestDelete: (p: any) => void
  onToggleAutomaticReminders: (p: any) => void
  reminderToggleLoadingId: string | null
  className?: string
  dropUp?: boolean
}) {
  const remindersEnabled = automaticRemindersEnabled(project)
  const reminderToggleLoading = reminderToggleLoadingId === project.id

  return (
    <div className={className}>
      <div className="relative">
        <IconButton
          label="Opțiuni proiect"
          aria-expanded={openMenuId === project.id}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(openMenuId === project.id ? null : project.id) }}
        >
          <MoreVertical className="h-4 w-4" />
        </IconButton>
        {openMenuId === project.id && (
          <FloatingSurface
            role="menu"
            className={`absolute right-0 z-30 w-64 rounded-[var(--radius-plate-lg)] py-1 ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          >
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(null); onToggleAutomaticReminders(project) }}
              disabled={reminderToggleLoading}
              className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors duration-[120ms] hover:bg-paper-sunk disabled:opacity-60"
              style={{ color: remindersEnabled ? 'var(--sg-warn)' : 'var(--sg-ok)' }}
            >
              {reminderToggleLoading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : remindersEnabled
                  ? <BellOff className="w-4 h-4" />
                  : <Bell className="w-4 h-4" />}
              {remindersActionLabel(remindersEnabled)}
            </button>
            <div className="my-1 border-t border-rule" />
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(null); onRequestDelete(project) }}
              className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors duration-[120ms] hover:bg-[var(--sg-danger-soft)]"
              style={{ color: 'var(--sg-danger)' }}
            >
              <Trash2 className="h-4 w-4" />
              Șterge proiectul
            </button>
          </FloatingSurface>
        )}
      </div>
    </div>
  )
}

// Secțiune de filtru pliabilă, cu search propriu
function CollapsibleSection({ group, defaultOpen }: { group: FilterGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const opts = query ? group.options.filter((o) => o.name.toLowerCase().includes(query)) : group.options

  return (
    <div className="border-t border-rule">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-11 w-full items-center justify-between py-3.5 text-left">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{group.title}</span>
          {group.selected.size > 0 && (
            <Counter n={group.selected.size} />
          )}
        </span>
        <ChevronDown className={`h-4 w-4 text-ink-faint transition-transform duration-[120ms] ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="pb-3">
          <div className="mb-2">
            <SearchInput
              size="sm"
              value={q}
              onChange={setQ}
              placeholder={`Caută ${group.title.toLowerCase()}…`}
              label={`Caută ${group.title.toLowerCase()}`}
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {opts.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-faint">Niciun rezultat</p>
            ) : (
              opts.map((o) => (
                <button key={o.key} onClick={() => group.toggle(o.key)} aria-pressed={group.selected.has(o.key)} className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-plate)] px-2 py-2 text-sm transition-colors duration-[120ms] hover:bg-paper-sunk">
                  <Tick on={group.selected.has(o.key)} />
                  <span className="flex-1 truncate text-left text-ink">{o.name}</span>
                  {typeof o.count === 'number' && <span className="text-xs font-medium text-ink-faint">{o.count}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Modal de filtrare — atenția ca pastile, restul secțiuni pliabile cu search
function FilterModal({
  open, onClose, attentionOptions, attentionSel, onToggleAtt, sections, resultCount, activeCount, onClearAll,
}: {
  open: boolean
  onClose: () => void
  attentionOptions: { key: string; label: string; tone: SignalTone; count: number }[]
  attentionSel: Set<string>
  onToggleAtt: (k: string) => void
  sections: FilterGroup[]
  resultCount: number
  activeCount: number
  onClearAll: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <Scrim onClick={onClose} />
      <FloatingSurface
        role="dialog"
        ariaModal
        ariaLabel="Filtre"
        className="relative flex max-h-[88vh] w-full flex-col rounded-t-[var(--radius-plate-lg)] sm:max-h-[80vh] sm:max-w-lg sm:rounded-[var(--radius-plate-lg)]"
      >
        <div className="flex items-center justify-between border-b border-rule px-6 py-4">
          <h2 className="text-base font-bold text-ink">Filtre</h2>
          <IconButton label="Închide filtrele" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        {/* Corp */}
        <div className="flex-1 overflow-y-auto px-6">
          {/* Atenție — pastile */}
          <div className="py-4">
            <h3 className="mb-2.5 text-sm font-semibold text-ink">Necesită atenție</h3>
            <div className="flex flex-wrap gap-2">
              {attentionOptions.map((o) => {
                const on = attentionSel.has(o.key)
                return (
                  <button
                    key={o.key}
                    onClick={() => onToggleAtt(o.key)}
                    aria-pressed={on}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-plate)] border px-3 text-xs font-semibold transition-colors duration-[120ms] sm:min-h-9 ${on ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : 'border-rule text-ink-soft hover:border-rule-strong hover:text-ink'}`}
                  >
                    <ToneDot tone={o.tone} />
                    {o.label}
                    <span className={on ? 'text-[var(--sg-accent)]' : 'text-ink-faint'}>{o.count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {sections.map((g) => (
            <CollapsibleSection key={g.id} group={g} defaultOpen={g.selected.size > 0 || g.options.length <= 6} />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-rule px-6 py-3.5">
          <Button variant="quiet" onClick={onClearAll} disabled={activeCount === 0}>
            Resetează{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Arată {resultCount} {resultCount === 1 ? 'proiect' : 'proiecte'}
          </Button>
        </div>
      </FloatingSurface>
    </div>,
    document.body,
  )
}

// Deep-link direct la cererea/activitatea relevantă (sau la cererile generale)
function buildRequestHref(r: any) {
  if (r.phase_id && r.activity_id) {
    return `/projects/${r.project_id}?phase=${r.phase_id}&activity=${r.activity_id}&document=${r.id}#activity-${r.activity_id}`
  }
  return `/projects/${r.project_id}?phase=${GENERAL_PHASE_ID}&document=${r.id}#general-requests`
}

// Rând acționabil: deschide direct cererea/activitatea
function TaskRow({ req, todayTs, mode }: { req: any; todayTs: number; mode: 'client' | 'staff' }) {
  const dl = req.deadline_at ? new Date(req.deadline_at) : null
  if (dl) dl.setHours(0, 0, 0, 0)
  const isOverdue = !!dl && dl.getTime() < todayTs
  const isRejected = req.status === 'rejected'
  const isReview = req.status === 'review'

  const tone: SignalTone = isOverdue || isRejected ? 'danger' : isReview ? 'warn' : 'warn'
  const label = mode === 'client'
    ? (isRejected ? 'Respins' : 'De încărcat')
    : (isReview ? 'De verificat' : 'La client')

  return (
    <Link href={buildRequestHref(req)} className="group flex min-h-11 items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-paper-sunk">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-plate)]"
        style={{ background: TONE[tone].bg, color: TONE[tone].fg }}
      >
        {isOverdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-snug text-ink">{req.name}</p>
        <p className="mt-0.5 truncate text-xs text-ink-soft">
          {req.project_title}
          {req.phase_name && <span className="text-ink-faint"> · {req.phase_name}</span>}
          {req.activity_name && <span className="text-ink-faint"> / {req.activity_name}</span>}
        </p>
      </div>
      {dl && (
        <span
          className="hidden flex-shrink-0 items-center gap-1 rounded-[var(--radius-plate)] px-2 py-0.5 text-xs font-semibold sm:inline-flex"
          style={isOverdue
            ? { background: TONE.danger.bg, color: TONE.danger.fg }
            : { background: 'var(--sg-paper-sunk)', color: 'var(--sg-ink-soft)' }}
        >
          <Clock className="h-2.5 w-2.5" aria-hidden="true" />
          {dl.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
        </span>
      )}
      <Signal tone={tone} className="hidden flex-shrink-0 md:inline-flex">{label}</Signal>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-faint transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]" aria-hidden="true" />
    </Link>
  )
}

// Rând document informativ recent
function DocRow({ doc }: { doc: any }) {
  const date = doc.created_at ? new Date(doc.created_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) : null
  return (
    <Link href={`/projects/${doc.project_id}?phase=${GENERAL_PHASE_ID}&document=${doc.id}#general-requests`} className="group flex min-h-11 items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-paper-sunk">
      <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]">
        <FileText className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-snug text-ink">{doc.name}</p>
        <p className="mt-0.5 truncate text-xs text-ink-soft">{doc.project_title}{date && <span className="text-ink-faint"> · {date}</span>}</p>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-faint transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]" aria-hidden="true" />
    </Link>
  )
}

// Panou lateral cu lista acționabilă (deep-link direct la cerere/activitate)
function PriorityDrawer({
  open, onClose, isClient, requests, docs, todayTs,
}: {
  open: boolean
  onClose: () => void
  isClient: boolean
  requests: any[]
  docs: any[]
  todayTs: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const title = isClient ? 'Ce ai de făcut' : 'De rezolvat'
  const showDocs = isClient && docs.length > 0
  const empty = requests.length === 0 && !showDocs

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      <Scrim onClick={onClose} />
      <FloatingSurface
        role="dialog"
        ariaModal
        ariaLabel={title}
        className="drawer-slide-in relative flex h-full w-full flex-col border-y-0 border-r-0 sm:max-w-md"
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-4">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <IconButton label={`Închide ${title.toLowerCase()}`} onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto">
          {requests.length > 0 && (
            <div className="divide-y divide-rule">
              {requests.map((req) => (
                <TaskRow key={req.id} req={req} todayTs={todayTs} mode={isClient ? 'client' : 'staff'} />
              ))}
            </div>
          )}

          {!isClient && requests.length > 0 && (
            <Link href="/my-requests" onClick={onClose} className="flex min-h-11 items-center justify-center gap-1 border-t border-rule px-5 py-3 text-sm font-semibold text-[var(--sg-accent)] transition-colors duration-[120ms] hover:bg-[var(--sg-accent-soft)]">
              Vezi toate cererile <span aria-hidden="true">→</span>
            </Link>
          )}

          {showDocs && (
            <>
              <h3 className="border-t border-rule px-5 pb-2 pt-5 text-sm font-semibold text-ink">Documente recente</h3>
              <div className="divide-y divide-rule">
                {docs.map((doc) => <DocRow key={doc.id} doc={doc} />)}
              </div>
            </>
          )}

          {empty && (
            <div className="px-5 py-16">
              <EmptyState title="Totul e la zi">
                Nu aștept nimic de la tine acum. Când apare o cerere sau un termen, o găsești aici.
              </EmptyState>
            </div>
          )}
        </div>
      </FloatingSurface>
    </div>,
    document.body,
  )
}

export default function Dashboard() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch } = useAuth()
  const { showToast, confirm } = useToast()

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<any>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [reminderToggleLoadingId, setReminderToggleLoadingId] = useState<string | null>(null)
  const [myDocRequests, setMyDocRequests] = useState<any[]>([])
  const [informativeDocs, setInformativeDocs] = useState<any[]>([])
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [docRequestsLoaded, setDocRequestsLoaded] = useState(false)
  const { unreadProjects } = useProjectChatUnread(!authLoading && !!token)
  const { unreadByProject: unreadNotifications } = useNotifications(!authLoading && !!token)

  // Controale toolbar
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('recent')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [attentionFilter, setAttentionFilter] = useState<Set<string>>(new Set())
  const [clientFilter, setClientFilter] = useState<Set<string>>(new Set())
  const [templateFilter, setTemplateFilter] = useState<Set<string>>(new Set())
  const [sortOpen, setSortOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)

  const isAdmin = currentUser?.role === 'admin'
  const canCreateProject = isAdmin || currentUser?.role === 'consultant'
  const isClient = currentUser?.role === 'client'

  const unreadChatByProjectId = useMemo(
    () => new Map(unreadProjects.map((item) => [item.projectId, item.unreadMessageCount])),
    [unreadProjects],
  )
  const unreadNotificationsByProjectId = useMemo(
    () => new Map(unreadNotifications.map((item) => [item.projectId, item.count])),
    [unreadNotifications],
  )

  // Agregăm cererile per proiect → indicatorii de pe card
  const attentionByProject = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const counts = new Map<string, { total: number; overdue: number; review: number; pending: number }>()
    for (const r of myDocRequests) {
      const cur = counts.get(r.project_id) ?? { total: 0, overdue: 0, review: 0, pending: 0 }
      cur.total += 1
      const d = r.deadline_at ? new Date(r.deadline_at) : null
      d?.setHours(0, 0, 0, 0)
      if (d && d < startOfToday) cur.overdue += 1
      if (r.status === 'review') cur.review += 1
      else cur.pending += 1
      counts.set(r.project_id, cur)
    }
    const map = new Map<string, Att>()
    for (const p of projects) {
      const c = counts.get(p.id) ?? { total: 0, overdue: 0, review: 0, pending: 0 }
      const unreadChat = unreadChatByProjectId.get(p.id) ?? 0
      const unreadNotifications = unreadNotificationsByProjectId.get(p.id) ?? 0
      map.set(p.id, {
        ...c,
        unreadChat,
        unreadNotifications,
        todo: isClient ? c.total > 0 : c.review > 0,
        clean: docRequestsLoaded && c.total === 0 && unreadChat === 0 && unreadNotifications === 0,
      })
    }
    return map
  }, [projects, myDocRequests, unreadChatByProjectId, unreadNotificationsByProjectId, docRequestsLoaded, isClient])

  // Contoare pentru opțiunile de „atenție"
  const attentionCounts = useMemo(() => {
    const c: Record<string, number> = { overdue: 0, todo: 0, unread: 0, clean: 0 }
    for (const p of projects) {
      const a = attentionByProject.get(p.id)
      if (!a) continue
      if (a.overdue > 0) c.overdue += 1
      if (a.todo) c.todo += 1
      if (a.unreadChat > 0 || a.unreadNotifications > 0) c.unread += 1
      if (a.clean) c.clean += 1
    }
    return c
  }, [projects, attentionByProject])

  const clientOptions = useMemo(() => buildOptions(projects, clientKey, clientName), [projects])
  const templateOptions = useMemo(() => buildOptions(projects, templateKey, templateName), [projects])

  const attMatch = (att: Att) =>
    (attentionFilter.has('overdue') && att.overdue > 0) ||
    (attentionFilter.has('todo') && att.todo) ||
    (attentionFilter.has('unread') && (att.unreadChat > 0 || att.unreadNotifications > 0)) ||
    (attentionFilter.has('clean') && att.clean)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = projects.filter((p) => {
      if (q) {
        const hay = `${p.title ?? ''} ${p.profiles?.full_name ?? ''} ${p.cod_intern ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (attentionFilter.size > 0 && !attMatch(attentionByProject.get(p.id)!)) return false
      if (clientFilter.size > 0 && !clientFilter.has(clientKey(p))) return false
      if (templateFilter.size > 0 && !templateFilter.has(templateKey(p))) return false
      return true
    })
    const sorted = [...list]
    if (sortKey === 'title') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ro'))
    else if (sortKey === 'client') sorted.sort((a, b) => clientName(a).localeCompare(clientName(b), 'ro'))
    else if (sortKey === 'urgency') {
      sorted.sort((a, b) => {
        const A = attentionByProject.get(a.id)!, B = attentionByProject.get(b.id)!
        const aUnread = A.unreadChat > 0 || A.unreadNotifications > 0 ? 1 : 0
        const bUnread = B.unreadChat > 0 || B.unreadNotifications > 0 ? 1 : 0
        return (B.overdue - A.overdue) || (B.total - A.total) || (bUnread - aUnread)
      })
    }
    return sorted
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, search, attentionFilter, clientFilter, templateFilter, sortKey, attentionByProject])

  const activeFilterCount = attentionFilter.size + clientFilter.size + templateFilter.size
  const anyFilterActive = activeFilterCount > 0 || search.trim() !== ''

  const toggleIn = (setter: (fn: (prev: Set<string>) => Set<string>) => void, val: string) => {
    setter((prev) => {
      const n = new Set(prev)
      if (n.has(val)) n.delete(val)
      else n.add(val)
      return n
    })
  }

  // Secțiunile pliabile din modal (client / șablon)
  const filterSections: FilterGroup[] = [
    ...(clientOptions.length > 1 ? [{ id: 'client', title: 'Client', options: clientOptions, selected: clientFilter, toggle: (k: string) => toggleIn(setClientFilter, k) }] : []),
    ...(!isClient && templateOptions.length > 1 ? [{ id: 'template', title: 'Șablon', options: templateOptions, selected: templateFilter, toggle: (k: string) => toggleIn(setTemplateFilter, k) }] : []),
  ]
  const attentionModalOptions = ATTENTION_OPTIONS.map((o) => ({ ...o, count: attentionCounts[o.key] ?? 0 }))

  const clearFilters = () => {
    setAttentionFilter(new Set())
    setClientFilter(new Set())
    setTemplateFilter(new Set())
  }
  const clearAll = () => { setSearch(''); clearFilters() }

  const fetchMyProjects = useCallback(async () => {
    const res = await apiFetch('/api/projects')
    const json = await res.json()
    if (!res.ok) {
      if (res.status === 401) return
      throw new Error(json?.error || 'Failed to load projects')
    }
    setProjects(json.projects ?? [])
  }, [apiFetch])

  const fetchCurrentUser = useCallback(async () => {
    const res = await apiFetch('/api/me')
    const json = await res.json()
    if (!res.ok) {
      if (res.status === 401) return
      throw new Error(json?.error || 'Failed to load current user')
    }
    setCurrentUser(json.profile)
  }, [apiFetch])

  const handleDeleteProject = async () => {
    if (!projectToDelete) return
    setDeleteLoading(true)
    try {
      const res = await apiFetch(`/api/projects/${projectToDelete.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed to delete project')
      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id))
      setShowDeleteModal(false)
      setProjectToDelete(null)
    } catch {
      showToast('Nu am putut șterge proiectul. Reîncearcă.', 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleToggleAutomaticReminders = async (project: any) => {
    const nextEnabled = !automaticRemindersEnabled(project)
    if (!nextEnabled && !(await confirm(remindersOffConfirm(project.title)))) return

    setReminderToggleLoadingId(project.id)
    try {
      const savedEnabled = await saveAutomaticReminders(apiFetch, project.id, nextEnabled)
      setProjects((prev) => prev.map((p) => p.id === project.id
        ? { ...p, automatic_reminders_enabled: savedEnabled }
        : p))
      showToast(remindersDoneMessage(savedEnabled), 'success')
    } catch {
      showToast(REMINDERS_ERROR_MESSAGE, 'error')
    } finally {
      setReminderToggleLoadingId(null)
    }
  }

  // Preferințe (view + sort) persistate local
  useEffect(() => {
    try {
      const v = localStorage.getItem('home:view')
      if (v === 'grid' || v === 'list') setView(v)
      const s = localStorage.getItem('home:sort')
      if (s && SORT_OPTIONS.some((o) => o.key === s)) setSortKey(s)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { try { localStorage.setItem('home:view', view) } catch { /* ignore */ } }, [view])
  useEffect(() => { try { localStorage.setItem('home:sort', sortKey) } catch { /* ignore */ } }, [sortKey])

  // Închide meniuri la click în afară
  useEffect(() => {
    const close = () => { setOpenMenuId(null); setSortOpen(false); setLegendOpen(false) }
    if (openMenuId || sortOpen || legendOpen) {
      document.addEventListener('click', close)
      return () => document.removeEventListener('click', close)
    }
  }, [openMenuId, sortOpen, legendOpen])

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.push('/login'); return }
    setLoading(true)
    Promise.all([fetchMyProjects(), fetchCurrentUser()])
      .catch(error => console.error('Failed to load dashboard:', error))
      .finally(() => setLoading(false))
  }, [authLoading, token, router, fetchMyProjects, fetchCurrentUser])

  useEffect(() => {
    if (authLoading || !token) return
    const role = currentUser?.role
    if (role !== 'admin' && role !== 'consultant' && role !== 'client') return
    apiFetch('/api/my-document-requests')
      .then((r) => r.json())
      .then((d) => { setMyDocRequests(d.requests ?? []); setInformativeDocs(d.informativeDocs ?? []) })
      .catch(console.error)
      .finally(() => setDocRequestsLoaded(true))
  }, [authLoading, token, currentUser?.role, apiFetch])

  if (loading || authLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center" role="status" aria-live="polite">
        <Spinner />
        <span className="sr-only">Se încarcă proiectele…</span>
      </div>
    )
  }

  const firstName = currentUser?.full_name?.split(' ')[0] || 'Utilizator'
  const currentDate = new Date().toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' })
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayTs = todayStart.getTime()
  const overdueReqs = myDocRequests.filter((r) => {
    if (!r.deadline_at) return false
    const d = new Date(r.deadline_at); d.setHours(0, 0, 0, 0)
    return d.getTime() < todayTs
  }).length
  const hasTasks = myDocRequests.length > 0
  const hasDocs = isClient && informativeDocs.length > 0
  const showPriority = hasTasks || hasDocs
  const priorityLabel = !hasTasks && hasDocs ? 'Documente' : isClient ? 'Ce ai de făcut' : 'De rezolvat'
  const priorityCount = hasTasks ? myDocRequests.length : informativeDocs.length
  const visibleSortOptions = SORT_OPTIONS.filter((o) => o.key !== 'client' || clientOptions.length > 1)
  const effectiveSortKey = visibleSortOptions.some((o) => o.key === sortKey) ? sortKey : 'recent'
  const sortLabel = SORT_OPTIONS.find((o) => o.key === effectiveSortKey)?.label ?? 'Sortare'

  const legendItems: { tone: SignalTone; label: string; desc: string }[] = [
    { tone: 'danger', label: 'Depășite', desc: 'termenul a trecut' },
    isClient
      ? { tone: 'warn', label: 'De încărcat', desc: 'documente cerute de la tine' }
      : { tone: 'warn', label: 'De verificat', desc: 'așteaptă verificarea ta' },
    ...(!isClient ? [{ tone: 'neutral' as SignalTone, label: 'La client', desc: 'așteaptă document de la client' }] : []),
    { tone: 'neutral', label: 'Necitite', desc: 'mesaje sau notificări noi' },
    { tone: 'ok', label: 'La zi', desc: 'nimic de făcut' },
  ]

  const activeChips: { key: string; name: string; tone?: SignalTone; remove: () => void }[] = [
    ...Array.from(attentionFilter).map((k) => {
      const o = ATTENTION_OPTIONS.find((x) => x.key === k)
      return { key: `a-${k}`, name: o?.label ?? k, tone: o?.tone, remove: () => toggleIn(setAttentionFilter, k) }
    }),
    ...Array.from(clientFilter).map((k) => {
      const o = clientOptions.find((x) => x.key === k)
      return { key: `c-${k}`, name: o?.name ?? 'Client', remove: () => toggleIn(setClientFilter, k) }
    }),
    ...Array.from(templateFilter).map((k) => {
      const o = templateOptions.find((x) => x.key === k)
      return { key: `t-${k}`, name: o?.name ?? 'Șablon', remove: () => toggleIn(setTemplateFilter, k) }
    }),
  ]

  return (
    <div className="flex flex-col gap-6">
      <LocationStrip
        segments={[{ label: 'Bonie', href: '/' }, { label: 'Proiecte' }]}
        action={
          <>
            {showPriority && (
              <Button
                variant="secondary"
                onClick={() => setPriorityOpen(true)}
                aria-label={`${priorityLabel}: ${priorityCount}${overdueReqs > 0 ? `, din care ${overdueReqs} cu termen depășit` : ''}`}
              >
                {overdueReqs > 0 && (
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-[1px]"
                    style={{ background: 'var(--sg-danger)' }}
                  />
                )}
                <span>{priorityLabel}</span>
                <Counter n={priorityCount} variant="quiet" />
              </Button>
            )}
            {canCreateProject && (
              <ButtonLink href="/projects/new" variant="primary" label="Proiect nou">
                <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                <span className="hidden sm:inline">Proiect nou</span>
              </ButtonLink>
            )}
          </>
        }
      />

      <div>
        <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Salut, {firstName}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {currentDate}
          {projects.length > 0 && (
            <>
              {' · '}
              {projects.length} {projects.length === 1 ? 'proiect' : 'proiecte'}
              {overdueReqs > 0 && (
                <>
                  {', '}
                  <span className="font-semibold" style={{ color: 'var(--sg-danger)' }}>
                    {overdueReqs} {overdueReqs === 1 ? 'termen depășit' : 'termene depășite'}
                  </span>
                </>
              )}
            </>
          )}
        </p>
      </div>

      {projects.length === 0 ? (
        /* EMPTY — niciun proiect deloc */
        <EmptyState
          title="Niciun proiect deocamdată"
          action={canCreateProject ? (
            <ButtonLink href="/projects/new" variant="primary">
              <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" /> Proiect nou
            </ButtonLink>
          ) : undefined}
        >
          {canCreateProject
            ? 'Un proiect pornește de la un șablon de faze și activități, sau de la zero.'
            : 'Când consultantul îți deschide un proiect, apare aici.'}
        </EmptyState>
      ) : (
        <>
          {/* TOOLBAR */}
          <div className="flex flex-col gap-3 border-b border-rule pb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search */}
              <div className="min-w-[220px] flex-1">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Caută după titlu, client sau cod…"
                  label="Caută proiecte"
                />
              </div>

              {/* Filtre → modal */}
              <button
                onClick={() => setFilterOpen(true)}
                aria-label="Filtre"
                className={buttonClass('secondary', 'md', activeFilterCount > 0 ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : '')}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Filtre</span>
                {activeFilterCount > 0 && (
                  <Counter n={activeFilterCount} />
                )}
              </button>

              {/* Sortare */}
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setSortOpen((v) => !v) }}
                  aria-expanded={sortOpen}
                  aria-label={`Sortare: ${sortLabel}`}
                  className={buttonClass('secondary')}
                >
                  <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden md:inline">{sortLabel}</span>
                </button>
                {sortOpen && (
                  <FloatingSurface
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-full z-40 mt-2 w-56 rounded-[var(--radius-plate-lg)] p-1.5"
                  >
                    {visibleSortOptions.map((o) => (
                      <button
                        key={o.key}
                        onClick={() => { setSortKey(o.key); setSortOpen(false) }}
                        aria-pressed={effectiveSortKey === o.key}
                        className={`flex min-h-11 w-full items-center justify-between rounded-[var(--radius-plate)] px-2.5 py-2 text-left text-sm transition-colors duration-[120ms] sm:min-h-9 ${effectiveSortKey === o.key ? 'bg-[var(--sg-accent-soft)] font-semibold text-[var(--sg-accent-ink)]' : 'text-ink-soft hover:bg-paper-sunk hover:text-ink'}`}
                      >
                        {o.label}
                        {effectiveSortKey === o.key && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                      </button>
                    ))}
                  </FloatingSurface>
                )}
              </div>

              {/* View toggle */}
              <div className="flex items-center rounded-[var(--radius-plate)] border border-rule bg-plate p-0.5">
                <button onClick={() => setView('grid')} aria-label="Vizualizare grilă" aria-pressed={view === 'grid'} className={`flex h-10 w-10 items-center justify-center rounded-[1px] transition-colors duration-[120ms] sm:h-8 sm:w-8 ${view === 'grid' ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : 'text-ink-faint hover:bg-paper-sunk hover:text-ink'}`}>
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button onClick={() => setView('list')} aria-label="Vizualizare listă" aria-pressed={view === 'list'} className={`flex h-10 w-10 items-center justify-center rounded-[1px] transition-colors duration-[120ms] sm:h-8 sm:w-8 ${view === 'list' ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : 'text-ink-faint hover:bg-paper-sunk hover:text-ink'}`}>
                  <List className="h-4 w-4" />
                </button>
              </div>

              <div className="relative">
                <IconButton
                  label="Ce înseamnă semnele"
                  aria-expanded={legendOpen}
                  onClick={(e) => { e.stopPropagation(); setLegendOpen((v) => !v) }}
                >
                  <Info className="h-4 w-4" />
                </IconButton>
                {legendOpen && (
                  <FloatingSurface
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 top-full z-40 mt-2 w-72 rounded-[var(--radius-plate-lg)] p-3"
                  >
                    <h3 className="px-1 pb-1.5 text-sm font-semibold text-ink">Ce înseamnă semnele</h3>
                    <div className="flex flex-col gap-0.5">
                      {legendItems.map((it) => (
                        <div key={it.label} className="flex items-center gap-2.5 px-1 py-1.5">
                          <ToneDot tone={it.tone} />
                          <span className="text-sm font-semibold text-ink">{it.label}</span>
                          <span className="truncate text-xs text-ink-soft">— {it.desc}</span>
                        </div>
                      ))}
                    </div>
                    <div className="my-1.5 border-t border-rule" />
                    <p className="px-1 text-xs leading-relaxed text-ink-soft">Banda de sus a plăcuței preia semnul cel mai urgent al proiectului.</p>
                  </FloatingSurface>
                )}
              </div>

            </div>

            {/* Rând rezultate + filtre active */}
            {(anyFilterActive || activeChips.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {anyFilterActive && (
                <span className="text-sm font-medium text-ink-soft" role="status" aria-live="polite">
                  {filtered.length} {filtered.length === 1 ? 'proiect' : 'proiecte'} din {projects.length}
                </span>
              )}
              {activeChips.map((chip) => (
                <button key={chip.key} onClick={chip.remove} aria-label={`Scoate filtrul ${chip.name}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-plate)] border border-rule bg-plate px-2.5 text-xs font-semibold text-ink-soft transition-colors duration-[120ms] hover:border-rule-strong hover:text-ink">
                  {chip.tone && <ToneDot tone={chip.tone} />}
                  {chip.name} <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ))}
              {anyFilterActive && (
                <button onClick={clearAll} className="ml-auto text-sm font-semibold text-[var(--sg-accent)] underline-offset-4 hover:underline">Șterge tot</button>
              )}
            </div>
            )}
          </div>

          {/* REZULTATE */}
          {filtered.length === 0 ? (
            <EmptyState
              title="Niciun proiect nu se potrivește"
              action={<Button variant="secondary" onClick={clearAll}>Șterge filtrele</Button>}
            >
              Încearcă alți termeni de căutare, sau scoate filtrele active.
            </EmptyState>
          ) : view === 'grid' ? (
            /* GRID */
            <div className="grid grid-cols-1 gap-4 pb-10 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((project) => {
                const att = attentionByProject.get(project.id)!
                return (
                  <Plate key={project.id} rail={railFor(att)} interactive className="group">
                    <Link href={`/projects/${project.id}`} className="flex h-full flex-col p-5 pt-6">
                      <h3 className="line-clamp-2 pr-10 text-lg font-bold leading-snug text-ink transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]">{project.title}</h3>
                      <p className="mt-1.5 text-sm text-ink-soft">{clientName(project)}</p>
                      <AttentionBadges att={att} isClient={isClient} className="mt-4" />
                    </Link>
                    {isAdmin && (
                      <AdminMenu
                        project={project}
                        openMenuId={openMenuId}
                        setOpenMenuId={setOpenMenuId}
                        onRequestDelete={(p) => { setProjectToDelete(p); setShowDeleteModal(true) }}
                        onToggleAutomaticReminders={handleToggleAutomaticReminders}
                        reminderToggleLoadingId={reminderToggleLoadingId}
                        className="absolute right-2 top-2 z-10"
                      />
                    )}
                  </Plate>
                )
              })}
            </div>
          ) : (
            /* LISTĂ */
            <div className="flex flex-col gap-2 pb-10">
              {filtered.map((project) => {
                const att = attentionByProject.get(project.id)!
                return (
                  <Plate key={project.id} rail={railFor(att)} interactive className="group">
                    <Link href={`/projects/${project.id}`} className="flex items-center gap-4 py-4 pl-5 pr-3 pt-5">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold text-ink transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]">{project.title}</h3>
                        <p className="mt-0.5 truncate text-sm text-ink-soft">{clientName(project)}</p>
                      </div>
                      <AttentionBadges att={att} isClient={isClient} className="hidden sm:flex" />
                      {isAdmin ? (
                        <AdminMenu
                          project={project}
                          openMenuId={openMenuId}
                          setOpenMenuId={setOpenMenuId}
                          onRequestDelete={(p) => { setProjectToDelete(p); setShowDeleteModal(true) }}
                          onToggleAutomaticReminders={handleToggleAutomaticReminders}
                          reminderToggleLoadingId={reminderToggleLoadingId}
                        />
                      ) : (
                        <ChevronRight className="mr-2 h-4 w-4 flex-shrink-0 text-ink-faint transition-colors duration-[120ms] group-hover:text-[var(--sg-accent)]" aria-hidden="true" />
                      )}
                    </Link>
                  </Plate>
                )
              })}
            </div>
          )}
        </>
      )}

      <PriorityDrawer
        open={priorityOpen}
        onClose={() => setPriorityOpen(false)}
        isClient={isClient}
        requests={myDocRequests}
        docs={informativeDocs}
        todayTs={todayTs}
      />

      <FilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        attentionOptions={attentionModalOptions}
        attentionSel={attentionFilter}
        onToggleAtt={(k) => toggleIn(setAttentionFilter, k)}
        sections={filterSections}
        resultCount={filtered.length}
        activeCount={activeFilterCount}
        onClearAll={clearFilters}
      />

      <ConfirmDeleteModal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setProjectToDelete(null) }}
        onConfirm={handleDeleteProject}
        title={`Șterge "${projectToDelete?.title || 'proiectul'}"`}
        description="Toate datele asociate vor fi șterse permanent. Această acțiune nu poate fi anulată."
        confirmText="Șterge proiectul"
        confirmWord="sterge"
        loading={deleteLoading}
      />
    </div>
  )
}
