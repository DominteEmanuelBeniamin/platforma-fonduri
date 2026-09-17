/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { downloadBlob } from '@/lib/file-preview'
import { Fragment, useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import {
  LogOut,
  Plus,
  PlusSquare,
  Pencil,
  Trash2,
  User,
  FolderKanban,
  FileText,
  Layers,
  Zap,
  Search,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Users,
  Briefcase,
  MessageSquare,
  Mail,
  Lock,
  CheckSquare,
  ListOrdered,
  HardDrive,
  Share2,
  History,
  Filter,
  FileDown,
  Shield,
  LogIn,
  Activity,
} from 'lucide-react'
import SelectFilter from '@/components/SelectFilter'
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@/lib/audit-catalog'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { EmptyState } from '@/components/ui/EmptyState'

interface AuditLog {
  id: string
  user_id: string | null
  action_type: string
  entity_type: string
  entity_id: string | null
  entity_name: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  description: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
  user?: { email: string; full_name: string | null }
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

interface Stats {
  totalLogs: number
  recentLogs: number
  byAction: Record<string, number>
  byEntity: Record<string, number>
}

type EntityConfig = { icon: React.ElementType }
type ActionConfig = {
  color: string
  bgColor: string
  borderColor: string
  icon: React.ElementType
}

const ACTION_CONFIG: Record<string, ActionConfig> = {
  login: { color: 'text-[var(--sg-ok)]', bgColor: 'bg-[var(--sg-ok-soft)]', borderColor: 'border-[var(--sg-ok)]', icon: LogIn },
  logout: { color: 'text-ink-soft', bgColor: 'bg-paper-sunk', borderColor: 'border-rule', icon: LogOut },
  create: { color: 'text-[var(--sg-accent)]', bgColor: 'bg-[var(--sg-accent-soft)]', borderColor: 'border-[var(--sg-accent)]', icon: Plus },
  add: { color: 'text-[var(--sg-accent)]', bgColor: 'bg-[var(--sg-accent-soft)]', borderColor: 'border-[var(--sg-accent)]', icon: PlusSquare },
  update: { color: 'text-[var(--sg-warn)]', bgColor: 'bg-[var(--sg-warn-soft)]', borderColor: 'border-[var(--sg-warn)]', icon: Pencil },
  publish: { color: 'text-[var(--sg-ok)]', bgColor: 'bg-[var(--sg-ok-soft)]', borderColor: 'border-[var(--sg-ok)]', icon: CheckSquare },
  propagate: { color: 'text-[var(--sg-accent)]', bgColor: 'bg-[var(--sg-accent-soft)]', borderColor: 'border-[var(--sg-accent)]', icon: Share2 },
  delete: { color: 'text-[var(--sg-danger)]', bgColor: 'bg-[var(--sg-danger-soft)]', borderColor: 'border-[var(--sg-danger)]', icon: Trash2 },
  download: { color: 'text-[var(--sg-accent)]', bgColor: 'bg-[var(--sg-accent-soft)]', borderColor: 'border-[var(--sg-accent)]', icon: Download },
  notify: { color: 'text-[var(--sg-accent)]', bgColor: 'bg-[var(--sg-accent-soft)]', borderColor: 'border-[var(--sg-accent)]', icon: Mail },
  deadline_reminder_digest: { color: 'text-[var(--sg-accent)]', bgColor: 'bg-[var(--sg-accent-soft)]', borderColor: 'border-[var(--sg-accent)]', icon: Mail },
}

const DEFAULT_ACTION: ActionConfig = {
  color: 'text-ink-soft',
  bgColor: 'bg-paper-sunk',
  borderColor: 'border-rule',
  icon: Activity,
}

const ENTITY_CONFIG: Record<string, EntityConfig> = {
  user: { icon: User },
  project: { icon: FolderKanban },
  document: { icon: FileText },
  document_request: { icon: FileText },
  document_review: { icon: CheckSquare },
  request: { icon: FileText },
  file: { icon: FileText },
  file_access: { icon: HardDrive },
  team_member: { icon: Users },
  phase: { icon: Layers },
  activity: { icon: Zap },
  chat_message: { icon: MessageSquare },
  template: { icon: Briefcase },
  template_phase: { icon: Layers },
  template_activity: { icon: Zap },
  template_document: { icon: FileText },
  template_document_requirement: { icon: FileText },
  status: { icon: CheckSquare },
  status_reorder: { icon: ListOrdered },
  phase_reorder: { icon: ListOrdered },
  activity_reorder: { icon: ListOrdered },
  document_request_reorder: { icon: ListOrdered },
  project_phase: { icon: Layers },
  project_activity: { icon: Zap },
  project_member: { icon: Users },
  client: { icon: Briefcase },
  private_conversation: { icon: Lock },
  private_message: { icon: Lock },
  audit_log: { icon: Shield },
  deadline_reminder_digest: { icon: Mail },
}

const DEFAULT_ENTITY: EntityConfig = { icon: FileText }

const getActionConfig = (key: string): ActionConfig =>
  ACTION_CONFIG[key] ?? DEFAULT_ACTION
const getEntityConfig = (key: string): EntityConfig =>
  ENTITY_CONFIG[key] ?? DEFAULT_ENTITY

const formatUnknownKey = (key: string) =>
  key.replace(/_/g, ' ').replace(/^./, char => char.toUpperCase())
const getActionLabel = (key: string) =>
  AUDIT_ACTION_LABELS[key as keyof typeof AUDIT_ACTION_LABELS] ?? formatUnknownKey(key)
const getEntityLabel = (key: string) =>
  AUDIT_ENTITY_LABELS[key as keyof typeof AUDIT_ENTITY_LABELS] ?? formatUnknownKey(key)

// Cele mai citite acțiuni ca pastile de un click; restul rămân în dropdown-ul
// „Altă acțiune", ca să nu se piardă nimic din filtrare.
const QUICK_ACTIONS: { key: string; label: string }[] = [
  { key: '', label: 'Toate' },
  { key: 'login', label: 'Autentificări' },
  { key: 'create', label: 'Creări' },
  { key: 'update', label: 'Modificări' },
  { key: 'delete', label: 'Ștergeri' },
  { key: 'publish', label: 'Publicări' },
]

const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayISO = () => toISODate(new Date())
const daysAgoISO = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toISODate(d)
}

type QuickRange = 'all' | 'today' | '7d' | '30d' | 'custom'
const QUICK_RANGES: { key: QuickRange; label: string }[] = [
  { key: 'all', label: 'Tot' },
  { key: 'today', label: 'Azi' },
  { key: '7d', label: '7 zile' },
  { key: '30d', label: '30 zile' },
]
const quickRangeDates = (key: QuickRange): [string, string] => {
  if (key === 'today') return [todayISO(), todayISO()]
  if (key === '7d') return [daysAgoISO(6), todayISO()]
  if (key === '30d') return [daysAgoISO(29), todayISO()]
  return ['', '']
}
const detectQuickRange = (from: string, to: string): QuickRange => {
  if (!from && !to) return 'all'
  if (from === todayISO() && to === todayISO()) return 'today'
  if (from === daysAgoISO(6) && to === todayISO()) return '7d'
  if (from === daysAgoISO(29) && to === todayISO()) return '30d'
  return 'custom'
}

/** Registrul se citește pe zile, nu pe rânduri identice repetate: „Azi”,
 *  „Ieri”, apoi data — data însăși dispare din fiecare rând, unde rămâne
 *  doar ora. */
const dayGroupKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
const dayGroupLabel = (iso: string) => {
  const d = new Date(iso)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const diffDays = Math.round((startOf(new Date()).getTime() - startOf(d).getTime()) / 86_400_000)
  const dateLabel = d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' })
  if (diffDays === 0) return `Azi · ${dateLabel}`
  if (diffDays === 1) return `Ieri · ${dateLabel}`
  return dateLabel
}
const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })

