/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from './providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import {
  AlertTriangle, Check, MessageSquare, FileText, Plus, MoreVertical, Trash2,
  Search, SlidersHorizontal, ArrowUpDown, LayoutGrid, List, X, ChevronRight, ChevronDown, Info, Clock,
} from 'lucide-react'
import { useProjectChatUnread } from '@/app/providers/ProjectChatUnreadProvider'

type Att = {
  overdue: number
  total: number
  review: number
  pending: number
  unread: number
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

const ATTENTION_OPTIONS: { key: string; label: string; dot: string }[] = [
  { key: 'overdue', label: 'Expirate', dot: 'bg-red-400' },
  { key: 'todo', label: 'De rezolvat', dot: 'bg-amber-400' },
  { key: 'unread', label: 'Chat necitit', dot: 'bg-rose-400' },
  { key: 'clean', label: 'La zi', dot: 'bg-emerald-400' },
]

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
    <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
      {on && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
    </span>
  )
}

function buildBadges(att: Att, isClient: boolean): any[] {
  const badges: any[] = []
  if (att.overdue > 0) {
    badges.push({ key: 'overdue', cls: 'bg-red-50 text-red-600 ring-red-100', icon: <AlertTriangle className="w-3 h-3" />, label: `${att.overdue} expirate`, title: `${att.overdue} cereri cu termen depășit` })
  }
  if (isClient) {
    if (att.total > 0) badges.push({ key: 'todo', cls: 'bg-amber-50 text-amber-700 ring-amber-100', icon: <FileText className="w-3 h-3" />, label: `${att.total} de încărcat`, title: `${att.total} documente de încărcat` })
  } else {
    if (att.review > 0) badges.push({ key: 'review', cls: 'bg-blue-50 text-blue-600 ring-blue-100', icon: <FileText className="w-3 h-3" />, label: `${att.review} de verificat`, title: `${att.review} cereri de verificat` })
    else if (att.pending > 0) badges.push({ key: 'pending', cls: 'bg-amber-50 text-amber-700 ring-amber-100', icon: <FileText className="w-3 h-3" />, label: `${att.pending} în așteptare`, title: `${att.pending} cereri în așteptare la client` })
  }
  if (att.unread > 0) {
    badges.push({ key: 'chat', cls: 'bg-rose-50 text-rose-600 ring-rose-100', icon: <MessageSquare className="w-3 h-3" />, label: `${att.unread > 99 ? '99+' : att.unread} mesaje`, title: `${att.unread} mesaje necitite în chat` })
  }
  if (att.clean) {
    badges.push({ key: 'clean', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-100', icon: <Check className="w-3 h-3" strokeWidth={3} />, label: 'La zi', title: 'Nimic în așteptare' })
  }
  return badges
}

function AttentionBadges({ att, isClient, className = '' }: { att: Att; isClient: boolean; className?: string }) {
  const badges = buildBadges(att, isClient)
  if (badges.length === 0) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {badges.map((b) => (
        <span key={b.key} title={b.title} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${b.cls}`}>
          {b.icon}
          {b.label}
        </span>
      ))}
    </div>
  )
}

function AdminMenu({
  project, openMenuId, setOpenMenuId, onRequestDelete, className = '', dropUp = false,
}: {
  project: any
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
  onRequestDelete: (p: any) => void
  className?: string
  dropUp?: boolean
}) {
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(openMenuId === project.id ? null : project.id) }}
        aria-label="Opțiuni proiect"
        className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-300 hover:text-slate-600 transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {openMenuId === project.id && (
        <div className={`absolute right-0 w-44 bg-white rounded-2xl shadow-xl border border-slate-200 py-1 z-30 ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(null); onRequestDelete(project) }}
            className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Șterge proiectul
          </button>
        </div>
      )}
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
    <div className="border-t border-slate-100">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between py-3.5 text-left">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{group.title}</span>
          {group.selected.size > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-bold">{group.selected.size}</span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="pb-3">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Caută ${group.title.toLowerCase()}…`}
              className="w-full h-9 pl-9 pr-8 rounded-lg border border-slate-200 bg-slate-50/60 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 focus:bg-white transition"
            />
            {q && (
              <button onClick={() => setQ('')} aria-label="Șterge" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto">
            {opts.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">Niciun rezultat</p>
            ) : (
              opts.map((o) => (
                <button key={o.key} onClick={() => group.toggle(o.key)} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-50 text-sm">
                  <Tick on={group.selected.has(o.key)} />
                  <span className="flex-1 text-left text-slate-700 truncate">{o.name}</span>
                  {typeof o.count === 'number' && <span className="text-[11px] text-slate-400 font-medium tabular-nums">{o.count}</span>}
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
  attentionOptions: { key: string; label: string; dot: string; count: number }[]
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
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[88vh] sm:max-h-[80vh] fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Filtre</h2>
          <button onClick={onClose} aria-label="Închide" className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corp */}
        <div className="flex-1 overflow-y-auto px-6">
          {/* Atenție — pastile */}
          <div className="py-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">Necesită atenție</p>
            <div className="flex flex-wrap gap-2">
              {attentionOptions.map((o) => {
                const on = attentionSel.has(o.key)
                return (
                  <button
                    key={o.key}
                    onClick={() => onToggleAtt(o.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${o.dot}`} />
                    {o.label}
                    <span className={`tabular-nums ${on ? 'text-indigo-400' : 'text-slate-400'}`}>{o.count}</span>
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
        <div className="flex items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-100">
          <button
            onClick={onClearAll}
            disabled={activeCount === 0}
            className="text-sm font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:hover:text-slate-500 transition-colors"
          >
            Resetează{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all active:scale-95">
            Arată {resultCount} {resultCount === 1 ? 'proiect' : 'proiecte'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Deep-link direct la cererea/activitatea relevantă (sau la cererile generale)
function buildRequestHref(r: any) {
  if (r.phase_id && r.activity_id) {
    return `/projects/${r.project_id}?phase=${r.phase_id}&activity=${r.activity_id}#activity-${r.activity_id}`
  }
  return `/projects/${r.project_id}?phase=__general__#general-requests`
}

// Rând acționabil: deschide direct cererea/activitatea
function TaskRow({ req, todayTs, mode }: { req: any; todayTs: number; mode: 'client' | 'staff' }) {
  const dl = req.deadline_at ? new Date(req.deadline_at) : null
  if (dl) dl.setHours(0, 0, 0, 0)
  const isOverdue = !!dl && dl.getTime() < todayTs
  const isRejected = req.status === 'rejected'
  const isReview = req.status === 'review'

  const accent = isOverdue ? 'bg-red-400' : isRejected ? 'bg-red-300' : isReview ? 'bg-blue-300' : 'bg-amber-300'
  const rowBg = isOverdue ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50/70'
  const pill = mode === 'client'
    ? (isRejected ? { cls: 'bg-red-50 text-red-500', label: 'Respins' } : { cls: 'bg-amber-50 text-amber-600', label: 'De încărcat' })
    : (isReview ? { cls: 'bg-blue-50 text-blue-500', label: 'Verificare' } : { cls: 'bg-amber-50 text-amber-600', label: 'Așteaptă' })
  const action = mode === 'client' ? 'Încarcă' : 'Deschide'

  return (
    <Link href={buildRequestHref(req)} className={`group relative flex items-center gap-3 pl-4 pr-4 py-3 transition-colors ${rowBg}`}>
      <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${accent}`} />
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isOverdue ? 'bg-red-100' : 'bg-slate-100'}`}>
        {isOverdue ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> : <FileText className="w-3.5 h-3.5 text-slate-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate leading-snug ${isOverdue ? 'text-red-700' : 'text-slate-800'}`}>{req.name}</p>
        <p className="text-[11px] text-slate-400 truncate mt-0.5">
          {req.project_title}
          {req.phase_name && <span className="text-slate-300"> · {req.phase_name}</span>}
          {req.activity_name && <span className="text-slate-300"> / {req.activity_name}</span>}
        </p>
      </div>
      {dl && (
        <div className={`hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0 ${isOverdue ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
          <Clock className="w-2.5 h-2.5" />
          {dl.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
        </div>
      )}
      <span className={`hidden md:inline-flex flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md ${pill.cls}`}>{pill.label}</span>
      <span className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-indigo-500 group-hover:text-indigo-700 transition-colors">
        {action} <span aria-hidden>→</span>
      </span>
    </Link>
  )
}

// Rând document informativ recent
function DocRow({ doc }: { doc: any }) {
  const date = doc.created_at ? new Date(doc.created_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) : null
  return (
    <Link href={`/projects/${doc.project_id}`} className="group flex items-center gap-3 pl-4 pr-4 py-3 hover:bg-slate-50/70 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
        <FileText className="w-3.5 h-3.5 text-indigo-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate leading-snug">{doc.name}</p>
        <p className="text-[11px] text-slate-400 truncate mt-0.5">{doc.project_title}{date && <span className="text-slate-300"> · {date}</span>}</p>
      </div>
      <span className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-indigo-500 group-hover:text-indigo-700 transition-colors">Vezi <span aria-hidden>→</span></span>
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
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="relative w-full sm:max-w-md h-full bg-white shadow-2xl flex flex-col drawer-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Închide" className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {requests.length > 0 && (
            <div className="divide-y divide-slate-50">
              {requests.map((req) => (
                <TaskRow key={req.id} req={req} todayTs={todayTs} mode={isClient ? 'client' : 'staff'} />
              ))}
            </div>
          )}

          {!isClient && requests.length > 0 && (
            <Link href="/my-requests" onClick={onClose} className="flex items-center justify-center gap-1 px-5 py-3 text-xs font-semibold text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50/50 transition-colors">
              Vezi toate <span aria-hidden>→</span>
            </Link>
          )}

          {showDocs && (
            <>
              <p className="px-5 pt-5 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Documente recente</p>
              <div className="divide-y divide-slate-50">
                {docs.map((doc) => <DocRow key={doc.id} doc={doc} />)}
              </div>
            </>
          )}

          {empty && (
            <div className="py-20 flex flex-col items-center justify-center text-center gap-2">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-1">
                <Check className="w-6 h-6 text-emerald-400" strokeWidth={2.5} />
              </div>
              <p className="text-sm font-semibold text-slate-600">Totul e la zi!</p>
              <p className="text-xs text-slate-400">Nu ai nimic în așteptare.</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function Dashboard() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch } = useAuth()

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<any>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [myDocRequests, setMyDocRequests] = useState<any[]>([])
  const [informativeDocs, setInformativeDocs] = useState<any[]>([])
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [docRequestsLoaded, setDocRequestsLoaded] = useState(false)
  const { unreadProjects } = useProjectChatUnread(!authLoading && !!token)

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
  const isClient = currentUser?.role === 'client'

  const unreadProjectCountById = useMemo(
    () => new Map(unreadProjects.map((item) => [item.projectId, item.unreadMessageCount])),
    [unreadProjects],
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
      const unread = unreadProjectCountById.get(p.id) ?? 0
      map.set(p.id, {
        ...c,
        unread,
        todo: isClient ? c.total > 0 : c.review > 0,
        clean: docRequestsLoaded && c.total === 0 && unread === 0,
      })
    }
    return map
  }, [projects, myDocRequests, unreadProjectCountById, docRequestsLoaded, isClient])

  // Contoare pentru opțiunile de „atenție"
  const attentionCounts = useMemo(() => {
    const c: Record<string, number> = { overdue: 0, todo: 0, unread: 0, clean: 0 }
    for (const p of projects) {
      const a = attentionByProject.get(p.id)
      if (!a) continue
      if (a.overdue > 0) c.overdue += 1
      if (a.todo) c.todo += 1
      if (a.unread > 0) c.unread += 1
      if (a.clean) c.clean += 1
    }
    return c
  }, [projects, attentionByProject])

  const clientOptions = useMemo(() => buildOptions(projects, clientKey, clientName), [projects])
  const templateOptions = useMemo(() => buildOptions(projects, templateKey, templateName), [projects])

  const attMatch = (att: Att) =>
    (attentionFilter.has('overdue') && att.overdue > 0) ||
    (attentionFilter.has('todo') && att.todo) ||
    (attentionFilter.has('unread') && att.unread > 0) ||
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
        return (B.overdue - A.overdue) || (B.total - A.total) || (B.unread - A.unread)
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

  const fetchMyProjects = async () => {
    const res = await apiFetch('/api/projects')
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error || 'Failed to load projects')
    setProjects(json.projects ?? [])
  }

  const fetchCurrentUser = async () => {
    const res = await apiFetch('/api/me')
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error || 'Failed to load current user')
    setCurrentUser(json.profile)
  }

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
    } catch (error: any) {
      console.error('Eroare la ștergere:', error)
      alert('Nu s-a putut șterge proiectul: ' + error.message)
    } finally {
      setDeleteLoading(false)
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
    Promise.all([fetchMyProjects(), fetchCurrentUser()]).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, router])

  useEffect(() => {
    if (authLoading || !token) return
    const role = currentUser?.role
    if (role !== 'admin' && role !== 'consultant' && role !== 'client') return
    apiFetch('/api/my-document-requests')
      .then((r) => r.json())
      .then((d) => { setMyDocRequests(d.requests ?? []); setInformativeDocs(d.informativeDocs ?? []) })
      .catch(console.error)
      .finally(() => setDocRequestsLoaded(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, currentUser?.role])

  if (loading || authLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
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
  const btnBase = 'inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border text-sm font-medium transition-colors'

  const legendItems = [
    { dot: 'bg-red-400', label: 'Expirate', desc: 'termen depășit' },
    isClient
      ? { dot: 'bg-amber-400', label: 'De încărcat', desc: 'documente cerute' }
      : { dot: 'bg-blue-400', label: 'De verificat', desc: 'așteaptă verificarea ta' },
    ...(!isClient ? [{ dot: 'bg-amber-400', label: 'În așteptare', desc: 'la client' }] : []),
    { dot: 'bg-rose-400', label: 'Chat necitit', desc: 'mesaje noi' },
    { dot: 'bg-emerald-400', label: 'La zi', desc: 'nimic de făcut' },
  ]

  const activeChips: { key: string; name: string; dot?: string; remove: () => void }[] = [
    ...Array.from(attentionFilter).map((k) => {
      const o = ATTENTION_OPTIONS.find((x) => x.key === k)
      return { key: `a-${k}`, name: o?.label ?? k, dot: o?.dot, remove: () => toggleIn(setAttentionFilter, k) }
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
    <div className="flex flex-col gap-6 fade-in-up">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{currentDate}</p>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">Salut, {firstName}!</h1>
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {showPriority && (
            <button
              onClick={() => setPriorityOpen(true)}
              className="relative inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:border-indigo-300 hover:bg-slate-50 transition-colors active:scale-95"
            >
              {overdueReqs > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
              <span className="hidden sm:inline">{priorityLabel}</span>
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold">{priorityCount}</span>
            </button>
          )}
          {isAdmin && (
            <Link href="/projects/new">
              <button className="flex items-center gap-2 px-4 md:px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all active:scale-95">
                <Plus className="w-4 h-4" strokeWidth={2.5} />
                <span className="hidden sm:inline">Proiect nou</span>
              </button>
            </Link>
          )}
        </div>
      </div>

      {projects.length === 0 ? (
        /* EMPTY — niciun proiect deloc */
        <div className="py-24 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
          <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center mb-4">
            <FileText className="w-6 h-6 text-slate-300" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Niciun proiect activ</h3>
          <p className="text-slate-500 mt-1">{isAdmin ? 'Creează primul proiect pentru a începe.' : 'Lista este goală momentan.'}</p>
          {isAdmin && (
            <Link href="/projects/new">
              <button className="mt-6 flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all active:scale-95">
                <Plus className="w-4 h-4" strokeWidth={2.5} /> Proiect nou
              </button>
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* TOOLBAR */}
          <div className="flex flex-col gap-3 pb-1 border-b border-slate-200/60">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Caută după titlu sau client…"
                  aria-label="Caută proiecte"
                  className="w-full h-10 pl-10 pr-9 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-300 transition"
                />
                {search && (
                  <button onClick={() => setSearch('')} aria-label="Șterge căutarea" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Filtre → modal */}
              <button
                onClick={() => setFilterOpen(true)}
                className={`${btnBase} ${activeFilterCount > 0 ? 'border-indigo-300 text-indigo-700 bg-indigo-50/60' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'}`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">Filtre</span>
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-indigo-600 text-white text-[11px] font-bold">{activeFilterCount}</span>
                )}
              </button>

              {/* Sortare */}
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setSortOpen((v) => !v) }}
                  className={`${btnBase} border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800`}
                >
                  <ArrowUpDown className="w-4 h-4" />
                  <span className="hidden md:inline">{sortLabel}</span>
                </button>
                {sortOpen && (
                  <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-200 p-1.5 z-40">
                    {visibleSortOptions.map((o) => (
                      <button
                        key={o.key}
                        onClick={() => { setSortKey(o.key); setSortOpen(false) }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${effectiveSortKey === o.key ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        {o.label}
                        {effectiveSortKey === o.key && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* View toggle */}
              <div className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5">
                <button onClick={() => setView('grid')} aria-label="Vizualizare grilă" aria-pressed={view === 'grid'} className={`p-1.5 rounded-lg transition-colors ${view === 'grid' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}>
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button onClick={() => setView('list')} aria-label="Vizualizare listă" aria-pressed={view === 'list'} className={`p-1.5 rounded-lg transition-colors ${view === 'list' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}>
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Rând rezultate + filtre active */}
            <div className="flex items-center gap-2 min-h-[24px] flex-wrap">
              <span className="text-xs font-medium text-slate-400">
                {filtered.length} {filtered.length === 1 ? 'proiect' : 'proiecte'}
                {filtered.length !== projects.length && <span className="text-slate-300"> din {projects.length}</span>}
              </span>
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setLegendOpen((v) => !v) }}
                  aria-label="Ce înseamnă culorile"
                  className="flex items-center justify-center w-5 h-5 rounded-full text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
                {legendOpen && (
                  <div onClick={(e) => e.stopPropagation()} className="absolute left-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 p-3 z-40">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1 pb-1.5">Ce înseamnă culorile</p>
                    <div className="flex flex-col gap-0.5">
                      {legendItems.map((it) => (
                        <div key={it.label} className="flex items-center gap-2.5 px-1 py-1.5">
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${it.dot}`} />
                          <span className="text-sm font-semibold text-slate-700">{it.label}</span>
                          <span className="text-xs text-slate-400 truncate">— {it.desc}</span>
                        </div>
                      ))}
                    </div>
                    <div className="my-1.5 border-t border-slate-100" />
                    <p className="px-1 text-[11px] text-slate-400 leading-relaxed">Bordura cardului preia culoarea celei mai urgente stări.</p>
                  </div>
                )}
              </div>
              {activeChips.map((chip) => (
                <button key={chip.key} onClick={chip.remove} className="inline-flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 transition-colors">
                  {chip.dot && <span className={`w-1.5 h-1.5 rounded-full ${chip.dot}`} />}
                  {chip.name} <X className="w-3 h-3" />
                </button>
              ))}
              {anyFilterActive && (
                <button onClick={clearAll} className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 ml-auto">Șterge tot</button>
              )}
            </div>
          </div>

          {/* REZULTATE */}
          {filtered.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center gap-2">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mb-1">
                <Search className="w-5 h-5 text-slate-300" />
              </div>
              <p className="text-sm font-semibold text-slate-600">Niciun proiect găsit</p>
              <p className="text-xs text-slate-400">Încearcă alți termeni sau șterge filtrele.</p>
              <button onClick={clearAll} className="mt-3 px-4 py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">Șterge filtrele</button>
            </div>
          ) : view === 'grid' ? (
            /* GRID */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-10">
              {filtered.map((project, idx) => {
                const att = attentionByProject.get(project.id)!
                const accent = att.overdue > 0 ? 'border-red-300 hover:border-red-400' : att.unread > 0 ? 'border-rose-300 hover:border-rose-400' : 'border-slate-300 hover:border-indigo-300'
                return (
                  <div
                    key={project.id}
                    className={`group relative bg-white border rounded-3xl shadow-sm hover:shadow-lg hover:shadow-slate-900/[0.06] hover:-translate-y-0.5 transition-all duration-300 ${accent}`}
                    style={{ animationDelay: `${idx * 40}ms` }}
                  >
                    <Link href={`/projects/${project.id}`} className="flex flex-col h-full p-6">
                      <h3 className="text-xl font-bold text-slate-900 leading-snug line-clamp-2 group-hover:text-indigo-600 transition-colors pr-10">{project.title}</h3>
                      <p className="text-sm text-slate-400 mt-1.5">{clientName(project)}</p>
                      <AttentionBadges att={att} isClient={isClient} className="mt-4" />
                    </Link>
                    {isAdmin && (
                      <AdminMenu
                        project={project}
                        openMenuId={openMenuId}
                        setOpenMenuId={setOpenMenuId}
                        onRequestDelete={(p) => { setProjectToDelete(p); setShowDeleteModal(true) }}
                        className="absolute top-3 right-3 z-10"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            /* LISTĂ */
            <div className="flex flex-col gap-2.5 pb-10">
              {filtered.map((project) => {
                const att = attentionByProject.get(project.id)!
                const accent = att.overdue > 0 ? 'border-red-300' : att.unread > 0 ? 'border-rose-300' : 'border-slate-300'
                return (
                  <div key={project.id} className={`group relative bg-white border rounded-2xl hover:shadow-md hover:shadow-slate-900/[0.05] hover:border-indigo-200 transition-all ${accent}`}>
                    <Link href={`/projects/${project.id}`} className="flex items-center gap-4 pl-5 pr-3 py-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">{project.title}</h3>
                        <p className="text-xs text-slate-400 truncate mt-0.5">{clientName(project)}</p>
                      </div>
                      <AttentionBadges att={att} isClient={isClient} className="hidden sm:flex" />
                      {isAdmin ? (
                        <AdminMenu project={project} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} onRequestDelete={(p) => { setProjectToDelete(p); setShowDeleteModal(true) }} />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition-colors flex-shrink-0 mr-2" />
                      )}
                    </Link>
                  </div>
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
