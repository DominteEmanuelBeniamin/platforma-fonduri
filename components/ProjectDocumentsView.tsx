/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useMemo, useState } from 'react'
import {
  FileText, FileSpreadsheet, Image as ImageIcon, File,
  Download, CheckCircle2, XCircle, Clock, Eye,
  Search, FolderOpen, ChevronDown, Grid3X3, List,
  Layers, AlertCircle, MoreVertical, Info,
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocFile {
  id: string
  storage_path: string
  version_number: number
  comments: string | null
  created_at: string
  uploaded_by: string | null
}

interface DocRequest {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'review' | 'approved' | 'rejected'
  attachment_path: string | null
  deadline_at: string | null
  created_at: string
  creator?: { full_name: string | null; email: string | null }
  activity?: { id: string; name: string; phase_id: string } | null
  files?: DocFile[]
}

interface ProjectDocumentsViewProps {
  projectId: string
  requests: DocRequest[]
  phases: Array<{ id: string; name: string; activities?: Array<{ id: string; name: string }> }>
  onOpenRequest?: (req: DocRequest) => void
}

interface FlatRow {
  rowId: string
  file: DocFile | null
  hasFile: boolean
  reqId: string
  reqName: string
  reqStatus: DocRequest['status']
  reqCreatedAt: string
  reqDeadlineAt: string | null
  reqCreator?: { full_name: string | null; email: string | null }
  reqActivity?: { id: string; name: string; phase_id: string } | null
  phaseName: string
  activityName: string
  _req: DocRequest
}

type SortKey = 'name' | 'activity' | 'status' | 'date'
type SortDir = 'asc' | 'desc'
type ViewMode = 'list' | 'grid'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExt(path: string) {
  const p = path.split('.')
  return p.length > 1 ? p[p.length - 1].toLowerCase() : ''
}

function getFileName(path: string) {
  return path.split('/').pop()?.replace(/^\d+_/, '') ?? path
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Exact like Google Drive file colors
function fileColor(path: string): { bg: string; icon: string; label: string } {
  const ext = getExt(path)
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext))
    return { bg: '#e8f0fe', icon: '#4285f4', label: 'Imagine' }
  if (ext === 'pdf')
    return { bg: '#fce8e6', icon: '#ea4335', label: 'PDF' }
  if (['xls', 'xlsx', 'csv'].includes(ext))
    return { bg: '#e6f4ea', icon: '#34a853', label: 'Spreadsheet' }
  if (['doc', 'docx'].includes(ext))
    return { bg: '#e8f0fe', icon: '#4285f4', label: 'Document' }
  if (['ppt', 'pptx'].includes(ext))
    return { bg: '#fce8e6', icon: '#fbbc04', label: 'Prezentare' }
  return { bg: '#f1f3f4', icon: '#5f6368', label: 'Fișier' }
}

function FileIconDrive({ path, size = 'md' }: { path: string; size?: 'sm' | 'md' | 'lg' }) {
  const { bg, icon } = fileColor(path)
  const ext = getExt(path)

  const sizes = {
    sm:  { wrap: 'w-8 h-8 rounded-lg',   icon: 'w-4 h-4' },
    md:  { wrap: 'w-10 h-10 rounded-xl',  icon: 'w-5 h-5' },
    lg:  { wrap: 'w-16 h-16 rounded-2xl', icon: 'w-8 h-8' },
  }
  const s = sizes[size]

  const IconComp = ['jpg','jpeg','png','gif','webp'].includes(ext) ? ImageIcon
    : ['xls','xlsx','csv'].includes(ext) ? FileSpreadsheet
    : FileText

  return (
    <div className={`${s.wrap} flex items-center justify-center flex-shrink-0`} style={{ backgroundColor: bg }}>
      <IconComp className={s.icon} style={{ color: icon }} />
    </div>
  )
}

function EmptyFileIcon({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm:  'w-8 h-8 rounded-lg',
    md:  'w-10 h-10 rounded-xl',
    lg:  'w-16 h-16 rounded-2xl',
  }
  return (
    <div className={`${sizes[size]} flex items-center justify-center flex-shrink-0 bg-[#f1f3f4]`}>
      <AlertCircle className="w-5 h-5 text-[#9aa0a6]" />
    </div>
  )
}

