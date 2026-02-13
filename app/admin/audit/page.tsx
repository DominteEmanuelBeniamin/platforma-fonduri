/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useCallback } from 'react'
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
  Globe
} from 'lucide-react'

interface AuditLog {
  id: string
  user_id: string | null
  action_type: 'login' | 'logout' | 'create' | 'update' | 'delete'
  entity_type: 'user' | 'project' | 'document' | 'phase' | 'activity'
  entity_id: string | null
  entity_name: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  description: string | null
  ip_address: string | null
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

const ACTION_CONFIG: Record<string, { label: string; color: string; bgColor: string; borderColor: string; icon: React.ElementType }> = {
  login: { label: 'Autentificare', color: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200', icon: LogIn },
  logout: { label: 'Deconectare', color: 'text-slate-600', bgColor: 'bg-slate-100', borderColor: 'border-slate-200', icon: LogOut },
  create: { label: 'Creare', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200', icon: Plus },
  update: { label: 'Modificare', color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', icon: Pencil },
  delete: { label: 'Ștergere', color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200', icon: Trash2 }
}

const ENTITY_CONFIG: Record<string, { label: string; icon: React.ElementType }> = {
  user: { label: 'Utilizator', icon: User },
  project: { label: 'Proiect', icon: FolderKanban },
  document: { label: 'Document', icon: FileText },
  phase: { label: 'Fază', icon: Layers },
  activity: { label: 'Activitate', icon: Zap }
}

export default function AuditPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)

  // Filtre
  const [actionType, setActionType] = useState<string>('')
  const [entityType, setEntityType] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [searchInput, setSearchInput] = useState<string>('')

  // Expanded rows pentru a vedea detalii
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true)
      const res = await apiFetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stats' })
      })
      const json = await res.json()
      if (res.ok) {
        setStats(json)
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setStatsLoading(false)
    }
  }, [apiFetch])

  const fetchLogs = useCallback(async (page = 1) => {
    try {
      setLoading(true)
      
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '30')
      
      if (actionType) params.set('action_type', actionType)
      if (entityType) params.set('entity_type', entityType)
      if (fromDate) params.set('from_date', fromDate)
      if (toDate) params.set('to_date', toDate)
      if (search) params.set('search', search)

      const res = await apiFetch(`/api/audit?${params.toString()}`)
      const json = await res.json()
      
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to fetch audit logs')
      }

      setLogs(json.logs || [])
      setPagination(json.pagination || null)
    } catch (err: any) {
      console.error('Failed to fetch logs:', err)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, actionType, entityType, fromDate, toDate, search])

  // Initial load
  useEffect(() => {
    if (authLoading) return
    
    if (!token) {
      router.push('/login')
      return
    }

    // Verificăm dacă e admin
    if (profile && profile.role !== 'admin') {
      router.push('/')
      return
    }

    fetchStats()
    fetchLogs(1)
  }, [authLoading, token, profile, router, fetchStats, fetchLogs])

  // Refetch când se schimbă filtrele
  useEffect(() => {
    if (!authLoading && token && profile?.role === 'admin') {
      fetchLogs(1)
    }
  }, [actionType, entityType, fromDate, toDate, search])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  const clearFilters = () => {
    setActionType('')
    setEntityType('')
    setFromDate('')
    setToDate('')
    setSearch('')
    setSearchInput('')
  }

  const toggleRowExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
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
      minute: '2-digit'
    })
  }

  const formatJSON = (obj: Record<string, unknown> | null) => {
    if (!obj) return '-'
    return JSON.stringify(obj, null, 2)
  }

  if (authLoading || (loading && logs.length === 0)) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    )
  }

  const hasFilters = actionType || entityType || fromDate || toDate || search

  return (
    <div className="flex flex-col gap-8 fade-in-up pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/60">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Administrare</p>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">Jurnal de Audit</h1>
          <p className="text-slate-500 mt-1">Toate acțiunile din sistem, în ordine cronologică.</p>
        </div>
      </div>

      {/* Stats Cards */}
      {!statsLoading && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center">
              <Shield className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase">Total Înregistrări</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5">{stats.totalLogs.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase">Ultima Săptămână</p>
              <p className="text-2xl font-bold text-indigo-600 mt-0.5">{stats.recentLogs.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center">
              <LogIn className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase">Autentificări</p>
              <p className="text-2xl font-bold text-emerald-600 mt-0.5">{(stats.byAction.login || 0).toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center">
              <Activity className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase">Modificări</p>
              <p className="text-2xl font-bold text-amber-600 mt-0.5">{(stats.byAction.update || 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Caută după descriere sau entitate..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
          </form>

          {/* Action Type Filter */}
          <div className="relative min-w-[180px]">
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full appearance-none px-4 py-2.5 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white"
            >
              <option value="">Toate acțiunile</option>
              <option value="login">Autentificare</option>
              <option value="logout">Deconectare</option>
              <option value="create">Creare</option>
              <option value="update">Modificare</option>
              <option value="delete">Ștergere</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>

          {/* Entity Type Filter */}
          <div className="relative min-w-[180px]">
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full appearance-none px-4 py-2.5 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white"
            >
              <option value="">Toate entitățile</option>
              <option value="user">Utilizator</option>
              <option value="project">Proiect</option>
              <option value="document">Document</option>
              <option value="phase">Fază</option>
              <option value="activity">Activitate</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            <span className="text-slate-400">→</span>
            <div className="relative">
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Clear Filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Resetează
            </button>
          )}
        </div>
      </div>

      {/* Results Info */}
      {pagination && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>
            {pagination.total === 0 ? 'Nicio înregistrare găsită' : (
              <>
                Afișează <span className="font-medium text-slate-700">{((pagination.page - 1) * pagination.limit) + 1}</span>
                {' - '}
                <span className="font-medium text-slate-700">{Math.min(pagination.page * pagination.limit, pagination.total)}</span>
                {' din '}
                <span className="font-medium text-slate-700">{pagination.total.toLocaleString()}</span>
                {' înregistrări'}
              </>
            )}
          </p>
        </div>
      )}

      {/* Audit Log - Card Layout */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
            <div className="w-8 h-8 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin mx-auto"></div>
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center text-slate-500">
            <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-medium">Nicio înregistrare găsită</p>
            <p className="text-sm mt-1">Încearcă să modifici filtrele selectate.</p>
          </div>
        ) : (
          logs.map((log) => {
            const action = ACTION_CONFIG[log.action_type] || { label: log.action_type, color: 'text-slate-600', bgColor: 'bg-slate-100', borderColor: 'border-slate-200', icon: Activity }
            const entity = ENTITY_CONFIG[log.entity_type] || { label: log.entity_type, icon: FileText }
            const ActionIcon = action.icon
            const EntityIcon = entity.icon
            const isExpanded = expandedRows.has(log.id)
            const hasDetails = log.old_values || log.new_values

            return (
              <div 
                key={log.id} 
                className={`bg-white rounded-xl border shadow-sm transition-all ${
                  isExpanded ? 'border-indigo-200 shadow-md' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Main Row */}
                <div className="p-4">
                  {/* Top Row: Date, User, Action, Entity */}
                  <div className="flex flex-wrap items-center gap-4 mb-3">
                    {/* Date */}
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(log.created_at)}</span>
                    </div>

                    {/* User */}
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
                        {(log.user?.full_name?.[0] || log.user?.email?.[0] || '?').toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {log.user?.full_name || 'Necunoscut'}
                        </p>
                      </div>
                    </div>

                    {/* Action Badge */}
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${action.bgColor} ${action.borderColor} ${action.color}`}>
                      <ActionIcon className="w-3.5 h-3.5" />
                      {action.label}
                    </span>

                    {/* Entity */}
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                        <EntityIcon className="w-4 h-4 text-slate-500" />
                      </div>
                      <div>
                        <span className="text-sm text-slate-600">{entity.label}</span>
                        {log.entity_name && (
                          <span className="text-sm text-slate-400 ml-1">• {log.entity_name}</span>
                        )}
                      </div>
                    </div>

                    {/* IP Address - Right aligned */}
                    {log.ip_address && (
                      <div className="ml-auto hidden lg:flex items-center gap-1.5 text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded">
                        <Globe className="w-3 h-3" />
                        {log.ip_address}
                      </div>
                    )}
                  </div>

                  {/* Description Row */}
                  {log.description && (
                    <div className="flex items-start gap-3 pt-3 border-t border-slate-100">
                      <div className="flex-1">
                        <p className="text-sm text-slate-700 leading-relaxed">
                          {log.description}
                        </p>
                      </div>

                      {/* Expand Button */}
                      {hasDetails && (
                        <button
                          onClick={() => toggleRowExpand(log.id)}
                          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            isExpanded 
                              ? 'bg-indigo-100 text-indigo-700' 
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {isExpanded ? 'Ascunde' : 'Detalii'}
                          <ChevronDown 
                            className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                          />
                        </button>
                      )}
                    </div>
                  )}

                  {/* No description but has details */}
                  {!log.description && hasDetails && (
                    <div className="flex justify-end pt-3 border-t border-slate-100">
                      <button
                        onClick={() => toggleRowExpand(log.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          isExpanded 
                            ? 'bg-indigo-100 text-indigo-700' 
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {isExpanded ? 'Ascunde detalii' : 'Vezi detalii'}
                        <ChevronDown 
                          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                        />
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded Details */}
                {isExpanded && hasDetails && (
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl">
                      {log.old_values && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 rounded-full bg-red-400"></div>
                            <p className="text-xs font-semibold text-slate-600 uppercase">Valori Vechi</p>
                          </div>
                          <pre className="text-xs bg-white text-slate-700 p-3 rounded-lg overflow-auto max-h-48 border border-slate-200 font-mono">
                            {formatJSON(log.old_values)}
                          </pre>
                        </div>
                      )}
                      {log.new_values && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                            <p className="text-xs font-semibold text-slate-600 uppercase">Valori Noi</p>
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
          })
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => fetchLogs(pagination.page - 1)}
            disabled={!pagination.hasPrev}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            ← Anterior
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
              let pageNum: number
              if (pagination.totalPages <= 5) {
                pageNum = i + 1
              } else if (pagination.page <= 3) {
                pageNum = i + 1
              } else if (pagination.page >= pagination.totalPages - 2) {
                pageNum = pagination.totalPages - 4 + i
              } else {
                pageNum = pagination.page - 2 + i
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => fetchLogs(pageNum)}
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
            onClick={() => fetchLogs(pagination.page + 1)}
            disabled={!pagination.hasNext}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Următor →
          </button>
        </div>
      )}
    </div>
  )
}