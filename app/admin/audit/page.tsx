/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import {
  LogIn,
  LogOut,
  Plus,
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
  Calendar,
  Activity,
  Clock,
  Shield,
  Globe,
  Download,
  Users,
  Briefcase,
  MessageSquare,
  Lock,
  CheckSquare,
  ListOrdered,
  HardDrive,
  AlertTriangle,
  History,
  FileDown,
} from 'lucide-react'

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

type EntityConfig = { label: string; icon: React.ElementType }
type ActionConfig = {
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon: React.ElementType
}

const ACTION_CONFIG: Record<string, ActionConfig> = {
  login: { label: 'Autentificare', color: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200', icon: LogIn },
  logout: { label: 'Deconectare', color: 'text-slate-600', bgColor: 'bg-slate-100', borderColor: 'border-slate-200', icon: LogOut },
  create: { label: 'Creare', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200', icon: Plus },
  update: { label: 'Modificare', color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', icon: Pencil },
  delete: { label: 'Stergere', color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200', icon: Trash2 },
  download: { label: 'Descarcare', color: 'text-violet-700', bgColor: 'bg-violet-50', borderColor: 'border-violet-200', icon: Download },
}

const DEFAULT_ACTION: ActionConfig = {
  label: '',
  color: 'text-slate-600',
  bgColor: 'bg-slate-100',
  borderColor: 'border-slate-200',
  icon: Activity,
}

const ENTITY_CONFIG: Record<string, EntityConfig> = {
  user: { label: 'Utilizator', icon: User },
  project: { label: 'Proiect', icon: FolderKanban },
  document: { label: 'Document', icon: FileText },
  phase: { label: 'Faza', icon: Layers },
  activity: { label: 'Activitate', icon: Zap },
  chat_message: { label: 'Mesaj chat', icon: MessageSquare },
  template: { label: 'Sablon', icon: Briefcase },
  template_phase: { label: 'Faza sablon', icon: Layers },
  template_activity: { label: 'Activitate sablon', icon: Zap },
  template_document: { label: 'Document sablon', icon: FileText },
  status: { label: 'Status', icon: CheckSquare },
  status_reorder: { label: 'Reordonare status', icon: ListOrdered },
  project_phase: { label: 'Faza proiect', icon: Layers },
  project_activity: { label: 'Activitate proiect', icon: Zap },
  project_member: { label: 'Membru proiect', icon: Users },
  client: { label: 'Client', icon: Briefcase },
  private_conversation: { label: 'Conversatie privata', icon: Lock },
  private_message: { label: 'Mesaj privat', icon: Lock },
  file_access: { label: 'Acces fisier', icon: HardDrive },
  audit_log: { label: 'Jurnal audit', icon: Shield },
}

const DEFAULT_ENTITY: EntityConfig = { label: '', icon: FileText }

const getActionConfig = (key: string): ActionConfig =>
  ACTION_CONFIG[key] ?? { ...DEFAULT_ACTION, label: key }
const getEntityConfig = (key: string): EntityConfig =>
  ENTITY_CONFIG[key] ?? { ...DEFAULT_ENTITY, label: key }

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
  const [deleteTarget, setDeleteTarget] = useState<AuditLog | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
    if (profile && profile.role !== 'admin') {
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
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      a.download = `audit-${ts}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
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

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      setDeleteError(null)
      const res = await apiFetch(`/api/audit/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || 'Stergerea a esuat')
      }
      setDeleteTarget(null)
      await Promise.all([fetchStats(), fetchLogs(pagination?.page ?? 1)])
    } catch (err: any) {
      setDeleteError(err?.message || 'Stergerea a esuat')
    } finally {
      setDeleting(false)
    }
  }

  const availableEntityKeys = useMemo(() => {
    const fromStats = stats ? Object.keys(stats.byEntity || {}) : []
    const merged = new Set<string>([...Object.keys(ENTITY_CONFIG), ...fromStats])
    return Array.from(merged).sort((a, b) =>
      getEntityConfig(a).label.localeCompare(getEntityConfig(b).label, 'ro')
    )
  }, [stats])

  if (authLoading || (loading && logs.length === 0)) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin" />
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
    <div className="flex flex-col gap-8 fade-in-up pb-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/60">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Administrare</p>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">Jurnal de Audit</h1>
          <p className="text-slate-500 mt-1">Toate actiunile din sistem, in ordine cronologica.</p>
        </div>
      </div>

      {!statsLoading && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Shield} iconBg="bg-slate-100" iconColor="text-slate-600" label="Total inregistrari" value={stats.totalLogs} valueColor="text-slate-900" />
          <StatCard icon={Clock} iconBg="bg-indigo-50" iconColor="text-indigo-600" label="Ultima saptamana" value={stats.recentLogs} valueColor="text-indigo-600" />
          <StatCard icon={LogIn} iconBg="bg-emerald-50" iconColor="text-emerald-600" label="Autentificari" value={stats.byAction.login || 0} valueColor="text-emerald-600" />
          <StatCard icon={Activity} iconBg="bg-amber-50" iconColor="text-amber-600" label="Modificari" value={stats.byAction.update || 0} valueColor="text-amber-600" />
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Cauta dupa descriere sau entitate..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
          </form>

          <SelectFilter value={actionType} onChange={setActionType} placeholder="Toate actiunile">
            {Object.entries(ACTION_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </SelectFilter>

          <SelectFilter value={entityType} onChange={setEntityType} placeholder="Toate entitatile">
            {availableEntityKeys.map(key => (
              <option key={key} value={key}>{getEntityConfig(key).label || key}</option>
            ))}
          </SelectFilter>

          <SelectFilter value={userIdFilter} onChange={setUserIdFilter} placeholder="Toti utilizatorii">
            {sortedUsers.map(u => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email}
              </option>
            ))}
          </SelectFilter>

          <div className="flex items-center gap-2">
            <DateInput value={fromDate} onChange={setFromDate} />
            <span className="text-slate-400">→</span>
            <DateInput value={toDate} onChange={setToDate} />
          </div>

          <button
            onClick={exportCsv}
            disabled={exporting || loading}
            className="px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <FileDown className="w-4 h-4" />
            {exporting ? 'Se exporta…' : 'Export CSV'}
          </button>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Reseteaza
            </button>
          )}
        </div>

        {(selectedUserLabel || selectedEntityLabel) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedUserLabel && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                Utilizator: {selectedUserLabel}
                <button onClick={() => setUserIdFilter('')} className="hover:text-indigo-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedEntityLabel && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                Istoric entitate ({selectedEntityLabel})
                <button onClick={() => setEntityId('')} className="hover:text-emerald-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {pagination && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>
            {pagination.total === 0 ? 'Nicio inregistrare gasita' : (
              <>
                Afiseaza <span className="font-medium text-slate-700">{(pagination.page - 1) * pagination.limit + 1}</span>
                {' - '}
                <span className="font-medium text-slate-700">{Math.min(pagination.page * pagination.limit, pagination.total)}</span>
                {' din '}
                <span className="font-medium text-slate-700">{pagination.total.toLocaleString()}</span>
                {' inregistrari'}
              </>
            )}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
            <div className="w-8 h-8 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin mx-auto" />
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center text-slate-500">
            <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-medium">Nicio inregistrare gasita</p>
            <p className="text-sm mt-1">Incearca sa modifici filtrele selectate.</p>
          </div>
        ) : (
          logs.map(log => (
            <LogRow
              key={log.id}
              log={log}
              isExpanded={expandedRows.has(log.id)}
              onToggle={() => toggleRowExpand(log.id)}
              onDelete={() => setDeleteTarget(log)}
              onViewHistory={
                log.entity_id ? () => setEntityId(log.entity_id as string) : undefined
              }
              formatDate={formatDate}
              formatJSON={formatJSON}
            />
          ))
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <Paginator pagination={pagination} onPageChange={fetchLogs} />
      )}

      {deleteTarget && (
        <DeleteModal
          log={deleteTarget}
          deleting={deleting}
          error={deleteError}
          onCancel={() => {
            setDeleteTarget(null)
            setDeleteError(null)
          }}
          onConfirm={confirmDelete}
          formatDate={formatDate}
        />
      )}
    </div>
  )
}

