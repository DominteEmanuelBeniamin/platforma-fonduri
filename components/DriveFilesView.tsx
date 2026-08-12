'use client'

import { useMemo, useState, useRef, useEffect } from 'react'
import {
  FileText, FileSpreadsheet, Image as ImageIcon,
  Download, Eye,
  Search, FolderOpen, ChevronDown, Grid3X3, List,
} from 'lucide-react'
import { isPreviewableFile, buildPreviewPageUrl, openInNewTab } from '@/lib/file-preview'
import { useToast } from '@/app/providers/ToastProvider'

// ── Public types ──────────────────────────────────────────────────────────────

export interface DriveRow {
  id: string           // unique row key
  fileId?: string      // used for file download + image preview API
  requestId?: string   // used for request attachment download
  attachmentId?: string // identifies one attachment when a request has multiple
  downloadKind?: 'file' | 'requestAttachment'
  storagePath: string  // determines file type icon + image detection
  displayName?: string
  versionNumber?: number
  uploadedAt: string

  docName: string
  entryType?: 'submission_file' | 'request_attachment' | 'outgoing_document'
  entryLabel?: string
  docStatus: 'pending' | 'review' | 'approved' | 'rejected' | 'sent' | null

  // optional secondary column (phase or project)
  secondaryMain?: string      // bold line
  secondarySub?: string       // dimmer sub-line
  onSecondaryClick?: () => void

  // optional row click (e.g. open request modal)
  onRowClick?: () => void
}

export interface DriveAsset {
  id: string
  fileId?: string
  requestId?: string
  attachmentId?: string
  downloadKind: 'file' | 'requestAttachment'
  storagePath: string
  displayName?: string
  versionNumber?: number
  uploadedAt: string
  entryType?: DriveRow['entryType']
  entryLabel?: string
}

export interface DriveVersion {
  version: number
  assets: DriveAsset[]
  createdAt: string
}

export interface DriveDocument {
  id: string
  requestId: string
  docName: string
  docStatus: DriveRow['docStatus']
  folderId: string
  folderName: string
  folderOrderIndex: number
  activityName?: string
  uploadedAt: string
  attachments: DriveAsset[]
  versions: DriveVersion[]
  publicationStatus?: 'published' | 'unpublished'
  publicationReason?: string
  onRowClick?: () => void
}

export interface DriveFolder {
  id: string
  name: string
  orderIndex: number
  documentCount: number
}

