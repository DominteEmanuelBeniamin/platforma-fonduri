/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useMemo, useState, useRef, useEffect } from 'react'
import {
  FileText, FileSpreadsheet, Image as ImageIcon,
  Download, CheckCircle2, XCircle, Clock, Eye,
  Search, FolderOpen, ChevronDown, Grid3X3, List,
  AlertCircle,
} from 'lucide-react'

// ── Public types ──────────────────────────────────────────────────────────────

export interface DriveRow {
  id: string           // unique row key
  fileId: string       // used for download + image preview API
  storagePath: string  // determines file type icon + image detection
  displayName?: string
  versionNumber?: number
  uploadedAt: string

  docName: string
  docStatus: 'pending' | 'review' | 'approved' | 'rejected'

  // optional secondary column (phase or project)
  secondaryMain?: string      // bold line
  secondarySub?: string       // dimmer sub-line
  onSecondaryClick?: () => void

  // optional row click (e.g. open request modal)
  onRowClick?: () => void
}

interface DriveFilesViewProps {
  rows: DriveRow[]
  secondaryColumnLabel?: string
  apiFetch: (url: string, opts?: RequestInit) => Promise<Response>
  emptyText?: string
  /**
   * standalone=true  → no fixed height, page-level scroll (user page)
   * standalone=false → flex h-full with internal overflow (panel inside project)
   */
  standalone?: boolean
}

// ── Internal types ────────────────────────────────────────────────────────────

type SortKey = 'name' | 'secondary' | 'status' | 'date'
type SortDir = 'asc' | 'desc'
type ViewMode = 'list' | 'grid'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExt(path: string) {
  const p = path.split('.')
  return p.length > 1 ? p[p.length - 1].toLowerCase() : ''
}

function isImageExt(e: string) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(e)
}