function StatCard({
  icon: Icon, iconBg, iconColor, label, value, valueColor,
}: {
  icon: React.ElementType
  iconBg: string
  iconColor: string
  label: string
  value: number
  valueColor: string
}) {
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div>
        <p className="text-xs text-slate-500 font-medium uppercase">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${valueColor}`}>{value.toLocaleString()}</p>
      </div>
    </div>
  )
}

function SelectFilter({
  value, onChange, placeholder, children,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  children: React.ReactNode
}) {
  return (
    <div className="relative min-w-[180px]">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none px-4 py-2.5 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white"
      >
        <option value="">{placeholder}</option>
        {children}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
  )
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
      />
      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
  )
}

function LogRow({
  log, isExpanded, onToggle, onDelete, onViewHistory, formatDate, formatJSON,
}: {
  log: AuditLog
  isExpanded: boolean
  onToggle: () => void
  onDelete: () => void
  onViewHistory?: () => void
  formatDate: (s: string) => string
  formatJSON: (o: Record<string, unknown> | null) => string
}) {
  const action = getActionConfig(log.action_type)
  const entity = getEntityConfig(log.entity_type)
  const ActionIcon = action.icon
  const EntityIcon = entity.icon
  const hasDetails = log.old_values || log.new_values

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm transition-all ${
        isExpanded ? 'border-indigo-200 shadow-md' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-4 mb-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Calendar className="w-4 h-4" />
            <span>{formatDate(log.created_at)}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
              {(log.user?.full_name?.[0] || log.user?.email?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">{log.user?.full_name || 'Necunoscut'}</p>
              {log.user?.email && <p className="text-xs text-slate-400">{log.user.email}</p>}
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${action.bgColor} ${action.borderColor} ${action.color}`}
          >
            <ActionIcon className="w-3.5 h-3.5" />
            {action.label || log.action_type}
          </span>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <EntityIcon className="w-4 h-4 text-slate-500" />
            </div>
            <div>
              <span className="text-sm text-slate-600">{entity.label || log.entity_type}</span>
              {log.entity_name && (
                <span className="text-sm text-slate-400 ml-1">• {log.entity_name}</span>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {log.ip_address && (
              <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded">
                <Globe className="w-3 h-3" />
                {log.ip_address}
              </div>
            )}
            {onViewHistory && (
              <button
                onClick={onViewHistory}
                title="Vezi istoric pe aceasta entitate"
                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                <History className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onDelete}
              title="Sterge intrarea de audit"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {log.description && (
          <div className="flex items-start gap-3 pt-3 border-t border-slate-100">
            <div className="flex-1">
              <p className="text-sm text-slate-700 leading-relaxed">{log.description}</p>
            </div>
            {hasDetails && (
              <button
                onClick={onToggle}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isExpanded ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {isExpanded ? 'Ascunde' : 'Detalii'}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        )}

        {!log.description && hasDetails && (
          <div className="flex justify-end pt-3 border-t border-slate-100">
            <button
              onClick={onToggle}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isExpanded ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {isExpanded ? 'Ascunde detalii' : 'Vezi detalii'}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {isExpanded && hasDetails && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl">
            {log.old_values && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <p className="text-xs font-semibold text-slate-600 uppercase">Valori vechi</p>
                </div>
                <pre className="text-xs bg-white text-slate-700 p-3 rounded-lg overflow-auto max-h-48 border border-slate-200 font-mono">
                  {formatJSON(log.old_values)}
                </pre>
              </div>
            )}
            {log.new_values && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <p className="text-xs font-semibold text-slate-600 uppercase">Valori noi</p>
                </div>
                <pre className="text-xs bg-white text-slate-700 p-3 rounded-lg overflow-auto max-h-48 border border-slate-200 font-mono">
                  {formatJSON(log.new_values)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Paginator({
  pagination, onPageChange,
}: {
  pagination: Pagination
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <button
        onClick={() => onPageChange(pagination.page - 1)}
        disabled={!pagination.hasPrev}
        className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        ← Anterior
      </button>
      <div className="flex items-center gap-1">
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
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900 border border-slate-200'
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
        className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Urmator →
      </button>
    </div>
  )
}

function DeleteModal({
  log, deleting, error, onCancel, onConfirm, formatDate,
}: {
  log: AuditLog
  deleting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
  formatDate: (s: string) => string
}) {
  const action = getActionConfig(log.action_type)
  const entity = getEntityConfig(log.entity_type)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-start gap-4 p-6 border-b border-slate-100">
          <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-900">Sterge intrarea de audit?</h2>
            <p className="text-sm text-slate-500 mt-1">
              Aceasta actiune va elimina intrarea, dar va crea o noua intrare in jurnal care inregistreaza stergerea (cu snapshot complet).
            </p>
          </div>
        </div>

        <div className="p-6 space-y-3">
          <div className="bg-slate-50 rounded-xl p-4 space-y-2 border border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(log.created_at)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold border ${action.bgColor} ${action.borderColor} ${action.color}`}
              >
                {action.label || log.action_type}
              </span>
              <span className="text-xs text-slate-600">{entity.label || log.entity_type}</span>
              {log.entity_name && (
                <span className="text-xs text-slate-400">• {log.entity_name}</span>
              )}
            </div>
            {log.description && (
              <p className="text-sm text-slate-700 pt-1">{log.description}</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 bg-slate-50 border-t border-slate-100">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
          >
            Anuleaza
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {deleting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Se sterge...
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                Sterge intrarea
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