export default function AuditPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()
  const { showToast } = useToast()

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)

  const [actionType, setActionType] = useState<string>('')
  const [entityType, setEntityType] = useState<string>('')
  const [entityId, setEntityId] = useState<string>('')
  const [userIdFilter, setUserIdFilter] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [searchInput, setSearchInput] = useState<string>('')
  const [users, setUsers] = useState<Array<{ id: string; email: string; full_name: string | null }>>([])
  const [exporting, setExporting] = useState(false)

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [customRangeOpen, setCustomRangeOpen] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true)
      const res = await apiFetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stats' }),
      })
      const json = await res.json()
      if (res.ok) setStats(json)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setStatsLoading(false)
    }
  }, [apiFetch])

  const fetchLogs = useCallback(
    async (page = 1) => {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', '30')
        if (actionType) params.set('action_type', actionType)
        if (entityType) params.set('entity_type', entityType)
        if (entityId) params.set('entity_id', entityId)
        if (userIdFilter) params.set('user_id', userIdFilter)
        if (fromDate) params.set('from_date', fromDate)
        if (toDate) params.set('to_date', toDate)
        if (search) params.set('search', search)

        const res = await apiFetch(`/api/audit?${params.toString()}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || 'Failed to fetch audit logs')

        setLogs(json.logs || [])
        setPagination(json.pagination || null)
      } catch (err: any) {
        console.error('Failed to fetch logs:', err)
      } finally {
        setLoading(false)
      }
    },
    [apiFetch, actionType, entityType, entityId, userIdFilter, fromDate, toDate, search]
  )

  const fetchUsers = useCallback(async () => {
    try {
      const res = await apiFetch('/api/users')
      const json = await res.json()
      if (res.ok && Array.isArray(json.users)) {
        setUsers(
          json.users.map((u: any) => ({
            id: u.id,
            email: u.email,
            full_name: u.full_name ?? null,
          })),
        )
      }
    } catch (err) {
      console.error('Failed to fetch users for audit filter:', err)
    }
  }, [apiFetch])

  useEffect(() => {
    if (authLoading) return
    if (!token) {
      router.push('/login')
      return
    }
    if (!profile) return
    if (profile.role !== 'admin') {
      router.push('/')
      return
    }
    fetchStats()
    fetchLogs(1)
    fetchUsers()
  }, [authLoading, token, profile, router, fetchStats, fetchLogs, fetchUsers])

  useEffect(() => {
    if (!authLoading && token && profile?.role === 'admin') {
      fetchLogs(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionType, entityType, entityId, userIdFilter, fromDate, toDate, search])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  const clearFilters = () => {
    setActionType('')
    setEntityType('')
    setEntityId('')
    setUserIdFilter('')
    setFromDate('')
    setToDate('')
    setSearch('')
    setSearchInput('')
    setCustomRangeOpen(false)
  }

  const applyQuickRange = (key: QuickRange) => {
    if (key === 'custom') { setCustomRangeOpen(true); return }
    const [from, to] = quickRangeDates(key)
    setFromDate(from)
    setToDate(to)
    setCustomRangeOpen(false)
  }

  const escapeCsvCell = (val: unknown): string => {
    if (val === null || val === undefined) return ''
    const s = typeof val === 'string' ? val : JSON.stringify(val)
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const exportCsv = useCallback(async () => {
    try {
      setExporting(true)
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('limit', '100')
      if (actionType) params.set('action_type', actionType)
      if (entityType) params.set('entity_type', entityType)
      if (entityId) params.set('entity_id', entityId)
      if (userIdFilter) params.set('user_id', userIdFilter)
      if (fromDate) params.set('from_date', fromDate)
      if (toDate) params.set('to_date', toDate)
      if (search) params.set('search', search)

      const allRows: AuditLog[] = []
      let page = 1
      const MAX_PAGES = 50
      let truncated = false

      while (page <= MAX_PAGES) {
        params.set('page', String(page))
        const res = await apiFetch(`/api/audit?${params.toString()}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || 'Export eșuat')
        const rows: AuditLog[] = json.logs || []
        allRows.push(...rows)
        const pg = json.pagination
        if (!pg || !pg.hasNext) break
        if (page === MAX_PAGES) truncated = true
        page++
      }

      const header = [
        'created_at',
        'user_email',
        'user_full_name',
        'action_type',
        'entity_type',
        'entity_id',
        'entity_name',
        'description',
        'ip_address',
        'user_agent',
        'old_values',
        'new_values',
      ]
      const lines = [header.join(',')]
      for (const log of allRows) {
        lines.push(
          [
            log.created_at,
            log.user?.email ?? '',
            log.user?.full_name ?? '',
            log.action_type,
            log.entity_type,
            log.entity_id ?? '',
            log.entity_name ?? '',
            log.description ?? '',
            log.ip_address ?? '',
            log.user_agent ?? '',
            log.old_values,
            log.new_values,
          ]
            .map(escapeCsvCell)
            .join(','),
        )
      }
      const csv = lines.join('\n')
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      downloadBlob(blob, `audit-${ts}.csv`)
      if (truncated) {
        showToast(`Exportul s-a oprit la ${allRows.length.toLocaleString('ro-RO')} de înregistrări — îngustează filtrele pentru un export complet.`, 'warning')
      } else {
        showToast(`Export descărcat: ${allRows.length.toLocaleString('ro-RO')} de înregistrări.`, 'success')
      }
    } catch (err: any) {
      console.error('CSV export failed:', err)
      showToast(err?.message || 'Exportul a eșuat. Reîncearcă.', 'error')
    } finally {
      setExporting(false)
    }
  }, [apiFetch, actionType, entityType, entityId, userIdFilter, fromDate, toDate, search, showToast])

  const toggleRowExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatJSON = (obj: Record<string, unknown> | null) => {
    if (!obj) return '-'
    return JSON.stringify(obj, null, 2)
  }

  const availableActionKeys = useMemo(() => {
    const fromStats = stats ? Object.keys(stats.byAction || {}) : []
    const merged = new Set<string>([
      ...Object.keys(ACTION_CONFIG),
      ...Object.keys(AUDIT_ACTION_LABELS),
      ...fromStats,
    ])
    return Array.from(merged).sort((a, b) =>
      getActionLabel(a).localeCompare(getActionLabel(b), 'ro')
    )
  }, [stats])

  const availableEntityKeys = useMemo(() => {
    const fromStats = stats ? Object.keys(stats.byEntity || {}) : []
    const merged = new Set<string>([
      ...Object.keys(ENTITY_CONFIG),
      ...Object.keys(AUDIT_ENTITY_LABELS),
      ...fromStats,
    ])
    return Array.from(merged).sort((a, b) =>
      getEntityLabel(a).localeCompare(getEntityLabel(b), 'ro')
    )
  }, [stats])

  // Restul acțiunilor, cele fără pastilă proprie — dropdown-ul nu mai repetă
  // ce acoperă deja QUICK_ACTIONS.
  const otherActionKeys = useMemo(
    () => availableActionKeys.filter(key => !QUICK_ACTIONS.some(q => q.key === key)),
    [availableActionKeys]
  )

  // Prima intrare din fiecare zi, ca să știe randarea unde pune antetul „Azi” / „Ieri” / dată.
  const dayHeaderBefore = useMemo(() => {
    const ids = new Set<string>()
    let lastKey: string | null = null
    for (const log of logs) {
      const key = dayGroupKey(log.created_at)
      if (key !== lastKey) { ids.add(log.id); lastKey = key }
    }
    return ids
  }, [logs])

  if (authLoading || (loading && logs.length === 0)) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const hasFilters = actionType || entityType || entityId || userIdFilter || fromDate || toDate || search

  const sortedUsers = [...users].sort((a, b) => {
    const an = a.full_name || a.email || ''
    const bn = b.full_name || b.email || ''
    return an.localeCompare(bn, 'ro')
  })

  const selectedUserLabel = userIdFilter
    ? users.find(u => u.id === userIdFilter)?.full_name ||
      users.find(u => u.id === userIdFilter)?.email ||
      userIdFilter
    : null

  const selectedEntityLabel = entityId ? `id: ${entityId.slice(0, 8)}…` : null

  return (
    <div className="flex flex-col gap-6 pb-10">
      <LocationStrip segments={[{ label: 'Bonie', href: '/' }, { label: 'Jurnal de audit' }]} />

      <div>
        <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Jurnal de audit</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {statsLoading || !stats
            ? 'Toate acțiunile din sistem, în ordine cronologică.'
            : `${stats.totalLogs.toLocaleString('ro-RO')} de acțiuni înregistrate, din care ${stats.recentLogs.toLocaleString('ro-RO')} în ultima săptămână. ${(stats.byAction.login || 0).toLocaleString('ro-RO')} autentificări, ${(stats.byAction.update || 0).toLocaleString('ro-RO')} modificări.`}
        </p>
      </div>

      <div className="space-y-4 rounded-[var(--radius-plate)] border border-rule bg-plate p-4 sm:p-5">
        <div className="flex min-w-0 flex-col md:flex-row md:items-center gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-0 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Caută după descriere sau entitate…"
                aria-label="Caută în jurnalul de audit"
                className="h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate pl-10 pr-4 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-10"
              />
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            </div>
            <Button type="submit" variant="primary" disabled={loading}>
              <Search className="h-4 w-4" aria-hidden="true" />
              Caută
            </Button>
          </form>

          <div className="flex w-full sm:w-auto flex-wrap items-center gap-2 shrink-0">
            <Button variant="secondary" onClick={exportCsv} disabled={exporting || loading}>
              <FileDown className="h-4 w-4" aria-hidden="true" />
              {exporting ? 'Se exportă…' : 'Export CSV'}
            </Button>

            {hasFilters && (
              <Button variant="quiet" onClick={clearFilters}>
                <X className="h-4 w-4" aria-hidden="true" />
                Resetează
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrează rapid după acțiune">
          <span className="mr-0.5 text-xs font-medium text-ink-soft">Acțiune</span>
          {QUICK_ACTIONS.map(({ key, label }) => (
            <Button
              key={key || '__all__'}
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={actionType === key}
              onClick={() => setActionType(actionType === key ? '' : key)}
              className={actionType === key ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : ''}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrează rapid după interval">
          <span className="mr-0.5 text-xs font-medium text-ink-soft">Interval</span>
          {QUICK_RANGES.map(({ key, label }) => {
            const active = detectQuickRange(fromDate, toDate) === key
            return (
              <Button
                key={key}
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={active}
                onClick={() => applyQuickRange(key)}
                className={active ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : ''}
              >
                {label}
              </Button>
            )
          })}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={customRangeOpen || detectQuickRange(fromDate, toDate) === 'custom'}
            onClick={() => setCustomRangeOpen(v => !v)}
            className={detectQuickRange(fromDate, toDate) === 'custom' ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : ''}
          >
            Interval personalizat
          </Button>
        </div>

        {(customRangeOpen || detectQuickRange(fromDate, toDate) === 'custom') && (
          <div className="grid max-w-sm grid-cols-2 gap-2">
            <DateInput value={fromDate} onChange={setFromDate} ariaLabel="De la" />
            <DateInput value={toDate} onChange={setToDate} ariaLabel="Până la" />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 items-end gap-3">
          <SelectFilter
            value={otherActionKeys.includes(actionType) ? actionType : ''}
            onChange={setActionType}
            placeholder="Altă acțiune…"
            ariaLabel="Filtrează după alte tipuri de acțiune"
            options={otherActionKeys.map(key => ({ value: key, label: getActionLabel(key) }))}
          />

          <SelectFilter
            value={entityType}
            onChange={setEntityType}
            placeholder="Toate entitățile"
            ariaLabel="Filtrează după tipul entității"
            options={availableEntityKeys.map(key => ({ value: key, label: getEntityLabel(key) }))}
          />

          <SelectFilter
            value={userIdFilter}
            onChange={setUserIdFilter}
            placeholder="Toți utilizatorii"
            ariaLabel="Filtrează după utilizator"
            options={sortedUsers.map(u => ({ value: u.id, label: u.full_name || u.email }))}
          />
        </div>

        {(selectedUserLabel || selectedEntityLabel) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {selectedUserLabel && (
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--sg-accent)]">
                Utilizator: {selectedUserLabel}
                <button onClick={() => setUserIdFilter('')} className="hover:text-[var(--sg-accent-ink)]" aria-label="Elimină filtrul utilizatorului">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {selectedEntityLabel && (
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-plate)] border border-[var(--sg-ok)] bg-[var(--sg-ok-soft)] px-3 py-1.5 text-xs font-medium text-[var(--sg-ok)]">
                Istoric entitate ({selectedEntityLabel})
                <button onClick={() => setEntityId('')} className="hover:brightness-90" aria-label="Elimină filtrul entității">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {pagination && (
        <div className="flex items-center justify-between text-sm text-ink-soft">
          <p>
            {pagination.total === 0 ? 'Nicio înregistrare găsită' : (
              <>
                Afișează <span className="font-medium text-ink">{(pagination.page - 1) * pagination.limit + 1}</span>
                {' - '}
                <span className="font-medium text-ink">{Math.min(pagination.page * pagination.limit, pagination.total)}</span>
                {' din '}
                <span className="font-medium text-ink">{pagination.total.toLocaleString()}</span>
                {' înregistrări'}
              </>
            )}
          </p>
        </div>
      )}

      {loading ? (
        <div className="rounded-[var(--radius-plate)] border border-rule bg-plate p-12 text-center">
          <Spinner size="md" className="mx-auto" />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          title="Nicio înregistrare găsită"
          action={hasFilters ? <Button variant="secondary" onClick={clearFilters}>Șterge filtrele</Button> : undefined}
        >
          {hasFilters ? 'Încearcă alte filtre sau șterge-le pe cele active.' : 'Jurnalul e gol deocamdată — orice acțiune din platformă apare aici.'}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule bg-paper-sunk">
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Ora</th>
                  <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Utilizator</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Acțiune</th>
                  <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Entitate</th>
                  <th scope="col" className="w-full px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Descriere</th>
                  <th scope="col" className="px-4 py-2.5 w-px"><span className="sr-only">Acțiuni</span></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <Fragment key={log.id}>
                    {dayHeaderBefore.has(log.id) && (
                      <tr className="border-b border-rule bg-paper-sunk">
                        <td colSpan={6} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                          {dayGroupLabel(log.created_at)}
                        </td>
                      </tr>
                    )}
                    <LogRow
                      log={log}
                      isExpanded={expandedRows.has(log.id)}
                      onToggle={() => toggleRowExpand(log.id)}
                      onViewHistory={
                        log.entity_id ? () => setEntityId(log.entity_id as string) : undefined
                      }
                      onFilterUser={
                        log.user_id && log.user_id !== userIdFilter ? () => setUserIdFilter(log.user_id as string) : undefined
                      }
                      formatTime={formatTime}
                      formatJSON={formatJSON}
                    />
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <Paginator pagination={pagination} onPageChange={fetchLogs} />
      )}

    </div>
  )
}


function DateInput({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-ink-soft">{ariaLabel}</span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-10"
      />
    </label>
  )
}

function LogRow({
  log, isExpanded, onToggle, onViewHistory, onFilterUser, formatTime, formatJSON,
}: {
  log: AuditLog
  isExpanded: boolean
  onToggle: () => void
  onViewHistory?: () => void
  onFilterUser?: () => void
  formatTime: (s: string) => string
  formatJSON: (o: Record<string, unknown> | null) => string
}) {
  const action = getActionConfig(log.action_type)
  const entity = getEntityConfig(log.entity_type)
  const ActionIcon = action.icon
  const EntityIcon = entity.icon
  const hasDetails = Boolean(log.old_values || log.new_values)
  const isSystem = !log.user_id
  const detailsId = `audit-detalii-${log.id}`

  return (
    <>
      <tr
        onClick={() => hasDetails && onToggle()}
        className={`border-b border-rule last:border-b-0 align-top transition-colors ${
          hasDetails ? 'cursor-pointer hover:bg-paper-sunk' : ''
        } ${isExpanded ? 'bg-paper-sunk' : ''}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            {hasDetails ? (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onToggle() }}
                aria-expanded={isExpanded}
                aria-controls={isExpanded ? detailsId : undefined}
                aria-label={`${isExpanded ? 'Ascunde' : 'Arată'} detaliile — ${getActionLabel(log.action_type)} · ${getEntityLabel(log.entity_type)}`}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden />
              </button>
            ) : (
              <span className="w-6 flex-shrink-0" aria-hidden />
            )}
            <span className="whitespace-nowrap tabular-nums text-ink-soft">{formatTime(log.created_at)}</span>
          </div>
        </td>

        <td className="px-4 py-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-paper-sunk text-xs font-semibold text-ink-soft">
              {(isSystem ? 'S' : (log.user?.full_name?.[0] || log.user?.email?.[0] || '?')).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{isSystem ? 'Sistem' : log.user?.full_name || 'Necunoscut'}</p>
              {!isSystem && log.user?.email && <p className="truncate text-xs text-ink-faint">{log.user.email}</p>}
            </div>
            {onFilterUser && (
              <IconButton
                label={`Filtrează jurnalul după ${log.user?.full_name || log.user?.email || 'acest utilizator'}`}
                onClick={e => { e.stopPropagation(); onFilterUser() }}
                className="!h-7 !w-7 shrink-0"
              >
                <Filter className="h-3.5 w-3.5" />
              </IconButton>
            )}
          </div>
        </td>

        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-plate)] border px-2.5 py-1 text-xs font-semibold ${action.bgColor} ${action.borderColor} ${action.color}`}
          >
            <ActionIcon className="h-3.5 w-3.5" />
            {getActionLabel(log.action_type)}
          </span>
        </td>

        <td className="px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <EntityIcon className="h-4 w-4 flex-shrink-0 text-ink-soft" aria-hidden />
            <div className="min-w-0">
              <span className="block text-sm text-ink-soft">{getEntityLabel(log.entity_type)}</span>
              {log.entity_name && (
                <span className="block truncate text-xs text-ink-faint" title={log.entity_name}>{log.entity_name}</span>
              )}
            </div>
          </div>
        </td>

        <td className="px-4 py-3">
          <p className="text-sm leading-snug text-ink">{log.description || <span className="text-ink-faint">—</span>}</p>
        </td>

        <td className="px-4 py-3">
          {onViewHistory && (
            <IconButton
              label={`Vezi istoricul — ${log.entity_name || getEntityLabel(log.entity_type)}`}
              onClick={e => { e.stopPropagation(); onViewHistory() }}
              className="!h-9 !w-9"
            >
              <History className="h-4 w-4" />
            </IconButton>
          )}
        </td>
      </tr>

      {isExpanded && hasDetails && (
        <tr id={detailsId} className="border-b border-rule bg-paper-sunk last:border-b-0">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {log.old_values && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[var(--sg-danger)]" />
                    <p className="text-xs font-semibold uppercase text-ink-soft">Valori vechi</p>
                  </div>
                  <pre className="max-h-48 overflow-auto rounded-[var(--radius-plate)] border border-rule bg-plate p-3 font-mono text-xs text-ink">
                    {formatJSON(log.old_values)}
                  </pre>
                </div>
              )}
              {log.new_values && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[var(--sg-ok)]" />
                    <p className="text-xs font-semibold uppercase text-ink-soft">Valori noi</p>
                  </div>
                  <pre className="max-h-48 overflow-auto rounded-[var(--radius-plate)] border border-rule bg-plate p-3 font-mono text-xs text-ink">
                    {formatJSON(log.new_values)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Paginator({
  pagination, onPageChange,
}: {
  pagination: Pagination
  onPageChange: (page: number) => void
}) {
  return (
    <nav aria-label="Pagini" className="flex w-full flex-wrap items-center justify-center gap-2 pt-4">
      <Button
        variant="secondary"
        onClick={() => onPageChange(pagination.page - 1)}
        disabled={!pagination.hasPrev}
        className="min-w-0 flex-1 sm:flex-none"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
      </Button>
      <div className="hidden items-center gap-1 sm:flex">
        {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
          let pageNum: number
          if (pagination.totalPages <= 5) pageNum = i + 1
          else if (pagination.page <= 3) pageNum = i + 1
          else if (pagination.page >= pagination.totalPages - 2) pageNum = pagination.totalPages - 4 + i
          else pageNum = pagination.page - 2 + i
          const isCurrent = pageNum === pagination.page
          return (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={`Pagina ${pageNum}`}
              className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius-plate)] text-sm font-medium transition-colors duration-[120ms] ${
                isCurrent
                  ? 'bg-[var(--sg-accent)] text-white'
                  : 'border border-rule text-ink-soft hover:bg-paper-sunk hover:text-ink'
              }`}
            >
              {pageNum}
            </button>
          )
        })}
      </div>
      <Button
        variant="secondary"
        onClick={() => onPageChange(pagination.page + 1)}
        disabled={!pagination.hasNext}
        className="min-w-0 flex-1 sm:flex-none"
      >
        Următor <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </nav>
  )
}