function getDisplayName(row: Pick<DriveRow, 'displayName' | 'storagePath'>) {
  const displayName = row.displayName?.trim()
  if (displayName) return displayName
  return row.storagePath.split('/').filter(Boolean).pop() || 'fisier'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fileColor(path: string): { bg: string; icon: string } {
  const ext = getExt(path)
  if (isImageExt(ext))                    return { bg: '#e8f0fe', icon: '#4285f4' }
  if (ext === 'pdf')                      return { bg: '#fce8e6', icon: '#ea4335' }
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { bg: '#e6f4ea', icon: '#34a853' }
  if (['doc', 'docx'].includes(ext))      return { bg: '#e8f0fe', icon: '#4285f4' }
  return { bg: '#f1f3f4', icon: '#5f6368' }
}

function FileIconDrive({ path, size = 'md' }: { path: string; size?: 'sm' | 'md' | 'lg' }) {
  const { bg, icon } = fileColor(path)
  const ext = getExt(path)
  const sizes = {
    sm: { wrap: 'w-8 h-8 rounded-lg',    ic: 'w-4 h-4' },
    md: { wrap: 'w-10 h-10 rounded-xl',  ic: 'w-5 h-5' },
    lg: { wrap: 'w-16 h-16 rounded-2xl', ic: 'w-8 h-8' },
  }
  const s = sizes[size]
  const IconComp = isImageExt(ext) ? ImageIcon
    : ['xls', 'xlsx', 'csv'].includes(ext) ? FileSpreadsheet
    : FileText
  return (
    <div className={`${s.wrap} flex items-center justify-center flex-shrink-0`} style={{ backgroundColor: bg }}>
      <IconComp className={s.ic} style={{ color: icon }} />
    </div>
  )
}

function FilePreview({ path, previewUrl, size = 'md' }: { path: string; previewUrl?: string; size?: 'sm' | 'md' | 'lg' }) {
  const ext = getExt(path)
  if (isImageExt(ext) && previewUrl) {
    const sizes = { sm: 'w-8 h-8 rounded-lg', md: 'w-10 h-10 rounded-xl', lg: 'w-16 h-16 rounded-2xl' }
    return (
      <div className={`${sizes[size]} overflow-hidden flex-shrink-0 border`} style={{ borderColor: '#e0e0e0' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="" className="w-full h-full object-cover" />
      </div>
    )
  }
  return <FileIconDrive path={path} size={size} />
}

function StatusPill({ status }: { status: DriveRow['docStatus'] }) {
  const map = {
    approved: { label: 'Aprobat',       bg: '#e6f4ea', text: '#137333', dot: '#34a853' },
    rejected: { label: 'Respins',       bg: '#fce8e6', text: '#c5221f', dot: '#ea4335' },
    review:   { label: 'În verificare', bg: '#e8f0fe', text: '#1a73e8', dot: '#4285f4' },
    pending:  { label: 'În așteptare',  bg: '#fef7e0', text: '#b06000', dot: '#fbbc04' },
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriveFilesView({
  rows,
  secondaryColumnLabel = 'Info',
  apiFetch,
  emptyText = 'Niciun document',
  standalone = false,
}: DriveFilesViewProps) {
  const [search, setSearch]               = useState('')
  const [filterStatus, setFilterStatus]   = useState('all')
  const [filterSecondary, setFilterSecondary] = useState('all')
  const [sortKey, setSortKey]             = useState<SortKey>('date')
  const [sortDir, setSortDir]             = useState<SortDir>('desc')
  const [viewMode, setViewMode]           = useState<ViewMode>('list')
  const [hoveredId, setHoveredId]         = useState<string | null>(null)
  const [downloading, setDownloading]     = useState<string | null>(null)
  const [previewUrls, setPreviewUrls]     = useState<Record<string, string>>({})
  const fetchedIds = useRef<Set<string>>(new Set())

  // Fetch signed preview URLs for images
  useEffect(() => {
    rows.forEach(row => {
      if (!isImageExt(getExt(row.storagePath))) return
      if (fetchedIds.current.has(row.fileId)) return
      fetchedIds.current.add(row.fileId)
      ;(async () => {
        try {
          const res = await apiFetch(`/api/files/${row.fileId}/signed-download`, {
            method: 'POST', body: JSON.stringify({ expiresIn: 3600 }),
          })
          if (res.ok) {
            const { url } = await res.json()
            setPreviewUrls(prev => ({ ...prev, [row.fileId]: url }))
          }
        } catch { /* silent */ }
      })()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

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
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    } finally { setDownloading(null) }
  }

  // Unique secondary values for filter
  const secondaryOptions = useMemo(() => {
    const seen = new Set<string>()
    rows.forEach(r => { if (r.secondaryMain) seen.add(r.secondaryMain) })
    return Array.from(seen)
  }, [rows])

  const hasUnassigned = useMemo(() => rows.some(r => !r.secondaryMain), [rows])

  // Filter
  const filtered = useMemo(() => rows.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      const fn = getDisplayName(r).toLowerCase()
      if (!r.docName.toLowerCase().includes(q) && !fn.includes(q)) return false
    }
    if (filterStatus !== 'all' && r.docStatus !== filterStatus) return false
    if (filterSecondary !== 'all') {
      if (filterSecondary === '__unassigned__') { if (r.secondaryMain) return false }
      else { if (r.secondaryMain !== filterSecondary) return false }
    }
    return true
  }), [rows, search, filterStatus, filterSecondary])

  // Sort
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name')      cmp = a.docName.localeCompare(b.docName)
    if (sortKey === 'status')    cmp = a.docStatus.localeCompare(b.docStatus)
    if (sortKey === 'date')      cmp = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
    if (sortKey === 'secondary') cmp = (a.secondaryMain ?? '').localeCompare(b.secondaryMain ?? '')
    return sortDir === 'asc' ? cmp : -cmp
  }), [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const stats = useMemo(() => ({
    total:    rows.length,
    approved: rows.filter(r => r.docStatus === 'approved').length,
    review:   rows.filter(r => r.docStatus === 'review').length,
    pending:  rows.filter(r => r.docStatus === 'pending').length,
    rejected: rows.filter(r => r.docStatus === 'rejected').length,
  }), [rows])

  // ── Layout classes depend on mode ─────────────────────────────────────────
  const outerCls  = standalone ? 'flex flex-col bg-white' : 'flex flex-col h-full bg-white'
  const contentCls = standalone ? '' : 'flex-1 overflow-y-auto min-h-0'

  return (
    <div className={outerCls} style={{ fontFamily: "'Google Sans', Roboto, Arial, sans-serif" }}>

      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#5f6368' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Caută în documente"
            className="w-full pl-12 pr-4 py-2.5 rounded-full border-0 outline-none transition-shadow"
            style={{ backgroundColor: '#f1f3f4', color: '#202124', fontSize: '14px' }}
            onFocus={e => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.2), 0 2px 8px rgba(0,0,0,.1)' }}
            onBlur={e => { e.currentTarget.style.backgroundColor = '#f1f3f4'; e.currentTarget.style.boxShadow = 'none' }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#5f6368' }}>✕</button>
          )}
        </div>

        {/* Filter chips + view toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status */}
          <div className="relative">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="appearance-none text-sm pl-3 pr-8 py-1.5 rounded-full border cursor-pointer outline-none"
              style={{
                borderColor: filterStatus !== 'all' ? '#1a73e8' : '#dadce0',
                backgroundColor: filterStatus !== 'all' ? '#e8f0fe' : '#fff',
                color: filterStatus !== 'all' ? '#1a73e8' : '#3c4043',
                fontSize: '13px',
              }}>
              <option value="all">Status</option>
              <option value="pending">În așteptare</option>
              <option value="review">În verificare</option>
              <option value="approved">Aprobate</option>
              <option value="rejected">Respinse</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
              style={{ color: filterStatus !== 'all' ? '#1a73e8' : '#5f6368' }} />
          </div>

          {/* Secondary filter */}
          {(secondaryOptions.length > 1 || (secondaryOptions.length > 0 && hasUnassigned)) && (
            <div className="relative">
              <select value={filterSecondary} onChange={e => setFilterSecondary(e.target.value)}
                className="appearance-none text-sm pl-3 pr-8 py-1.5 rounded-full border cursor-pointer outline-none"
                style={{
                  borderColor: filterSecondary !== 'all' ? '#1a73e8' : '#dadce0',
                  backgroundColor: filterSecondary !== 'all' ? '#e8f0fe' : '#fff',
                  color: filterSecondary !== 'all' ? '#1a73e8' : '#3c4043',
                  fontSize: '13px',
                  maxWidth: '180px',
                }}>
                <option value="all">{secondaryColumnLabel}</option>
                {secondaryOptions.map(o => <option key={o} value={o}>{o}</option>)}
                {hasUnassigned && <option value="__unassigned__">Generale</option>}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: filterSecondary !== 'all' ? '#1a73e8' : '#5f6368' }} />
            </div>
          )}

          <div className="flex-1" />

          <span style={{ fontSize: '12px', color: '#5f6368' }}>
            {sorted.length !== rows.length ? `${sorted.length} din ` : ''}{rows.length} {rows.length === 1 ? 'fișier' : 'fișiere'}
          </span>

          {/* View toggle */}
          <div className="flex items-center rounded-full border overflow-hidden" style={{ borderColor: '#dadce0' }}>
            {(['list', 'grid'] as ViewMode[]).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} className="p-1.5 transition-colors"
                style={{
                  backgroundColor: viewMode === mode ? '#e8f0fe' : 'transparent',
                  color: viewMode === mode ? '#1a73e8' : '#5f6368',
                }}>
                {mode === 'list' ? <List className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className={contentCls}>
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center px-8">
            <FolderOpen className="w-20 h-20 mb-4" style={{ color: '#dadce0' }} />
            <p className="text-lg font-medium" style={{ color: '#3c4043' }}>
              {search || filterStatus !== 'all' || filterSecondary !== 'all' ? 'Niciun rezultat' : emptyText}
            </p>
            <p className="text-sm mt-1" style={{ color: '#5f6368' }}>
              {search || filterStatus !== 'all' || filterSecondary !== 'all'
                ? 'Încearcă să modifici filtrele'
                : 'Documentele uploadate vor apărea aici'}
            </p>
          </div>

        ) : viewMode === 'list' ? (
          /* ══ LIST VIEW ══ */
          <div>
            <div className="grid px-4 py-2 border-b" style={{
              gridTemplateColumns: '3fr 1.5fr 1fr 1fr 40px',
              gap: '8px', borderColor: '#e0e0e0', backgroundColor: '#fafafa',
            }}>
              {([
                { key: 'name' as SortKey,      label: 'Nume' },
                { key: 'secondary' as SortKey, label: secondaryColumnLabel },
                { key: 'status' as SortKey,    label: 'Status' },
                { key: 'date' as SortKey,      label: 'Dată' },
              ]).map(col => (
                <button key={col.key} onClick={() => toggleSort(col.key)}
                  className="flex items-center gap-1 text-left transition-colors"
                  style={{
                    fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                    color: sortKey === col.key ? '#1a73e8' : '#9aa0a6',
                  }}>
                  {col.label}
                  <span style={{ opacity: sortKey === col.key ? 1 : 0, fontSize: '10px' }}>
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                </button>
              ))}
              <div />
            </div>

            {sorted.map(row => (
              <div key={row.id}
                onMouseEnter={() => setHoveredId(row.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => row.onRowClick?.()}
                className="grid items-center px-4 py-1.5 transition-colors"
                style={{
                  gridTemplateColumns: '3fr 1.5fr 1fr 1fr 40px',
                  gap: '8px',
                  backgroundColor: hoveredId === row.id ? '#f8f9fa' : 'transparent',
                  borderBottom: '1px solid #f1f3f4',
                  cursor: row.onRowClick ? 'pointer' : 'default',
                }}>
                {/* Name */}
                <div className="flex items-center gap-3 min-w-0">
                  <FilePreview path={row.storagePath} previewUrl={previewUrls[row.fileId]} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium" style={{ fontSize: '13px', color: '#202124' }}>
                      {row.docName}
                      {row.versionNumber && row.versionNumber > 1 && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: '#e8f0fe', color: '#1a73e8' }}>
                          v{row.versionNumber}
                        </span>
                      )}
                    </p>
                    <p className="truncate" style={{ fontSize: '11px', color: '#9aa0a6' }}>
                      {getDisplayName(row)}
                    </p>
                  </div>
                </div>

                {/* Secondary */}
                <div className="min-w-0">
                  {row.secondaryMain ? (
                    <div>
                      <button
                        onClick={e => { e.stopPropagation(); row.onSecondaryClick?.() }}
                        className="flex items-center gap-1 text-left w-full truncate"
                        style={{
                          fontSize: '12px',
                          color: row.onSecondaryClick ? '#1a73e8' : '#5f6368',
                          cursor: row.onSecondaryClick ? 'pointer' : 'default',
                        }}>
                        <span className="truncate">{row.secondaryMain}</span>
                      </button>
                      {row.secondarySub && (
                        <p className="truncate" style={{ fontSize: '11px', color: '#9aa0a6' }}>{row.secondarySub}</p>
                      )}
                    </div>
                  ) : (
                    <p style={{ fontSize: '12px', color: '#9aa0a6', fontStyle: 'italic' }}>General</p>
                  )}
                </div>

                {/* Status */}
                <div><StatusPill status={row.docStatus} /></div>

                {/* Date */}
                <p style={{ fontSize: '12px', color: '#5f6368' }}>{formatDate(row.uploadedAt)}</p>

                {/* Download */}
                <div className="flex items-center justify-end" onClick={e => e.stopPropagation()}>
                  {hoveredId === row.id && (
                    <button
                      onClick={e => handleDownload(e, row.fileId)}
                      disabled={downloading === row.fileId}
                      className="p-1.5 rounded-full transition-colors"
                      style={{ color: '#5f6368' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      title="Descarcă">
                      {downloading === row.fileId
                        ? <span className="w-4 h-4 border-2 rounded-full animate-spin block" style={{ borderColor: '#dadce0', borderTopColor: '#1a73e8' }} />
                        : <Download className="w-4 h-4" />
                      }
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

        ) : (
          /* ══ GRID VIEW ══ */
          <div className="p-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {sorted.map(row => (
              <div key={row.id}
                onMouseEnter={() => setHoveredId(row.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => row.onRowClick?.()}
                className="flex flex-col rounded-xl border transition-all overflow-hidden"
                style={{
                  borderColor: hoveredId === row.id ? '#1a73e8' : '#e0e0e0',
                  backgroundColor: hoveredId === row.id ? '#f8f9fa' : '#fff',
                  boxShadow: hoveredId === row.id ? '0 2px 8px rgba(0,0,0,.12)' : 'none',
                  cursor: row.onRowClick ? 'pointer' : 'default',
                }}>
                {/* Preview area */}
                <div className="relative overflow-hidden" style={{ height: '130px', backgroundColor: '#f8f9fa' }}>
                  {isImageExt(getExt(row.storagePath)) && previewUrls[row.fileId] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrls[row.fileId]} alt={row.docName}
                      className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <FileIconDrive path={row.storagePath} size="lg" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="px-3 py-2.5 border-t flex items-start gap-2" style={{ borderColor: '#e0e0e0' }}>
                  <div className="flex-shrink-0 mt-0.5">
                    <FileIconDrive path={row.storagePath} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium leading-tight" style={{ fontSize: '12px', color: '#202124' }}>
                      {row.docName}
                    </p>
                    {row.secondaryMain && (
                      <p className="truncate mt-0.5" style={{ fontSize: '10px', color: '#9aa0a6' }}>{row.secondaryMain}</p>
                    )}
                    <p className="mt-0.5" style={{ fontSize: '10px', color: '#9aa0a6' }}>{formatDate(row.uploadedAt)}</p>
                  </div>
                  <div onClick={e => e.stopPropagation()} className="flex-shrink-0">
                    {hoveredId === row.id && (
                      <button
                        onClick={e => handleDownload(e, row.fileId)}
                        disabled={downloading === row.fileId}
                        className="p-1 rounded-full"
                        style={{ color: '#5f6368' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Status */}
                <div className="px-3 pb-2.5">
                  <StatusPill status={row.docStatus} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
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
        </div>
      )}
    </div>
  )
}
