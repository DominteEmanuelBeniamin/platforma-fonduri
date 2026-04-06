/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  X, FolderOpen, FileText, FileSpreadsheet,
  Image as ImageIcon, File, CheckCircle2, XCircle,
  Clock, Eye, Download, Layers, Building2, Briefcase,
  Shield, Search, Filter, ChevronDown, ArrowUpDown,
  Calendar, Loader2, AlertCircle, ExternalLink,
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserDrawerUser {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'consultant' | 'client'
  created_at: string
  cif?: string | null
  specializare?: string | null
  departament?: string | null
}

interface UserDrawerProps {
  user: UserDrawerUser | null
  open: boolean
  onClose: () => void
}

type SortKey = 'name' | 'status' | 'date' | 'project'
type SortDir = 'asc' | 'desc'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ext(path: string) {
  const p = path.split('.')
  return p.length > 1 ? p[p.length - 1].toLowerCase() : ''
}

function FileIconBig({ path }: { path: string }) {
  const e = ext(path)
  const base = 'w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(e))
    return <div className={`${base} bg-violet-100 text-violet-600`}><ImageIcon className="w-4 h-4" /></div>
  if (['xls', 'xlsx', 'csv'].includes(e))
    return <div className={`${base} bg-emerald-100 text-emerald-600`}><FileSpreadsheet className="w-4 h-4" /></div>
  if (e === 'pdf')
    return <div className={`${base} bg-red-100 text-red-600`}><FileText className="w-4 h-4" /></div>
  if (['doc', 'docx'].includes(e))
    return <div className={`${base} bg-blue-100 text-blue-600`}><FileText className="w-4 h-4" /></div>
  return <div className={`${base} bg-slate-100 text-slate-500`}><File className="w-4 h-4" /></div>
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: any; label: string; cls: string }> = {
    approved: { icon: CheckCircle2, label: 'Aprobat',    cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    rejected: { icon: XCircle,      label: 'Respins',    cls: 'bg-red-50 text-red-700 ring-red-200' },
    review:   { icon: Eye,          label: 'Verificare', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
    pending:  { icon: Clock,        label: 'Așteptare',  cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  }
  const cfg = map[status] ?? map.pending
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 whitespace-nowrap ${cfg.cls}`}>
      <cfg.icon className="w-3 h-3 flex-shrink-0" />{cfg.label}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  if (role === 'admin')
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200"><Shield className="w-3 h-3" />Administrator</span>
  if (role === 'consultant')
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 ring-1 ring-purple-200"><Briefcase className="w-3 h-3" />Consultant</span>
  return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"><Building2 className="w-3 h-3" />Client</span>
}

function fileName(path: string) {
  return path.split('/').pop()?.replace(/^\d+_/, '') ?? path
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UserDrawer({ user, open, onClose }: UserDrawerProps) {
  const { apiFetch } = useAuth()
  const router = useRouter()

  const [allDocs, setAllDocs] = useState<any[]>([])   // flat list of all doc requests
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterProject, setFilterProject] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [downloading, setDownloading] = useState<string | null>(null)

  // Reset & load when drawer opens
  useEffect(() => {
    if (!open || !user) return
    setAllDocs([])
    setSearch('')
    setFilterStatus('all')
    setFilterProject('all')
    loadAll()
  }, [open, user?.id])

  async function loadAll() {
    if (!user) return
    setLoading(true)
    try {
      // 1. Get all projects for this user
      const projRes = await apiFetch('/api/projects')
      if (!projRes.ok) return
      const { projects: allProjects } = await projRes.json()

      let projects: any[] = []
      if (user.role === 'client') {
        projects = allProjects.filter((p: any) => p.client_id === user.id)
      } else {
        projects = allProjects
      }

      // 2. Fetch docs for all projects in parallel
      const results = await Promise.all(
        projects.map(async (p: any) => {
          const res = await apiFetch(`/api/projects/${p.id}/document-requests`)
          if (!res.ok) return []
          const { requests } = await res.json()
          return (requests ?? []).map((req: any) => ({
            ...req,
            _projectId: p.id,
            _projectTitle: p.title,
            _projectCodIntern: p.cod_intern,
          }))
        })
      )

      setAllDocs(results.flat())
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload(fileId: string) {
    setDownloading(fileId)
    try {
      const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
        method: 'POST',
        body: JSON.stringify({ expiresIn: 300 }),
      })
      if (!res.ok) { alert('Eroare la descărcare'); return }
      const { url } = await res.json()
      const a = document.createElement('a')
      a.href = url; a.target = '_blank'; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    } finally {
      setDownloading(null)
    }
  }

  // Unique projects for filter dropdown
  const uniqueProjects = useMemo(() => {
    const seen = new Map<string, string>()
    allDocs.forEach(d => {
      if (d._projectId) seen.set(d._projectId, d._projectTitle)
    })
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }))
  }, [allDocs])

  // Filter
  const filtered = useMemo(() => {
    return allDocs.filter(d => {
      if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false
      if (filterStatus !== 'all' && d.status !== filterStatus) return false
      if (filterProject !== 'all' && d._projectId !== filterProject) return false
      return true
    })
  }, [allDocs, search, filterStatus, filterProject])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name')    cmp = a.name.localeCompare(b.name)
      if (sortKey === 'status')  cmp = a.status.localeCompare(b.status)
      if (sortKey === 'date')    cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (sortKey === 'project') cmp = (a._projectTitle ?? '').localeCompare(b._projectTitle ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Stats
  const stats = useMemo(() => ({
    total:    allDocs.length,
    approved: allDocs.filter(d => d.status === 'approved').length,
    review:   allDocs.filter(d => d.status === 'review').length,
    pending:  allDocs.filter(d => d.status === 'pending').length,
    rejected: allDocs.filter(d => d.status === 'rejected').length,
  }), [allDocs])

  if (!user) return null

  const initials = (user.full_name || user.email).slice(0, 2).toUpperCase()

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Panel — mai lat pentru tabel */}
      <div className={`fixed right-0 top-0 h-full w-full lg:w-[720px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* ── Header user ── */}
        <div className="flex-shrink-0 px-5 py-4 border-b border-slate-200 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm">
                {initials}
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{user.full_name || '—'}</p>
                <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <RoleBadge role={user.role} />
                  {user.cif && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">CIF: {user.cif}</span>}
                  {user.specializare && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{user.specializare}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Stats bar ── */}
        {!loading && allDocs.length > 0 && (
          <div className="flex-shrink-0 grid grid-cols-4 gap-0 border-b border-slate-200 bg-slate-50/60">
            {[
              { label: 'Total', val: stats.total, cls: 'text-slate-700' },
              { label: 'Aprobate', val: stats.approved, cls: 'text-emerald-600' },
              { label: 'Verificare', val: stats.review, cls: 'text-blue-600' },
              { label: 'Așteptare', val: stats.pending, cls: 'text-amber-600' },
            ].map((s, i) => (
              <div key={s.label} className={`px-4 py-2.5 text-center ${i < 3 ? 'border-r border-slate-200' : ''}`}>
                <p className={`text-xl font-bold leading-none ${s.cls}`}>{s.val}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters ── */}
        {!loading && allDocs.length > 0 && (
          <div className="flex-shrink-0 flex gap-2 px-4 py-3 border-b border-slate-100 bg-white flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Caută document..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-slate-400"
              />
            </div>

            {/* Status */}
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="pl-7 pr-6 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600 appearance-none cursor-pointer">
                <option value="all">Toate statusurile</option>
                <option value="pending">Așteptare</option>
                <option value="review">Verificare</option>
                <option value="approved">Aprobate</option>
                <option value="rejected">Respinse</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
            </div>

            {/* Project */}
            {uniqueProjects.length > 1 && (
              <div className="relative">
                <FolderOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
                  className="pl-7 pr-6 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600 appearance-none cursor-pointer max-w-[180px]">
                  <option value="all">Toate proiectele</option>
                  {uniqueProjects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
              </div>
            )}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
              <p className="text-xs text-slate-400">Se încarcă documentele...</p>
            </div>
          ) : allDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
                <FolderOpen className="w-7 h-7 text-slate-300" />
              </div>
              <p className="text-sm font-semibold text-slate-700">Niciun document</p>
              <p className="text-xs text-slate-400 mt-1">
                {user.role === 'client' ? 'Clientul nu are documente asociate.' : 'Nu există documente pentru acest utilizator.'}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              {/* Table header */}
              <div className="sticky top-0 z-10 grid grid-cols-[2fr_1.2fr_auto_auto] gap-3 px-4 py-2 bg-slate-50 border-b border-slate-200">
                <button onClick={() => toggleSort('name')} className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors text-left ${sortKey === 'name' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  Document <ArrowUpDown className="w-3 h-3" />
                </button>
                <button onClick={() => toggleSort('project')} className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors text-left ${sortKey === 'project' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  Proiect <ArrowUpDown className="w-3 h-3" />
                </button>
                <button onClick={() => toggleSort('status')} className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${sortKey === 'status' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  Status <ArrowUpDown className="w-3 h-3" />
                </button>
                <button onClick={() => toggleSort('date')} className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${sortKey === 'date' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  <Calendar className="w-3 h-3" /> <ArrowUpDown className="w-3 h-3" />
                </button>
              </div>

              {sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <AlertCircle className="w-6 h-6 text-slate-300 mb-2" />
                  <p className="text-sm text-slate-500">Niciun document găsit</p>
                  <p className="text-xs text-slate-400 mt-1">Modifică filtrele de căutare</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {sorted.map(req => {
                    const latestFile = req.files?.length
                      ? [...req.files].sort((a: any, b: any) => b.version_number - a.version_number)[0]
                      : null

                    return (
                      <div key={req.id} className="grid grid-cols-[2fr_1.2fr_auto_auto] gap-3 items-center px-4 py-3 hover:bg-slate-50 transition-colors group">

                        {/* Nume document */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          {latestFile
                            ? <FileIconBig path={latestFile.storage_path} />
                            : <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><AlertCircle className="w-4 h-4 text-slate-300" /></div>
                          }
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">{req.name}</p>
                            {latestFile ? (
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                {fileName(latestFile.storage_path)}
                                {latestFile.version_number > 1 && <span className="ml-1 bg-slate-200 text-slate-500 px-1 rounded text-[10px]">v{latestFile.version_number}</span>}
                              </p>
                            ) : (
                              <p className="text-[11px] text-slate-400 mt-0.5">Niciun fișier</p>
                            )}
                            {req.activity?.name && (
                              <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                                <Layers className="w-2.5 h-2.5 flex-shrink-0" />{req.activity.name}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Proiect */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-slate-600 truncate font-medium">{req._projectTitle}</p>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={() => { onClose(); router.push(`/projects/${req._projectId}`) }}
                              onKeyDown={e => e.key === 'Enter' && router.push(`/projects/${req._projectId}`)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-slate-300 hover:text-indigo-500 flex-shrink-0"
                              title="Deschide proiect"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </span>
                          </div>
                          {req._projectCodIntern && (
                            <p className="text-[11px] text-slate-400 font-mono mt-0.5">{req._projectCodIntern}</p>
                          )}
                        </div>

                        {/* Status */}
                        <div>
                          <StatusBadge status={req.status} />
                        </div>

                        {/* Data + download */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-[11px] text-slate-400 hidden sm:block">{fmtDate(req.created_at)}</span>
                          {latestFile && (
                            <button
                              onClick={() => handleDownload(latestFile.id)}
                              disabled={downloading === latestFile.id}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40 opacity-0 group-hover:opacity-100"
                              title="Descarcă"
                            >
                              {downloading === latestFile.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Download className="w-3.5 h-3.5" />
                              }
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Footer count */}
              <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
                <p className="text-[11px] text-slate-400">
                  {sorted.length} {sorted.length === 1 ? 'document' : 'documente'}
                  {sorted.length !== allDocs.length ? ` din ${allDocs.length} total` : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}