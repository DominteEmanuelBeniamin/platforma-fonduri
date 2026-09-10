/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { downloadBlob } from '@/lib/file-preview'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { useAuth } from '@/app/providers/AuthProvider'
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
  Globe,
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
  FileDown,
  Shield,
  LogIn,
  Activity,
} from 'lucide-react'
import SelectFilter from '@/components/SelectFilter'
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@/lib/audit-catalog'
import { Spinner } from '@/components/ui/Spinner'

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

export default function AuditPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()

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

      while (page <= MAX_PAGES) {
        params.set('page', String(page))
        const res = await apiFetch(`/api/audit?${params.toString()}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || 'Export esuat')
        const rows: AuditLog[] = json.logs || []
        allRows.push(...rows)
        const pg = json.pagination
        if (!pg || !pg.hasNext) break
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
    } catch (err) {
      console.error('CSV export failed:', err)
    } finally {
      setExporting(false)
    }
  }, [apiFetch, actionType, entityType, entityId, userIdFilter, fromDate, toDate, search])

  const toggleRowExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
                placeholder="Caută după descriere sau entitate..."
                className="w-full pl-10 pr-4 py-2.5 border border-rule rounded-lg focus:ring-2 focus:ring-[var(--sg-accent)] focus:border-[var(--sg-accent)] text-sm"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2.5 text-sm font-medium text-white bg-[var(--sg-accent)] hover:bg-[var(--sg-accent-ink)] rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
            >
              <Search className="w-4 h-4" />
              Caută
            </button>
          </form>

          <div className="flex w-full sm:w-auto flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={exportCsv}
              disabled={exporting || loading}
              className="px-4 py-2.5 text-sm font-medium text-ink bg-white hover:bg-paper-sunk border border-rule rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
            >
              <FileDown className="w-4 h-4" />
              {exporting ? 'Se exportă…' : 'Export CSV'}
            </button>

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="px-3 py-2.5 text-sm font-medium text-ink-soft hover:text-ink hover:bg-paper-sunk rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
                title="Resetează filtrele"
              >
                <X className="w-4 h-4" />
                Resetează
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 items-end gap-3">
          <SelectFilter
            value={actionType}
            onChange={setActionType}
            placeholder="Toate acțiunile"
            options={availableActionKeys.map(key => ({ value: key, label: getActionLabel(key) }))}
          />

          <SelectFilter
            value={entityType}
            onChange={setEntityType}
            placeholder="Toate entitățile"
            options={availableEntityKeys.map(key => ({ value: key, label: getEntityLabel(key) }))}
          />

          <SelectFilter
            value={userIdFilter}
            onChange={setUserIdFilter}
            placeholder="Toți utilizatorii"
            options={sortedUsers.map(u => ({ value: u.id, label: u.full_name || u.email }))}
            className="sm:col-span-2 xl:col-span-1"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 sm:col-span-2 xl:col-span-2 gap-2 min-w-0">
            <DateInput value={fromDate} onChange={setFromDate} ariaLabel="De la" />
            <DateInput value={toDate} onChange={setToDate} ariaLabel="Până la" />
          </div>
        </div>

        {(selectedUserLabel || selectedEntityLabel) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {selectedUserLabel && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--sg-accent-soft)] text-[var(--sg-accent)] border border-[var(--sg-accent)]">
                Utilizator: {selectedUserLabel}
                <button onClick={() => setUserIdFilter('')} className="hover:text-[var(--sg-accent)]" aria-label="Elimină filtrul utilizatorului">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedEntityLabel && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--sg-ok-soft)] text-[var(--sg-ok)] border border-[var(--sg-ok)]">
                Istoric entitate ({selectedEntityLabel})
                <button onClick={() => setEntityId('')} className="hover:text-[var(--sg-ok)]" aria-label="Elimină filtrul entității">
                  <X className="w-3 h-3" />
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
        <div className="bg-white rounded-xl border border-rule shadow-sm p-12 text-center">
          <Spinner size="md" className="mx-auto" />
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl border border-rule shadow-sm p-12 text-center text-ink-soft">
          <FileText className="w-12 h-12 mx-auto mb-3 text-ink-faint" />
          <p className="font-medium">Nicio înregistrare găsită</p>
          <p className="text-sm mt-1">Încearcă să modifici filtrele selectate.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule bg-paper-sunk">
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Dată</th>
                  <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Utilizator</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Acțiune</th>
                  <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Entitate</th>
                  <th scope="col" className="w-full px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Descriere</th>
                  <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft lg:table-cell">IP</th>
                  <th scope="col" className="px-4 py-2.5 w-px"><span className="sr-only">Acțiuni</span></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <LogRow
                    key={log.id}
                    log={log}
                    isExpanded={expandedRows.has(log.id)}
                    onToggle={() => toggleRowExpand(log.id)}
                    onViewHistory={
                      log.entity_id ? () => setEntityId(log.entity_id as string) : undefined
                    }
                    formatDate={formatDate}
                    formatJSON={formatJSON}
                  />
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
        className="w-full px-3 py-2.5 border border-rule rounded-lg focus:ring-2 focus:ring-[var(--sg-accent)] focus:border-[var(--sg-accent)] text-sm"
      />
    </label>
  )
}

function LogRow({
  log, isExpanded, onToggle, onViewHistory, formatDate, formatJSON,
}: {
  log: AuditLog
  isExpanded: boolean
  onToggle: () => void
  onViewHistory?: () => void
  formatDate: (s: string) => string
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
            <span className="whitespace-nowrap text-ink-soft">{formatDate(log.created_at)}</span>
          </div>
        </td>

        <td className="px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-paper-sunk text-xs font-semibold text-ink-soft">
              {(isSystem ? 'S' : (log.user?.full_name?.[0] || log.user?.email?.[0] || '?')).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{isSystem ? 'Sistem' : log.user?.full_name || 'Necunoscut'}</p>
              {!isSystem && log.user?.email && <p className="truncate text-xs text-ink-faint">{log.user.email}</p>}
            </div>
          </div>
        </td>

        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-semibold ${action.bgColor} ${action.borderColor} ${action.color}`}
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

        <td className="hidden px-4 py-3 lg:table-cell">
          {log.ip_address && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-paper-sunk px-2 py-1 font-mono text-xs text-ink-faint">
              <Globe className="h-3 w-3" aria-hidden />
              {log.ip_address}
            </span>
          )}
        </td>

        <td className="px-4 py-3">
          {onViewHistory && (
            <button
              onClick={e => { e.stopPropagation(); onViewHistory() }}
              title="Vezi istoricul acestei entități"
              className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)]"
            >
              <History className="h-4 w-4" />
            </button>
          )}
        </td>
      </tr>

      {isExpanded && hasDetails && (
        <tr id={detailsId} className="border-b border-rule bg-paper-sunk last:border-b-0">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {log.old_values && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[var(--sg-danger)]" />
                    <p className="text-xs font-semibold uppercase text-ink-soft">Valori vechi</p>
                  </div>
                  <pre className="max-h-48 overflow-auto rounded-lg border border-rule bg-white p-3 font-mono text-xs text-ink">
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
                  <pre className="max-h-48 overflow-auto rounded-lg border border-rule bg-white p-3 font-mono text-xs text-ink">
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
    <div className="flex w-full flex-wrap items-center justify-center gap-2 pt-4">
      <button
        onClick={() => onPageChange(pagination.page - 1)}
        disabled={!pagination.hasPrev}
        className="flex-1 min-w-0 justify-center px-4 py-2 text-center text-sm font-medium text-ink-soft hover:text-ink hover:bg-white rounded-lg border border-rule disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:flex-none"
      >
        ← Anterior
      </button>
      <div className="hidden items-center gap-1 sm:flex">
        {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
          let pageNum: number
          if (pagination.totalPages <= 5) pageNum = i + 1
          else if (pagination.page <= 3) pageNum = i + 1
          else if (pagination.page >= pagination.totalPages - 2) pageNum = pagination.totalPages - 4 + i
          else pageNum = pagination.page - 2 + i
          return (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                pageNum === pagination.page
                  ? 'bg-[var(--sg-accent)] text-white shadow-sm'
                  : 'text-ink-soft hover:bg-white hover:text-ink border border-rule'
              }`}
            >
              {pageNum}
            </button>
          )
        })}
      </div>
      <button
        onClick={() => onPageChange(pagination.page + 1)}
        disabled={!pagination.hasNext}
        className="flex-1 min-w-0 justify-center px-4 py-2 text-center text-sm font-medium text-ink-soft hover:text-ink hover:bg-white rounded-lg border border-rule disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:flex-none"
      >
        Următor →
      </button>
    </div>
  )
}