interface DriveFilesViewProps {
  rows: DriveRow[]
  documents?: DriveDocument[]
  folders?: DriveFolder[]
  logicalMode?: 'folders' | 'flat'
  storageKey?: string
  activeFolderId?: string | null
  onFolderChange?: (folderId: string | null) => void
  loading?: boolean
  error?: string | null
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

function StatusPill({ status, label }: { status: DriveRow['docStatus']; label?: string }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
        style={{ backgroundColor: '#f1f3f4', color: '#5f6368' }}>
        {label || 'Fără status'}
      </span>
    )
  }

  const map = {
    approved: { label: 'Aprobat',       bg: '#e6f4ea', text: '#137333', dot: '#34a853' },
    rejected: { label: 'Respins',       bg: '#fce8e6', text: '#c5221f', dot: '#ea4335' },
    review:   { label: 'În verificare', bg: '#e8f0fe', text: '#1a73e8', dot: '#4285f4' },
    pending:  { label: 'În așteptare',  bg: '#fef7e0', text: '#b06000', dot: '#fbbc04' },
    sent:     { label: 'Trimis clientului', bg: '#e6f4ea', text: '#137333', dot: '#34a853' },
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

function PublicationPill({ reason }: { reason?: string }) {
  return (
    <span
      title={reason || 'Documentul nu este publicat'}
      aria-label={reason || 'Documentul nu este publicat'}
      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
    >
      Nepublicat
    </span>
  )
}

function getAssetDisplayName(asset: Pick<DriveAsset, 'displayName' | 'storagePath'>) {
  const displayName = asset.displayName?.trim()
  if (displayName) return displayName
  return asset.storagePath.split('/').filter(Boolean).pop() || 'fisier'
}

function assetActionId(asset: DriveAsset) {
  return asset.downloadKind === 'requestAttachment'
    ? `attachment-${asset.requestId}-${asset.attachmentId || asset.id}`
    : asset.fileId || asset.id
}

function LogicalDriveFilesView({
  documents,
  folders,
  apiFetch,
  logicalMode = 'folders',
  storageKey,
  activeFolderId,
  onFolderChange,
  loading = false,
  error = null,
}: Pick<DriveFilesViewProps, 'documents' | 'folders' | 'apiFetch' | 'storageKey' | 'activeFolderId' | 'onFolderChange' | 'loading' | 'error'> & { logicalMode?: 'folders' | 'flat' }) {
  const { showToast } = useToast()
  const [browseMode, setBrowseMode] = useState<'folders' | 'flat'>(logicalMode)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState<string | null>(null)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const fetchedIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!storageKey) return
    try {
      const saved = window.sessionStorage.getItem(`drive-view:${storageKey}`)
      if (saved === 'folders' || saved === 'flat') setBrowseMode(saved)
    } catch { /* sessionStorage can be unavailable in privacy modes */ }
  }, [storageKey])

  const allAssets = useMemo(() => (documents ?? []).flatMap(document => [
    ...document.attachments,
    ...document.versions.flatMap(version => version.assets),
  ]), [documents])

  useEffect(() => {
    allAssets.forEach(asset => {
      if (asset.downloadKind === 'requestAttachment' || !asset.fileId) return
      if (!isImageExt(getExt(asset.storagePath)) || fetchedIds.current.has(asset.fileId)) return
      fetchedIds.current.add(asset.fileId)
      ;(async () => {
        try {
          const response = await apiFetch(`/api/files/${asset.fileId}/signed-download`, {
            method: 'POST',
            body: JSON.stringify({ expiresIn: 600 }),
          })
          if (response.ok) {
            const { url } = await response.json()
            setPreviewUrls(previous => ({ ...previous, [asset.fileId!]: url }))
          }
        } catch { /* image preview is optional */ }
      })()
    })
  }, [allAssets, apiFetch])

  const setMode = (mode: 'folders' | 'flat') => {
    setBrowseMode(mode)
    if (storageKey) {
      try { window.sessionStorage.setItem(`drive-view:${storageKey}`, mode) } catch { /* ignore */ }
    }
  }

  const selectedFolder = folders?.find(folder => folder.id === activeFolderId) ?? null
  const effectiveFolderId = selectedFolder ? activeFolderId : null
  const hasSearch = search.trim().length > 0

  useEffect(() => {
    if (activeFolderId && !selectedFolder) onFolderChange?.(null)
  }, [activeFolderId, onFolderChange, selectedFolder])

  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase()
    const source = !hasSearch && browseMode === 'folders' && effectiveFolderId
      ? (documents ?? []).filter(document => document.folderId === effectiveFolderId)
      : documents ?? []

    return source.filter(document => {
      if (filterStatus !== 'all' && document.docStatus !== filterStatus) return false
      if (!query) return true
      return `${document.docName} ${document.folderName} ${document.activityName || ''}`
        .toLowerCase()
        .includes(query)
    })
  }, [browseMode, documents, effectiveFolderId, filterStatus, hasSearch, search])

  const sortedDocuments = useMemo(() => [...filteredDocuments].sort((a, b) => {
    let comparison = 0
    if (sortKey === 'name') comparison = a.docName.localeCompare(b.docName)
    if (sortKey === 'status') comparison = (a.docStatus ?? '').localeCompare(b.docStatus ?? '')
    if (sortKey === 'date') comparison = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
    if (sortKey === 'secondary') {
      comparison = a.folderOrderIndex - b.folderOrderIndex || a.folderName.localeCompare(b.folderName)
    }
    return sortDir === 'asc' ? comparison : -comparison
  }), [filteredDocuments, sortDir, sortKey])

  const changeSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(previous => previous === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const fetchSignedUrl = async (asset: DriveAsset, disposition?: 'inline') => {
    const endpoint = asset.downloadKind === 'requestAttachment'
      ? `/api/document-requests/${asset.requestId}/attachment/signed-download`
      : `/api/files/${asset.fileId}/signed-download`
    const response = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        expiresIn: 300,
        ...(disposition ? { disposition } : {}),
        ...(asset.attachmentId ? { attachment_id: asset.attachmentId } : {}),
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      showToast('Nu am putut descărca fișierul. Reîncearcă.', 'error')
      return null
    }
    return data.url as string
  }

  const downloadAsset = async (asset: DriveAsset) => {
    const actionId = assetActionId(asset)
    setDownloading(actionId)
    try {
      const url = await fetchSignedUrl(asset)
      if (!url) return
      const link = document.createElement('a')
      link.href = url
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      setDownloading(null)
    }
  }

  const openAsset = (asset: DriveAsset) => {
    if (!isPreviewableFile({ fileName: getAssetDisplayName(asset) })) return
    openInNewTab(buildPreviewPageUrl({
      type: asset.downloadKind === 'requestAttachment' ? 'attachment' : 'file',
      id: asset.downloadKind === 'requestAttachment' ? asset.requestId! : asset.fileId!,
      name: getAssetDisplayName(asset),
      attachmentId: asset.attachmentId,
    }))
  }

  const toggleExpanded = (id: string) => setExpandedIds(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const renderAsset = (asset: DriveAsset) => {
    const actionId = assetActionId(asset)
    const previewable = isPreviewableFile({ fileName: getAssetDisplayName(asset) })
    return (
      <div key={asset.id} className="flex items-center gap-3 px-3 py-2 border-t border-slate-100">
        <FilePreview path={asset.storagePath} previewUrl={asset.fileId ? previewUrls[asset.fileId] : undefined} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{getAssetDisplayName(asset)}</p>
          <p className="truncate text-xs text-slate-400">
            {asset.entryLabel || (asset.downloadKind === 'requestAttachment' ? 'Atașament' : 'Fișier încărcat')}
            {asset.versionNumber ? ` · v${asset.versionNumber}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {previewable && (
            <button type="button" onClick={() => openAsset(asset)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600" title="Deschide" aria-label={`Deschide ${getAssetDisplayName(asset)}`}>
              <Eye className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => downloadAsset(asset)} disabled={downloading === actionId} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50" title="Descarcă" aria-label={`Descarcă ${getAssetDisplayName(asset)}`}>
            {downloading === actionId ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" /> : <Download className="h-4 w-4" />}
          </button>
        </div>
      </div>
    )
  }

  const selectDocument = (document: DriveDocument) => {
    document.onRowClick?.()
  }

  const renderDocument = (document: DriveDocument) => {
    const currentVersion = document.versions[0]
    const currentAssets = [...document.attachments, ...(currentVersion?.assets ?? [])]
    const hasHistory = document.versions.length > 1
    const expanded = expandedIds.has(document.id)
    const totalAssetCount = document.attachments.length + document.versions.reduce((count, version) => count + version.assets.length, 0)
    const historyVersionCount = document.versions.length - 1

    return (
      <article key={document.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 p-3">
          <FilePreview
            path={currentAssets[0]?.storagePath || 'document'}
            previewUrl={currentAssets[0]?.fileId ? previewUrls[currentAssets[0].fileId] : undefined}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => selectDocument(document)} className="block max-w-full cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600" aria-label={`Deschide cererea ${document.docName}`} title="Deschide cererea de document">
              <p className="truncate text-sm font-semibold text-slate-900 hover:text-indigo-700 hover:underline">{document.docName}</p>
            </button>
            <div className="flex min-w-0 items-center gap-1 truncate text-xs text-slate-500">
              <span className="truncate">{document.folderName}</span>
              {document.activityName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{document.activityName}</span>
                </>
              )}
              {currentVersion?.version ? <><span aria-hidden="true">·</span><span>v{currentVersion.version}</span></> : null}
            </div>
          </div>
          {document.publicationStatus === 'unpublished' && <PublicationPill reason={document.publicationReason} />}
          <StatusPill status={document.docStatus} />
          {hasHistory && (
            <button type="button" onClick={() => toggleExpanded(document.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600" aria-expanded={expanded} aria-controls={`drive-document-${document.id}`}>
              {expanded ? 'Ascunde istoricul' : `Vezi istoricul · ${document.versions.length} versiuni / ${totalAssetCount} fișiere`}
            </button>
          )}
        </div>
        <div id={`drive-document-${document.id}`}>
          {currentAssets.map(renderAsset)}
          {expanded && hasHistory && document.versions.slice(1).map(version => (
            <div key={version.version} className="border-t border-slate-200 bg-slate-50">
              <p className="px-3 py-2 text-xs font-semibold text-slate-500">Varianta {version.version}</p>
              {version.assets.map(renderAsset)}
            </div>
          ))}
        </div>
      </article>
    )
  }

  const renderToolbar = () => (
    <div className="flex-shrink-0 px-4 pt-4 pb-2">
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Caută în documente" aria-label="Caută în documente" className="w-full rounded-full bg-slate-100 py-2.5 pl-12 pr-10 text-sm text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-200" />
        {search && <button type="button" onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" aria-label="Golește căutarea">×</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {browseMode === 'folders' && (
          <button type="button" onClick={() => setMode('flat')} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">Listă plată</button>
        )}
        {browseMode === 'flat' && (
          <button type="button" onClick={() => setMode('folders')} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">Dosare</button>
        )}
        <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)} aria-label="Filtrează după status" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-indigo-200">
          <option value="all">Status</option>
          <option value="pending">În așteptare</option>
          <option value="review">În verificare</option>
          <option value="approved">Aprobate</option>
          <option value="rejected">Respinse</option>
          <option value="sent">Trimise clientului</option>
        </select>
        <select value={sortKey} onChange={event => changeSort(event.target.value as SortKey)} aria-label="Sortează documentele" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-indigo-200">
          <option value="name">Nume</option>
          <option value="secondary">Folder</option>
          <option value="status">Status</option>
          <option value="date">Dată</option>
        </select>
        <button type="button" onClick={() => changeSort(sortKey)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600" aria-label={`Ordine ${sortDir === 'asc' ? 'crescătoare' : 'descrescătoare'}`}>
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
        <span className="flex-1" />
        <span className="text-xs text-slate-500">{sortedDocuments.length} {sortedDocuments.length === 1 ? 'document' : 'documente'}</span>
        <div className="flex overflow-hidden rounded-full border border-slate-200">
          {(['list', 'grid'] as ViewMode[]).map(mode => <button type="button" key={mode} onClick={() => setViewMode(mode)} className={`p-1.5 ${viewMode === mode ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600`} aria-label={mode === 'list' ? 'Vedere listă' : 'Vedere grilă'} aria-pressed={viewMode === mode}>{mode === 'list' ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}</button>)}
        </div>
      </div>
    </div>
  )

  if (loading) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">Se încarcă documentele…</div>
  }
  if (error) {
    return <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center"><p className="font-semibold text-slate-800">Documentele nu au putut fi încărcate</p><p className="text-sm text-slate-500">{error}</p></div>
  }

  const showFolders = browseMode === 'folders' && !effectiveFolderId && !hasSearch
  const noResults = sortedDocuments.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-white" style={{ fontFamily: "'Google Sans', Roboto, Arial, sans-serif" }}>
      {renderToolbar()}
      {browseMode === 'folders' && (effectiveFolderId || hasSearch) && (
        <div className="flex items-center gap-2 px-4 pb-3 text-sm">
          <button type="button" onClick={() => onFolderChange?.(null)} className="font-semibold text-indigo-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">Drive</button>
          {selectedFolder && <><span className="text-slate-400">/</span><span className="font-semibold text-slate-700">{selectedFolder.name}</span></>}
          {hasSearch && <span className="text-xs text-slate-400">· rezultate în tot proiectul</span>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {showFolders ? (
          (folders ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center"><FolderOpen className="mb-4 h-16 w-16 text-slate-200" /><p className="font-semibold text-slate-700">Nu există foldere</p><p className="text-sm text-slate-500">Documentele vor apărea aici când vor fi disponibile.</p></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(folders ?? []).map(folder => <button type="button" key={folder.id} onClick={() => onFolderChange?.(folder.id)} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"><FolderOpen className="h-8 w-8 flex-shrink-0 text-indigo-500" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-800">{folder.name}</span><span className="text-xs text-slate-500">{folder.documentCount} {folder.documentCount === 1 ? 'document' : 'documente'}</span></span><span className="text-slate-300">›</span></button>)}
            </div>
          )
        ) : noResults ? (
          <div className="flex flex-col items-center justify-center py-24 text-center"><FolderOpen className="mb-4 h-16 w-16 text-slate-200" /><p className="font-semibold text-slate-700">{hasSearch || filterStatus !== 'all' ? 'Niciun rezultat' : 'Folder gol'}</p><p className="text-sm text-slate-500">{hasSearch || filterStatus !== 'all' ? 'Încearcă să modifici filtrele.' : 'Fișierele vor apărea aici când vor fi încărcate.'}</p></div>
        ) : viewMode === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{sortedDocuments.map(renderDocument)}</div>
        ) : (
          <div className="space-y-3">{sortedDocuments.map(renderDocument)}</div>
        )}
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriveFilesView({
  rows,
  documents,
  folders,
  logicalMode = 'folders',
  storageKey,
  activeFolderId,
  onFolderChange,
  loading = false,
  error = null,
  secondaryColumnLabel = 'Info',
  apiFetch,
  emptyText = 'Niciun document',
  standalone = false,
}: DriveFilesViewProps) {
  const { showToast } = useToast()
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
      if (row.downloadKind === 'requestAttachment') return
      if (!row.fileId) return
      const fileId = row.fileId
      if (!isImageExt(getExt(row.storagePath))) return
      if (fetchedIds.current.has(fileId)) return
      fetchedIds.current.add(fileId)
      ;(async () => {
        try {
          const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
            method: 'POST', body: JSON.stringify({ expiresIn: 600 }), // plafon server-side
          })
          if (res.ok) {
            const { url } = await res.json()
            setPreviewUrls(prev => ({ ...prev, [fileId]: url }))
          }
        } catch { /* silent */ }
      })()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  function rowActionId(row: DriveRow) {
    return row.downloadKind === 'requestAttachment'
      ? `attachment-${row.requestId}-${row.attachmentId || row.id}`
      : row.fileId!
  }

  function isRowPreviewable(row: DriveRow) {
    return isPreviewableFile({ fileName: row.displayName }) || isPreviewableFile({ fileName: row.storagePath })
  }

  async function fetchSignedUrl(row: DriveRow, disposition?: 'inline') {
    const endpoint = row.downloadKind === 'requestAttachment'
      ? `/api/document-requests/${row.requestId}/attachment/signed-download`
      : `/api/files/${row.fileId!}/signed-download`

    const res = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        expiresIn: 300,
        ...(disposition ? { disposition } : {}),
        ...(row.attachmentId ? { attachment_id: row.attachmentId } : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast('Nu am putut descărca fișierul. Reîncearcă.', 'error'); return null }
    return data.url as string
  }

  async function handleDownload(e: React.MouseEvent, row: DriveRow) {
    e.stopPropagation()
    if (row.downloadKind === 'requestAttachment' && !row.requestId) return
    if (row.downloadKind !== 'requestAttachment' && !row.fileId) return

    setDownloading(rowActionId(row))
    try {
      const url = await fetchSignedUrl(row)
      if (!url) return
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
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
      attachmentId: row.attachmentId,
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

  if (documents) {
    return (
      <LogicalDriveFilesView
        documents={documents}
        folders={folders}
        apiFetch={apiFetch}
        logicalMode={logicalMode}
        storageKey={storageKey}
        activeFolderId={activeFolderId}
        onFolderChange={onFolderChange}
        loading={loading}
        error={error}
      />
    )
  }

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
              <option value="sent">Trimise clientului</option>
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
            {sorted.length !== rows.length ? `${sorted.length} din ` : ''}{rows.length} {rows.length === 1 ? 'intrare' : 'intrări'}
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
              gridTemplateColumns: '3fr 1.5fr 1fr 1fr 72px',
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
                  gridTemplateColumns: '3fr 1.5fr 1fr 1fr 72px',
                  gap: '8px',
                  backgroundColor: hoveredId === row.id ? '#f8f9fa' : 'transparent',
                  borderBottom: '1px solid #f1f3f4',
                  cursor: row.onRowClick ? 'pointer' : 'default',
                }}>
                {/* Name */}
                <div className="flex items-center gap-3 min-w-0">
                  <FilePreview path={row.storagePath} previewUrl={row.fileId ? previewUrls[row.fileId] : undefined} size="sm" />
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
                      {row.entryLabel ? `${row.entryLabel} · ` : ''}{getDisplayName(row)}
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
                <div><StatusPill status={row.docStatus} label={row.entryLabel} /></div>

                {/* Date */}
                <p style={{ fontSize: '12px', color: '#5f6368' }}>{formatDate(row.uploadedAt)}</p>

                {/* Actions */}
                <div className="flex items-center justify-end gap-0.5" onClick={e => e.stopPropagation()}>
                  {hoveredId === row.id && isRowPreviewable(row) && (
                    <button
                      onClick={e => handleOpen(e, row)}
                      className="p-1.5 rounded-full transition-colors"
                      style={{ color: '#5f6368' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      title="Deschide în tab nou">
                      <Eye className="w-4 h-4" />
                    </button>
                  )}
                  {hoveredId === row.id && (
                    <button
                      onClick={e => handleDownload(e, row)}
                      disabled={downloading === rowActionId(row)}
                      className="p-1.5 rounded-full transition-colors"
                      style={{ color: '#5f6368' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      title="Descarcă">
                      {downloading === rowActionId(row)
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
                  {row.fileId && isImageExt(getExt(row.storagePath)) && previewUrls[row.fileId] ? (
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
                    <p className="mt-0.5" style={{ fontSize: '10px', color: '#9aa0a6' }}>
                      {row.entryLabel ? `${row.entryLabel} · ` : ''}{formatDate(row.uploadedAt)}
                    </p>
                  </div>
                  <div onClick={e => e.stopPropagation()} className="flex-shrink-0 flex items-center">
                    {hoveredId === row.id && isRowPreviewable(row) && (
                      <button
                        onClick={e => handleOpen(e, row)}
                        className="p-1 rounded-full"
                        style={{ color: '#5f6368' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        title="Deschide în tab nou">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {hoveredId === row.id && (
                      <button
                        onClick={e => handleDownload(e, row)}
                        disabled={downloading === rowActionId(row)}
                        className="p-1 rounded-full"
                        style={{ color: '#5f6368' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e8eaed'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        title="Descarcă">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
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
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: '#e0e0e0' }}>
          <div className="flex items-center gap-4">
            {[
              { label: 'Aprobate',      val: stats.approved, color: '#137333' },
              { label: 'Trimise clientului', val: stats.sent, color: '#137333' },
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
