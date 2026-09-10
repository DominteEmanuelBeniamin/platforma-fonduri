'use client'

import { fetchDriveSignedUrl, useDriveImagePreviews, DOWNLOAD_ERROR } from './signed-url'
import { useMemo, useState } from 'react'
import {
  Download, Eye,
  Search, FolderOpen, ChevronDown, Grid3X3, List,
} from 'lucide-react'
import { isPreviewableFile, buildPreviewPageUrl, openInNewTab, downloadUrl } from '@/lib/file-preview'
import { useToast } from '@/app/providers/ToastProvider'
import type {
  DriveRow,
  DriveFilesViewProps,
  SortKey, SortDir, ViewMode,
} from './types'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate } from '@/lib/signage'
import {
  getExt, isImageExt, getDisplayName,
  FileIconDrive, FilePreview, StatusPill,
} from './parts'

/**
 * Vederea plată: un singur tabel de fișiere, folosit acolo unde nu există
 * structură de dosare — fișa unui utilizator, de pildă. 471 de linii.
 */
export default function FlatDriveFilesView({
  rows = [],
  secondaryColumnLabel = 'Info',
  apiFetch,
  emptyText = 'Niciun document',
  standalone = false,
}: Pick<DriveFilesViewProps, 'rows' | 'secondaryColumnLabel' | 'apiFetch' | 'emptyText' | 'standalone'>) {
  const { showToast } = useToast()
  const [search, setSearch]               = useState('')
  const [filterStatus, setFilterStatus]   = useState('all')
  const [filterSecondary, setFilterSecondary] = useState('all')
  const [sortKey, setSortKey]             = useState<SortKey>('date')
  const [sortDir, setSortDir]             = useState<SortDir>('desc')
  const [viewMode, setViewMode]           = useState<ViewMode>('list')
  const [downloading, setDownloading]     = useState<string | null>(null)
  const previewUrls = useDriveImagePreviews(apiFetch, rows)

  function rowActionId(row: DriveRow) {
    return row.downloadKind === 'requestAttachment'
      ? `attachment-${row.requestId}-${row.id}`
      : row.fileId!
  }

  function isRowPreviewable(row: DriveRow) {
    return isPreviewableFile({ fileName: row.displayName }) || isPreviewableFile({ fileName: row.storagePath })
  }

  async function handleDownload(e: React.MouseEvent, row: DriveRow) {
    e.stopPropagation()
    if (row.downloadKind === 'requestAttachment' && !row.requestId) return
    if (row.downloadKind !== 'requestAttachment' && !row.fileId) return

    setDownloading(rowActionId(row))
    try {
      const url = await fetchDriveSignedUrl(apiFetch, row)
      if (!url) { showToast(DOWNLOAD_ERROR, 'error'); return }
      downloadUrl(url)
    } finally { setDownloading(null) }
  }

  function handleOpen(e: React.MouseEvent, row: DriveRow) {
    e.stopPropagation()
    if (row.downloadKind === 'requestAttachment' && !row.requestId) return
    if (row.downloadKind !== 'requestAttachment' && !row.fileId) return

    openInNewTab(buildPreviewPageUrl({
      type: row.downloadKind === 'requestAttachment' ? 'attachment' : 'file',
      id: row.downloadKind === 'requestAttachment' ? row.requestId! : row.fileId!,
      name: getDisplayName(row),
    }))
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
    if (sortKey === 'status')    cmp = (a.docStatus ?? '').localeCompare(b.docStatus ?? '')
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
    submissions: rows.filter(r => r.docStatus !== null).length,
    attachments: rows.filter(r => r.docStatus === null).length,
    approved: rows.filter(r => r.docStatus === 'approved').length,
    review:   rows.filter(r => r.docStatus === 'review').length,
    pending:  rows.filter(r => r.docStatus === 'pending').length,
    sent:     rows.filter(r => r.docStatus === 'sent').length,
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
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Caută în documente"
            aria-label="Caută în documente"
            className="w-full rounded-full bg-paper-sunk py-2.5 pl-12 pr-10 text-sm text-ink outline-none focus:bg-white focus:ring-2 focus:ring-[var(--sg-accent)]"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-soft" aria-label="Golește căutarea">×</button>
          )}
        </div>

        {/* Filter chips + view toggle */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status */}
          <div className="relative">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              aria-label="Filtrează după status"
              className={`min-h-9 cursor-pointer appearance-none rounded-full border py-1.5 pl-3 pr-8 text-xs outline-none focus:ring-2 focus:ring-[var(--sg-accent)] ${
                filterStatus !== 'all'
                  ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]'
                  : 'border-rule bg-white text-ink-soft'
              }`}
            >
              <option value="all">Toate statusurile</option>
              <option value="pending">În așteptare</option>
              <option value="sent">Trimise clientului</option>
              <option value="review">În verificare</option>
              <option value="approved">Aprobate</option>
              <option value="rejected">Respinse</option>
            </select>
            <ChevronDown className={`pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${filterStatus !== 'all' ? 'text-[var(--sg-accent)]' : 'text-ink-faint'}`} />
          </div>

          {/* Secondary filter */}
          {(secondaryOptions.length > 1 || (secondaryOptions.length > 0 && hasUnassigned)) && (
            <div className="relative">
              <select
                value={filterSecondary}
                onChange={e => setFilterSecondary(e.target.value)}
                aria-label={`Filtrează după ${secondaryColumnLabel.toLowerCase()}`}
                className={`min-h-9 max-w-[180px] cursor-pointer appearance-none rounded-full border py-1.5 pl-3 pr-8 text-xs outline-none focus:ring-2 focus:ring-[var(--sg-accent)] ${
                  filterSecondary !== 'all'
                    ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]'
                    : 'border-rule bg-white text-ink-soft'
                }`}
              >
                <option value="all">{secondaryColumnLabel}</option>
                {secondaryOptions.map(o => <option key={o} value={o}>{o}</option>)}
                {hasUnassigned && <option value="__unassigned__">Generale</option>}
              </select>
              <ChevronDown className={`pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${filterSecondary !== 'all' ? 'text-[var(--sg-accent)]' : 'text-ink-faint'}`} />
            </div>
          )}

          <span className="flex-1" />

          <span className="text-xs text-ink-soft">
            {sorted.length !== rows.length ? `${sorted.length} din ` : ''}{rows.length} {rows.length === 1 ? 'intrare' : 'intrări'}
          </span>

          {/* View toggle */}
          <div className="hidden overflow-hidden rounded-full border border-rule sm:flex">
            {(['list', 'grid'] as ViewMode[]).map(mode => (
              <button
                type="button"
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-label={mode === 'list' ? 'Vedere listă' : 'Vedere grilă'}
                aria-pressed={viewMode === mode}
                className={`p-1.5 transition-colors ${
                  viewMode === mode ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]' : 'text-ink-faint hover:bg-paper-sunk'
                }`}
              >
                {mode === 'list' ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className={contentCls}>
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <FolderOpen className="mb-4 h-20 w-20 text-ink-faint" />
            <p className="text-lg font-medium text-ink">
              {search || filterStatus !== 'all' || filterSecondary !== 'all' ? 'Niciun rezultat' : emptyText}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {search || filterStatus !== 'all' || filterSecondary !== 'all'
                ? 'Încearcă să modifici filtrele'
                : 'Documentele uploadate vor apărea aici'}
            </p>
          </div>

        ) : viewMode === 'list' ? (
          /* ══ LIST VIEW ══ */
          <div>
            <div className="grid gap-2 border-b border-rule bg-paper-sunk px-4 py-2" style={{ gridTemplateColumns: '3fr 1.5fr 1fr 1fr 88px' }}>
              {([
                { key: 'name' as SortKey,      label: 'Nume' },
                { key: 'secondary' as SortKey, label: secondaryColumnLabel },
                { key: 'status' as SortKey,    label: 'Status' },
                { key: 'date' as SortKey,      label: 'Dată' },
              ]).map(col => (
                <button
                  type="button"
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  aria-label={`Sortează după ${col.label.toLowerCase()}`}
                  className={`flex items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                    sortKey === col.key ? 'text-[var(--sg-accent)]' : 'text-ink-faint hover:text-ink-soft'
                  }`}
                >
                  {col.label}
                  <span className={`text-[10px] ${sortKey === col.key ? 'opacity-100' : 'opacity-0'}`}>
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                </button>
              ))}
              <div />
            </div>

            {sorted.map(row => (
              <div
                key={row.id}
                onClick={() => row.onRowClick?.()}
                className={`group grid items-center gap-2 border-b border-rule px-4 py-1.5 transition-colors hover:bg-paper-sunk ${row.onRowClick ? 'cursor-pointer' : ''}`}
                style={{ gridTemplateColumns: '3fr 1.5fr 1fr 1fr 88px' }}
              >
                {/* Name */}
                <div className="flex min-w-0 items-center gap-3">
                  <FilePreview path={row.storagePath} previewUrl={row.fileId ? previewUrls[row.fileId] : undefined} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {row.docName}
                      {row.versionNumber && row.versionNumber > 1 && (
                        <span className="ml-1.5 rounded bg-[var(--sg-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--sg-accent)]">
                          v{row.versionNumber}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-ink-faint">
                      {row.entryLabel ? `${row.entryLabel} · ` : ''}{getDisplayName(row)}
                    </p>
                  </div>
                </div>

                {/* Secondary */}
                <div className="min-w-0">
                  {row.secondaryMain ? (
                    <div>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); row.onSecondaryClick?.() }}
                        className={`flex w-full items-center gap-1 truncate text-left text-xs ${
                          row.onSecondaryClick ? 'cursor-pointer text-[var(--sg-accent)] hover:underline' : 'cursor-default text-ink-soft'
                        }`}
                      >
                        <span className="truncate">{row.secondaryMain}</span>
                      </button>
                      {row.secondarySub && (
                        <p className="truncate text-[11px] text-ink-faint">{row.secondarySub}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs italic text-ink-faint">General</p>
                  )}
                </div>

                {/* Status */}
                <div><StatusPill status={row.docStatus} label={row.entryLabel} /></div>

                {/* Date */}
                <p className="text-xs text-ink-soft">{formatDate(row.uploadedAt)}</p>

                {/* Actions — mereu vizibile pe touch, la hover pe desktop */}
                <div
                  className="flex items-center justify-end gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100"
                  onClick={e => e.stopPropagation()}
                >
                  {isRowPreviewable(row) && (
                    <button
                      type="button"
                      onClick={e => handleOpen(e, row)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-[var(--sg-accent)]"
                      title="Deschide în tab nou"
                      aria-label={`Deschide ${getDisplayName(row)}`}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={e => handleDownload(e, row)}
                    disabled={downloading === rowActionId(row)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-[var(--sg-accent)] disabled:opacity-50"
                    title="Descarcă"
                    aria-label={`Descarcă ${getDisplayName(row)}`}
                  >
                    {downloading === rowActionId(row)
                      ? <Spinner size="sm" />
                      : <Download className="h-4 w-4" />
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>

        ) : (
          /* ══ GRID VIEW ══ */
          <div className="grid gap-4 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {sorted.map(row => (
              <div
                key={row.id}
                onClick={() => row.onRowClick?.()}
                className={`group flex flex-col overflow-hidden rounded-xl border border-rule bg-white transition-all hover:border-[var(--sg-accent)] hover:bg-paper-sunk hover:shadow-md ${row.onRowClick ? 'cursor-pointer' : ''}`}
              >
                {/* Preview area */}
                <div className="relative h-[130px] overflow-hidden bg-paper-sunk">
                  {row.fileId && isImageExt(getExt(row.storagePath)) && previewUrls[row.fileId] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrls[row.fileId]} alt={row.docName}
                      className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <FileIconDrive path={row.storagePath} size="lg" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex items-start gap-2 border-t border-rule px-3 py-2.5">
                  <div className="mt-0.5 flex-shrink-0">
                    <FileIconDrive path={row.storagePath} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium leading-tight text-ink">
                      {row.docName}
                    </p>
                    {row.secondaryMain && (
                      <p className="mt-0.5 truncate text-[10px] text-ink-faint">{row.secondaryMain}</p>
                    )}
                    <p className="mt-0.5 text-[10px] text-ink-faint">
                      {row.entryLabel ? `${row.entryLabel} · ` : ''}{formatDate(row.uploadedAt)}
                    </p>
                  </div>
                  <div
                    onClick={e => e.stopPropagation()}
                    className="flex flex-shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100"
                  >
                    {isRowPreviewable(row) && (
                      <button
                        type="button"
                        onClick={e => handleOpen(e, row)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-[var(--sg-accent)]"
                        title="Deschide în tab nou"
                        aria-label={`Deschide ${getDisplayName(row)}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={e => handleDownload(e, row)}
                      disabled={downloading === rowActionId(row)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-[var(--sg-accent)] disabled:opacity-50"
                      title="Descarcă"
                      aria-label={`Descarcă ${getDisplayName(row)}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Status */}
                <div className="px-3 pb-2.5">
                  <StatusPill status={row.docStatus} label={row.entryLabel} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      {rows.length > 0 && (
        <div className="flex flex-shrink-0 items-center justify-between border-t border-rule px-4 py-2">
          <div className="flex flex-wrap items-center gap-4">
            {[
              { label: 'Aprobate',           val: stats.approved, text: 'text-[var(--sg-ok)]', dot: 'bg-[var(--sg-ok)]' },
              { label: 'Trimise clientului', val: stats.sent,     text: 'text-[var(--sg-ok)]', dot: 'bg-[var(--sg-ok)]' },
              { label: 'În verificare',      val: stats.review,   text: 'text-[var(--sg-accent)]',  dot: 'bg-[var(--sg-accent)]' },
              { label: 'În așteptare',       val: stats.pending,  text: 'text-[var(--sg-warn)]',   dot: 'bg-[var(--sg-warn)]' },
              { label: 'Respinse',           val: stats.rejected, text: 'text-[var(--sg-danger)]',     dot: 'bg-[var(--sg-danger)]' },
            ].filter(s => s.val > 0).map(s => (
              <span key={s.label} className={`flex items-center gap-1.5 text-xs ${s.text}`}>
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                {s.val} {s.label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