function StatusPill({ status }: { status: DocRequest['status'] }) {
  const map = {
    approved: { icon: CheckCircle2, label: 'Aprobat',      bg: '#e6f4ea', text: '#137333', dot: '#34a853' },
    rejected: { icon: XCircle,      label: 'Respins',      bg: '#fce8e6', text: '#c5221f', dot: '#ea4335' },
    review:   { icon: Eye,          label: 'În verificare', bg: '#e8f0fe', text: '#1a73e8', dot: '#4285f4' },
    pending:  { icon: Clock,        label: 'În așteptare', bg: '#fef7e0', text: '#b06000', dot: '#fbbc04' },
  }
  const c = map[status] ?? map.pending
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
      style={{ backgroundColor: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.dot }} />
      {c.label}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectDocumentsView({
  projectId,
  requests,
  phases,
  onOpenRequest,
}: ProjectDocumentsViewProps) {
  const { apiFetch } = useAuth()

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterPhase, setFilterPhase] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  // Phase lookup
  const phaseMap = useMemo(() => {
    const m: Record<string, string> = {}
    phases.forEach(p => {
      m[p.id] = p.name
      p.activities?.forEach(a => { m[`act_${a.id}`] = p.name })
    })
    return m
  }, [phases])

  // Flatten: one row per FILE
  const rows = useMemo((): FlatRow[] => {
    const result: FlatRow[] = []
    requests.forEach(req => {
      const phaseName = req.activity
        ? phaseMap[`act_${req.activity.id}`] || phaseMap[req.activity.phase_id] || '—'
        : '—'
      const activityName = req.activity?.name ?? ''
      const base = {
        reqId: req.id, reqName: req.name, reqStatus: req.status,
        reqCreatedAt: req.created_at, reqDeadlineAt: req.deadline_at,
        reqCreator: req.creator, reqActivity: req.activity,
        phaseName, activityName, _req: req,
      }
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => result.push({ ...base, rowId: `${req.id}_${file.id}`, file, hasFile: true }))
      } else {
        result.push({ ...base, rowId: `${req.id}_empty`, file: null, hasFile: false })
      }
    })
    return result
  }, [requests, phaseMap])

  // Filter
  const filtered = useMemo(() => rows.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      const fn = r.file ? getFileName(r.file.storage_path).toLowerCase() : ''
      if (!r.reqName.toLowerCase().includes(q) && !fn.includes(q)) return false
    }
    if (filterStatus !== 'all' && r.reqStatus !== filterStatus) return false
    if (filterPhase !== 'all') {
      if (filterPhase === '__general__') { if (r.reqActivity) return false }
      else { if (r.phaseName !== filterPhase) return false }
    }
    return true
  }), [rows, search, filterStatus, filterPhase])

  // Sort
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name') {
      const na = a.file ? getFileName(a.file.storage_path) : a.reqName
      const nb = b.file ? getFileName(b.file.storage_path) : b.reqName
      cmp = na.localeCompare(nb)
    }
    else if (sortKey === 'activity') cmp = a.phaseName.localeCompare(b.phaseName)
    else if (sortKey === 'status')   cmp = a.reqStatus.localeCompare(b.reqStatus)
    else if (sortKey === 'date') {
      const da = a.file?.created_at || a.reqCreatedAt
      const db = b.file?.created_at || b.reqCreatedAt
      cmp = new Date(da).getTime() - new Date(db).getTime()
    }
    return sortDir === 'asc' ? cmp : -cmp
  }), [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  async function handleDownload(e: React.MouseEvent, fileId: string) {
    e.stopPropagation()
    setDownloading(fileId)
    try {
      const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
        method: 'POST', body: JSON.stringify({ expiresIn: 300 }),
      })
      if (!res.ok) { alert('Eroare la descărcare'); return }
      const { url } = await res.json()
      const a = document.createElement('a')
      a.href = url; a.target = '_blank'; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    } finally { setDownloading(null) }
  }

  // Stats
  const stats = useMemo(() => {
    const uniqueReqs = new Map<string, string>()
    rows.forEach(r => uniqueReqs.set(r.reqId, r.reqStatus))
    const statuses = Array.from(uniqueReqs.values())
    return {
      totalFiles: rows.filter(r => r.hasFile).length,
      totalReqs: uniqueReqs.size,
      approved: statuses.filter(s => s === 'approved').length,
      review:   statuses.filter(s => s === 'review').length,
      pending:  statuses.filter(s => s === 'pending').length,
      rejected: statuses.filter(s => s === 'rejected').length,
    }
  }, [rows])

  const uniquePhases = useMemo(() => {
    const names = new Set(rows.filter(r => r.reqActivity).map(r => r.phaseName))
    return Array.from(names).filter(Boolean)
  }, [rows])

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-white" style={{ fontFamily: "'Google Sans', Roboto, Arial, sans-serif" }}>

      {/* ── Toolbar — exact Google Drive style ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2">

        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#5f6368' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Caută în documente"
            className="w-full pl-12 pr-4 py-2.5 text-sm rounded-full border-0 outline-none transition-shadow"
            style={{
              backgroundColor: '#f1f3f4',
              color: '#202124',
              fontSize: '14px',
            }}
            onFocus={e => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.2), 0 2px 8px rgba(0,0,0,.1)' }}
            onBlur={e => { e.currentTarget.style.backgroundColor = '#f1f3f4'; e.currentTarget.style.boxShadow = 'none' }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#5f6368' }}>✕</button>
          )}
        </div>

        {/* Filter chips + view toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tip chip */}
          <div className="relative">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="appearance-none text-sm pl-3 pr-8 py-1.5 rounded-full border cursor-pointer outline-none transition-colors"
              style={{
                borderColor: filterStatus !== 'all' ? '#1a73e8' : '#dadce0',
                backgroundColor: filterStatus !== 'all' ? '#e8f0fe' : '#fff',
                color: filterStatus !== 'all' ? '#1a73e8' : '#3c4043',
                fontSize: '13px',
              }}
            >
              <option value="all">Tip</option>
              <option value="pending">În așteptare</option>
              <option value="review">În verificare</option>
              <option value="approved">Aprobate</option>
              <option value="rejected">Respinse</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: filterStatus !== 'all' ? '#1a73e8' : '#5f6368' }} />
          </div>

          {/* Fază chip */}
          {uniquePhases.length > 0 && (
            <div className="relative">
              <select
                value={filterPhase}
                onChange={e => setFilterPhase(e.target.value)}
                className="appearance-none text-sm pl-3 pr-8 py-1.5 rounded-full border cursor-pointer outline-none"
                style={{
                  borderColor: filterPhase !== 'all' ? '#1a73e8' : '#dadce0',
                  backgroundColor: filterPhase !== 'all' ? '#e8f0fe' : '#fff',
                  color: filterPhase !== 'all' ? '#1a73e8' : '#3c4043',
                  fontSize: '13px',
                }}
              >
                <option value="all">Fază</option>
                {uniquePhases.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="__general__">Generale</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: filterPhase !== 'all' ? '#1a73e8' : '#5f6368' }} />
            </div>
          )}

          <div className="flex-1" />

          {/* Stats mici */}
          <span className="text-xs" style={{ color: '#5f6368' }}>
            {stats.totalFiles} fișiere · {stats.totalReqs} cereri
          </span>

          {/* View toggle */}
          <div className="flex items-center rounded-full border overflow-hidden" style={{ borderColor: '#dadce0' }}>
            <button
              onClick={() => setViewMode('list')}
              className="p-1.5 transition-colors"
              style={{ backgroundColor: viewMode === 'list' ? '#e8f0fe' : 'transparent', color: viewMode === 'list' ? '#1a73e8' : '#5f6368' }}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className="p-1.5 transition-colors"
              style={{ backgroundColor: viewMode === 'grid' ? '#e8f0fe' : 'transparent', color: viewMode === 'grid' ? '#1a73e8' : '#5f6368' }}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8 pb-16">
            <FolderOpen className="w-20 h-20 mb-4" style={{ color: '#dadce0' }} />
            <p className="text-lg font-medium" style={{ color: '#3c4043' }}>
              {search || filterStatus !== 'all' || filterPhase !== 'all'
                ? 'Niciun rezultat'
                : 'Niciun document'
              }
            </p>
            <p className="text-sm mt-1" style={{ color: '#5f6368' }}>
              {search || filterStatus !== 'all' || filterPhase !== 'all'
                ? 'Încearcă să modifici filtrele'
                : 'Documentele uploadate vor apărea aici'
              }
            </p>
          </div>

        ) : viewMode === 'list' ? (
          /* ══ LIST VIEW ══ */
          <div>
            {/* Column headers */}
            <div className="grid px-4 py-2 border-b" style={{
              gridTemplateColumns: '3fr 1.5fr 1fr 1fr 40px',
              gap: '8px',
              borderColor: '#e0e0e0',
              backgroundColor: '#fff',
            }}>
              {([
                { key: 'name' as SortKey,     label: 'Nume' },
                { key: 'activity' as SortKey, label: 'Fază / Activitate' },
                { key: 'status' as SortKey,   label: 'Status' },
                { key: 'date' as SortKey,     label: 'Modificat' },
              ]).map(col => (
                <button
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="flex items-center gap-1 text-left transition-colors"
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: sortKey === col.key ? '#1a73e8' : '#5f6368',
                    letterSpacing: '0.01em',
                  }}
                >
                  {col.label}
                  <span style={{ opacity: sortKey === col.key ? 1 : 0, fontSize: '10px' }}>
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                </button>
              ))}
              <div />
            </div>

            {/* Rows */}
            {sorted.map(row => {
              const isHovered = hoveredRow === row.rowId
              const displayName = row.file ? getFileName(row.file.storage_path) : row.reqName
              const dateStr = row.file?.created_at ? formatDate(row.file.created_at) : formatDate(row.reqCreatedAt)

              return (
                <div
                  key={row.rowId}
                  onMouseEnter={() => setHoveredRow(row.rowId)}
                  onMouseLeave={() => setHoveredRow(null)}
                  onClick={() => onOpenRequest?.(row._req)}
                  className="grid items-center px-4 py-1.5 cursor-pointer transition-colors"
                  style={{
                    gridTemplateColumns: '3fr 1.5fr 1fr 1fr 40px',
                    gap: '8px',
                    backgroundColor: isHovered ? '#f8f9fa' : 'transparent',
                    borderBottom: '1px solid #f1f3f4',
                  }}
                >
                  {/* Name */}
                  <div className="flex items-center gap-3 min-w-0">
                    {row.hasFile && row.file
                      ? <FileIconDrive path={row.file.storage_path} size="sm" />
                      : <EmptyFileIcon size="sm" />
                    }
                    <div className="min-w-0">
                      <p className="truncate font-medium" style={{ fontSize: '13px', color: '#202124' }}>
                        {displayName}
                        {row.file && row.file.version_number > 1 && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#e8f0fe', color: '#1a73e8' }}>
                            v{row.file.version_number}
                          </span>
                        )}
                      </p>
                      {row.hasFile && (
                        <p className="truncate" style={{ fontSize: '11px', color: '#5f6368' }}>
                          {row.reqName}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Fază */}
                  <div className="min-w-0">
                    {row.reqActivity ? (
                      <div>
                        <p className="truncate flex items-center gap-1" style={{ fontSize: '12px', color: '#5f6368' }}>
                          <Layers className="w-3 h-3 flex-shrink-0" style={{ color: '#9aa0a6' }} />
                          {row.phaseName}
                        </p>
                        <p className="truncate" style={{ fontSize: '11px', color: '#9aa0a6', paddingLeft: '16px' }}>
                          {row.activityName}
                        </p>
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#9aa0a6', fontStyle: 'italic' }}>General</p>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <StatusPill status={row.reqStatus} />
                  </div>

                  {/* Dată */}
                  <p style={{ fontSize: '12px', color: '#5f6368' }}>{dateStr}</p>

                  {/* Acțiuni */}
                  <div className="flex items-center justify-end" onClick={e => e.stopPropagation()}>
                    {isHovered && row.hasFile && row.file && (
                      <button
                        onClick={e => handleDownload(e, row.file!.id)}
                        disabled={downloading === row.file.id}
                        className="p-1.5 rounded-full transition-colors"
                        style={{ color: '#5f6368' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        title="Descarcă"
                      >
                        {downloading === row.file.id
                          ? <span className="w-4 h-4 border-2 rounded-full animate-spin block" style={{ borderColor: '#dadce0', borderTopColor: '#1a73e8' }} />
                          : <Download className="w-4 h-4" />
                        }
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

        ) : (
          /* ══ GRID VIEW ══ */
          <div className="p-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {sorted.map(row => {
              const isHovered = hoveredRow === row.rowId
              const displayName = row.file ? getFileName(row.file.storage_path) : row.reqName
              const dateStr = row.file?.created_at ? formatDate(row.file.created_at) : formatDate(row.reqCreatedAt)

              return (
                <div
                  key={row.rowId}
                  onMouseEnter={() => setHoveredRow(row.rowId)}
                  onMouseLeave={() => setHoveredRow(null)}
                  onClick={() => onOpenRequest?.(row._req)}
                  className="flex flex-col rounded-xl border cursor-pointer transition-all overflow-hidden"
                  style={{
                    borderColor: isHovered ? '#1a73e8' : '#e0e0e0',
                    backgroundColor: isHovered ? '#f8f9fa' : '#fff',
                    boxShadow: isHovered ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                  }}
                >
                  {/* Preview area */}
                  <div className="flex items-center justify-center py-6" style={{ backgroundColor: '#f8f9fa' }}>
                    {row.hasFile && row.file
                      ? <FileIconDrive path={row.file.storage_path} size="lg" />
                      : <EmptyFileIcon size="lg" />
                    }
                  </div>

                  {/* Info */}
                  <div className="px-3 py-2 border-t flex items-center gap-2" style={{ borderColor: '#e0e0e0' }}>
                    {row.hasFile && row.file
                      ? <FileIconDrive path={row.file.storage_path} size="sm" />
                      : <EmptyFileIcon size="sm" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium" style={{ fontSize: '12px', color: '#202124' }}>
                        {displayName}
                      </p>
                      <p style={{ fontSize: '11px', color: '#5f6368' }}>{dateStr}</p>
                    </div>
                    <div onClick={e => e.stopPropagation()}>
                      {isHovered && row.hasFile && row.file && (
                        <button
                          onClick={e => handleDownload(e, row.file!.id)}
                          disabled={downloading === row.file.id}
                          className="p-1 rounded-full"
                          style={{ color: '#5f6368' }}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Status pill */}
                  <div className="px-3 pb-2">
                    <StatusPill status={row.reqStatus} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Footer bar ── */}
      {rows.length > 0 && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: '#e0e0e0' }}>
          <div className="flex items-center gap-4">
            {[
              { label: 'Aprobate',      val: stats.approved, color: '#137333' },
              { label: 'În verificare', val: stats.review,   color: '#1a73e8' },
              { label: 'În așteptare',  val: stats.pending,  color: '#b06000' },
              { label: 'Respinse',      val: stats.rejected, color: '#c5221f' },
            ].filter(s => s.val > 0).map(s => (
              <span key={s.label} className="flex items-center gap-1.5" style={{ fontSize: '12px', color: s.color }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.val} {s.label.toLowerCase()}
              </span>
            ))}
          </div>
          <span style={{ fontSize: '12px', color: '#5f6368' }}>
            {sorted.length !== rows.length ? `${sorted.length} din ` : ''}{rows.length} {rows.length === 1 ? 'element' : 'elemente'}
          </span>
        </div>
      )}
    </div>
  )
}