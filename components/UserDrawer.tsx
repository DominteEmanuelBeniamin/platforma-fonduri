/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import {
  X, FolderOpen, FileText, FileSpreadsheet,
  Image as ImageIcon, File, CheckCircle2, XCircle,
  Clock, Eye, Download, Layers, Building2, Briefcase,
  Shield, Search, ChevronDown, Loader2, AlertCircle,
  ExternalLink, ArrowLeft,
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

function getExt(path: string) {
  const p = path.split('.')
  return p.length > 1 ? p[p.length - 1].toLowerCase() : ''
}

function isImageExt(e: string) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(e)
}

function fileTypeCfg(e: string): { bg: string; color: string; label: string; Icon: any } {
  if (isImageExt(e))             return { bg: '#ede9fe', color: '#7c3aed', label: e.toUpperCase(), Icon: ImageIcon }
  if (e === 'pdf')               return { bg: '#fee2e2', color: '#dc2626', label: 'PDF',           Icon: FileText }
  if (['xls','xlsx','csv'].includes(e)) return { bg: '#d1fae5', color: '#059669', label: e.toUpperCase(), Icon: FileSpreadsheet }
  if (['doc','docx'].includes(e)) return { bg: '#dbeafe', color: '#2563eb', label: e.toUpperCase(), Icon: FileText }
  return                                 { bg: '#f1f5f9', color: '#64748b', label: 'FILE',          Icon: File }
}

function FileThumb({ path, previewUrl }: { path: string; previewUrl?: string }) {
  const e = getExt(path)
  if (isImageExt(e) && previewUrl) {
    return (
      <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 border border-slate-100 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="" className="w-full h-full object-cover" />
      </div>
    )
  }
  const { bg, color, Icon } = fileTypeCfg(e)
  return (
    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
      style={{ backgroundColor: bg }}>
      <Icon className="w-5 h-5" style={{ color }} />
    </div>
  )
}

function TypeBadge({ path }: { path: string }) {
  const e = getExt(path)
  const { bg, color, label } = fileTypeCfg(e)
  return (
    <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ backgroundColor: bg, color }}>
      {label}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { Icon: any; label: string; bg: string; text: string; dot: string }> = {
    approved: { Icon: CheckCircle2, label: 'Aprobat',    bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
    rejected: { Icon: XCircle,      label: 'Respins',    bg: '#fef2f2', text: '#dc2626', dot: '#ef4444' },
    review:   { Icon: Eye,          label: 'Verificare', bg: '#eff6ff', text: '#2563eb', dot: '#3b82f6' },
    pending:  { Icon: Clock,        label: 'Așteptare',  bg: '#fffbeb', text: '#d97706', dot: '#f59e0b' },
  }
  const c = map[status] ?? map.pending
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.dot }} />
      {c.label}
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UserDrawer({ user, open, onClose }: UserDrawerProps) {
  const { apiFetch } = useAuth()
  const router = useRouter()

  const [allDocs, setAllDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterProject, setFilterProject] = useState('all')
  const [sortKey, setSortKey]   = useState<SortKey>('date')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const fetchedIds = useRef<Set<string>>(new Set())

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open || !user) return
    setAllDocs([])
    setSearch('')
    setFilterStatus('all')
    setFilterProject('all')
    setPreviewUrls({})
    fetchedIds.current.clear()
    loadAll()
  }, [open, user?.id])

  async function loadAll() {
    if (!user) return
    setLoading(true)
    try {
      const projRes = await apiFetch('/api/projects')
      if (!projRes.ok) return
      const { projects: allProjects } = await projRes.json()

      const projects: any[] = user.role === 'client'
        ? allProjects.filter((p: any) => p.client_id === user.id)
        : allProjects

      const results = await Promise.all(
        projects.map(async (p: any) => {
          const res = await apiFetch(`/api/projects/${p.id}/document-requests`)
          if (!res.ok) return []
          const { requests } = await res.json()
          return (requests ?? [])
            .filter((req: any) => req.files?.length > 0)
            .map((req: any) => ({
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

  // Fetch image preview signed URLs
  useEffect(() => {
    allDocs.forEach(req => {
      if (!req.files?.length) return
      const latest = [...req.files].sort((a: any, b: any) => b.version_number - a.version_number)[0]
      if (!latest || !isImageExt(getExt(latest.storage_path))) return
      if (fetchedIds.current.has(latest.id)) return
      fetchedIds.current.add(latest.id)
      ;(async () => {
        try {
          const res = await apiFetch(`/api/files/${latest.id}/signed-download`, {
            method: 'POST', body: JSON.stringify({ expiresIn: 3600 }),
          })
          if (res.ok) {
            const { url } = await res.json()
            setPreviewUrls(prev => ({ ...prev, [latest.id]: url }))
          }
        } catch { /* silent */ }
      })()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDocs])

  async function handleDownload(fileId: string) {
    setDownloading(fileId)
    try {
      const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
        method: 'POST', body: JSON.stringify({ expiresIn: 300 }),
      })
      if (!res.ok) { alert('Eroare la descărcare'); return }
      const { url } = await res.json()
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    } finally { setDownloading(null) }
  }

  const uniqueProjects = useMemo(() => {
    const seen = new Map<string, string>()
    allDocs.forEach(d => { if (d._projectId) seen.set(d._projectId, d._projectTitle) })
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }))
  }, [allDocs])

  const filtered = useMemo(() => allDocs.filter(d => {
    if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus !== 'all' && d.status !== filterStatus) return false
    if (filterProject !== 'all' && d._projectId !== filterProject) return false
    return true
  }), [allDocs, search, filterStatus, filterProject])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name')    cmp = a.name.localeCompare(b.name)
    if (sortKey === 'status')  cmp = a.status.localeCompare(b.status)
    if (sortKey === 'date')    cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    if (sortKey === 'project') cmp = (a._projectTitle ?? '').localeCompare(b._projectTitle ?? '')
    return sortDir === 'asc' ? cmp : -cmp
  }), [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

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
        className={`fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`fixed right-0 top-0 h-full w-full lg:w-[680px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ fontFamily: "'Google Sans', Roboto, Arial, sans-serif" }}>

        {/* ── Header ── */}
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-lg font-bold flex-shrink-0 shadow-md">
                {initials}
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 leading-tight">{user.full_name || '—'}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{user.email}</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <RoleBadge role={user.role} />
                  {user.cif && (
                    <span className="text-[11px] font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      CIF {user.cif}
                    </span>
                  )}
                  {user.specializare && (
                    <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      {user.specializare}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Stats inline */}
          {!loading && allDocs.length > 0 && (
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              {[
                { label: `${stats.total} fișiere`, dot: '#64748b' },
                stats.approved > 0 && { label: `${stats.approved} aprobate`, dot: '#22c55e' },
                stats.review   > 0 && { label: `${stats.review} în verificare`, dot: '#3b82f6' },
                stats.pending  > 0 && { label: `${stats.pending} în așteptare`, dot: '#f59e0b' },
                stats.rejected > 0 && { label: `${stats.rejected} respinse`, dot: '#ef4444' },
              ].filter(Boolean).map((s: any) => (
                <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.dot }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Search + Filters ── */}
        {!loading && allDocs.length > 0 && (
          <div className="flex-shrink-0 px-6 py-3 border-b border-slate-100 flex gap-2 flex-wrap items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9aa0a6' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Caută în documente"
                className="w-full pl-10 pr-4 py-2 text-sm rounded-full border-0 outline-none transition-shadow"
                style={{ backgroundColor: '#f1f3f4', color: '#202124', fontSize: '13px' }}
                onFocus={e => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.2)' }}
                onBlur={e => { e.currentTarget.style.backgroundColor = '#f1f3f4'; e.currentTarget.style.boxShadow = 'none' }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#5f6368' }}>✕</button>
              )}
            </div>

            {/* Status chip */}
            <div className="relative">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="appearance-none text-sm pl-3 pr-7 py-1.5 rounded-full border cursor-pointer outline-none transition-colors"
                style={{
                  borderColor: filterStatus !== 'all' ? '#1a73e8' : '#dadce0',
                  backgroundColor: filterStatus !== 'all' ? '#e8f0fe' : '#fff',
                  color: filterStatus !== 'all' ? '#1a73e8' : '#3c4043',
                  fontSize: '13px',
                }}>
                <option value="all">Status</option>
                <option value="pending">Așteptare</option>
                <option value="review">Verificare</option>
                <option value="approved">Aprobate</option>
                <option value="rejected">Respinse</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: filterStatus !== 'all' ? '#1a73e8' : '#5f6368' }} />
            </div>

            {/* Project chip */}
            {uniqueProjects.length > 1 && (
              <div className="relative">
                <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
                  className="appearance-none text-sm pl-3 pr-7 py-1.5 rounded-full border cursor-pointer outline-none"
                  style={{
                    borderColor: filterProject !== 'all' ? '#1a73e8' : '#dadce0',
                    backgroundColor: filterProject !== 'all' ? '#e8f0fe' : '#fff',
                    color: filterProject !== 'all' ? '#1a73e8' : '#3c4043',
                    fontSize: '13px',
                    maxWidth: '180px',
                  }}>
                  <option value="all">Proiect</option>
                  {uniqueProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                  style={{ color: filterProject !== 'all' ? '#1a73e8' : '#5f6368' }} />
              </div>
            )}

            <div className="flex-1" />
            <span className="text-xs" style={{ color: '#5f6368' }}>
              {sorted.length !== allDocs.length ? `${sorted.length} din ` : ''}{allDocs.length} {allDocs.length === 1 ? 'fișier' : 'fișiere'}
            </span>
          </div>
        )}

        {/* ── Sort header ── */}
        {!loading && sorted.length > 0 && (
          <div className="flex-shrink-0 grid px-6 py-2 border-b" style={{
            gridTemplateColumns: '1fr auto auto',
            gap: '12px',
            borderColor: '#e0e0e0',
            backgroundColor: '#fafafa',
          }}>
            {([
              { key: 'name' as SortKey, label: 'Document' },
              { key: 'status' as SortKey, label: 'Status' },
              { key: 'date' as SortKey, label: 'Dată' },
            ]).map(col => (
              <button key={col.key} onClick={() => toggleSort(col.key)}
                className="flex items-center gap-1 text-left transition-colors"
                style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em',
                  color: sortKey === col.key ? '#1a73e8' : '#9aa0a6', textTransform: 'uppercase' }}>
                {col.label}
                <span style={{ opacity: sortKey === col.key ? 1 : 0, fontSize: '10px' }}>
                  {sortDir === 'asc' ? '↑' : '↓'}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#1a73e8' }} />
              <p className="text-sm" style={{ color: '#5f6368' }}>Se încarcă documentele...</p>
            </div>

          ) : allDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 pb-16">
              <FolderOpen className="w-16 h-16 mb-4" style={{ color: '#dadce0' }} />
              <p className="text-base font-medium mb-1" style={{ color: '#3c4043' }}>Niciun fișier încărcat</p>
              <p className="text-sm" style={{ color: '#5f6368' }}>
                {user.role === 'client'
                  ? 'Clientul nu a încărcat niciun fișier încă.'
                  : 'Nu există fișiere pentru acest utilizator.'}
              </p>
            </div>

          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 pb-16">
              <AlertCircle className="w-12 h-12 mb-3" style={{ color: '#dadce0' }} />
              <p className="text-sm font-medium" style={{ color: '#3c4043' }}>Niciun rezultat</p>
              <p className="text-xs mt-1" style={{ color: '#5f6368' }}>Încearcă să modifici filtrele</p>
            </div>

          ) : (
            <div>
              {sorted.map((req, idx) => {
                const latest = [...(req.files ?? [])].sort((a: any, b: any) => b.version_number - a.version_number)[0] ?? null
                const previewUrl = latest ? previewUrls[latest.id] : undefined
                const dateStr = latest?.created_at ? fmtDate(latest.created_at) : fmtDate(req.created_at)

                return (
                  <div key={req.id}
                    className="group flex items-center gap-4 px-6 py-3.5 transition-colors cursor-default"
                    style={{
                      borderBottom: idx < sorted.length - 1 ? '1px solid #f1f3f4' : 'none',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {/* Thumbnail */}
                    {latest && <FileThumb path={latest.storage_path} previewUrl={previewUrl} />}

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate" style={{ fontSize: '13px', color: '#202124' }}>
                          {req.name}
                        </p>
                        {latest && <TypeBadge path={latest.storage_path} />}
                        {latest && latest.version_number > 1 && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: '#e8f0fe', color: '#1a73e8' }}>
                            v{latest.version_number}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {/* Project */}
                        <button
                          onClick={() => { onClose(); router.push(`/projects/${req._projectId}`) }}
                          className="flex items-center gap-1 transition-colors hover:underline"
                          style={{ fontSize: '11px', color: '#5f6368' }}
                        >
                          <ArrowLeft className="w-2.5 h-2.5 rotate-[135deg]" style={{ color: '#9aa0a6' }} />
                          {req._projectTitle}
                          {req._projectCodIntern && (
                            <span className="font-mono" style={{ color: '#9aa0a6' }}>· {req._projectCodIntern}</span>
                          )}
                          <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>

                        {/* Activity */}
                        {req.activity?.name && (
                          <>
                            <span style={{ color: '#dadce0', fontSize: '11px' }}>·</span>
                            <span className="flex items-center gap-1" style={{ fontSize: '11px', color: '#9aa0a6' }}>
                              <Layers className="w-2.5 h-2.5" />
                              {req.activity.name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    <div className="flex-shrink-0">
                      <StatusPill status={req.status} />
                    </div>

                    {/* Date */}
                    <div className="flex-shrink-0 text-right" style={{ minWidth: '80px' }}>
                      <p style={{ fontSize: '11px', color: '#9aa0a6' }}>{dateStr}</p>
                    </div>

                    {/* Download */}
                    <div className="flex-shrink-0">
                      {latest && (
                        <button
                          onClick={() => handleDownload(latest.id)}
                          disabled={downloading === latest.id}
                          className="p-2 rounded-full transition-colors disabled:opacity-40 opacity-0 group-hover:opacity-100"
                          style={{ color: '#5f6368' }}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                          title="Descarcă"
                        >
                          {downloading === latest.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Download className="w-4 h-4" />
                          }
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {sorted.length > 0 && (
          <div className="flex-shrink-0 px-6 py-2.5 border-t flex items-center justify-between" style={{ borderColor: '#e0e0e0' }}>
            <div className="flex items-center gap-3">
              {[
                { label: 'Aprobate', val: stats.approved, color: '#15803d' },
                { label: 'Verificare', val: stats.review, color: '#2563eb' },
                { label: 'Așteptare', val: stats.pending, color: '#d97706' },
                { label: 'Respinse', val: stats.rejected, color: '#dc2626' },
              ].filter(s => s.val > 0).map(s => (
                <span key={s.label} className="flex items-center gap-1.5" style={{ fontSize: '11px', color: s.color }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.val} {s.label.toLowerCase()}
                </span>
              ))}
            </div>
            <span style={{ fontSize: '11px', color: '#9aa0a6' }}>
              {sorted.length !== allDocs.length ? `${sorted.length} din ` : ''}{allDocs.length} {allDocs.length === 1 ? 'fișier' : 'fișiere'}
            </span>
          </div>
        )}
      </div>
    </>
  )
}
