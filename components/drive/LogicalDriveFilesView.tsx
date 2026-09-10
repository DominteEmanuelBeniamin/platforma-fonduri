'use client'

import { fetchDriveSignedUrl, useDriveImagePreviews, DOWNLOAD_ERROR } from './signed-url'
import { useMemo, useState, useEffect } from 'react'
import {
  Download, Eye, ArrowLeft, RefreshCw,
  Search, FolderOpen, List,
} from 'lucide-react'
import { isPreviewableFile, buildPreviewPageUrl, openInNewTab, downloadUrl } from '@/lib/file-preview'
import { useToast } from '@/app/providers/ToastProvider'
import type {
  DriveAsset, DriveDocument,
  DriveLogicalProps,
  SortKey, SortDir,
} from './types'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate } from '@/lib/signage'
import {
  FilePreview, StatusPill, PublicationPill,
  getAssetDisplayName, assetActionId,
} from './parts'

/**
 * Vederea pe dosare: fiecare fază are dosarul ei, cu documentele și
 * versiunile lor. A stat 396 de linii în `DriveFilesView`.
 */
export default function LogicalDriveFilesView({
  documents,
  folders,
  apiFetch,
  storageKey,
  activeFolderId,
  onFolderChange,
  error = null,
  onRetry,
}: Omit<DriveLogicalProps, 'rows' | 'secondaryColumnLabel' | 'emptyText' | 'standalone'>) {
  const { showToast } = useToast()
  const [browseMode, setBrowseMode] = useState<'folders' | 'flat'>('folders')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState<string | null>(null)
  useEffect(() => {
    if (!storageKey) return
    try {
      const saved = window.sessionStorage.getItem(`drive-view:${storageKey}`)
      if (saved === 'folders' || saved === 'flat') setBrowseMode(saved)
    } catch { /* sessionStorage can be unavailable in privacy modes */ }
  }, [storageKey])

  const allAssets = useMemo(() => documents.flatMap(document => [
    ...document.attachments,
    ...document.versions.flatMap(version => version.assets),
  ]), [documents])

  const previewUrls = useDriveImagePreviews(apiFetch, allAssets)

  const setMode = (mode: 'folders' | 'flat') => {
    setBrowseMode(mode)
    if (storageKey) {
      try { window.sessionStorage.setItem(`drive-view:${storageKey}`, mode) } catch { /* ignore */ }
    }
  }

  const selectedFolder = folders.find(folder => folder.id === activeFolderId) ?? null
  const effectiveFolderId = selectedFolder ? activeFolderId : null
  const hasSearch = search.trim().length > 0

  // Curățăm din URL doar folderele care chiar nu există — și doar după ce avem
  // ce compara. Cât timp lista de foldere e goală (datele încă se încarcă) un
  // deep-link valid ar fi șters. Corectarea e `replace`, nu `push`.
  useEffect(() => {
    if (folders.length === 0) return
    if (activeFolderId && !selectedFolder) onFolderChange?.(null, 'correct')
  }, [activeFolderId, folders, onFolderChange, selectedFolder])

  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase()
    const source = !hasSearch && browseMode === 'folders' && effectiveFolderId
      ? documents.filter(document => document.folderId === effectiveFolderId)
      : documents

    return source.filter(document => {
      if (filterStatus !== 'all' && document.docStatus !== filterStatus) return false
      if (!query) return true
      const assetNames = [
        ...document.attachments,
        ...document.versions.flatMap(version => version.assets),
      ].map(getAssetDisplayName).join(' ')
      return `${document.docName} ${document.folderName} ${document.activityName || ''} ${assetNames}`
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

  // Un singur pas înapoi: întâi ieșim din căutare, apoi din folder.
  const goBack = () => {
    if (hasSearch) setSearch('')
    else onFolderChange?.(null)
  }

  const downloadAsset = async (asset: DriveAsset) => {
    const actionId = assetActionId(asset)
    setDownloading(actionId)
    try {
      const url = await fetchDriveSignedUrl(apiFetch, asset)
      if (!url) { showToast(DOWNLOAD_ERROR, 'error'); return }
      downloadUrl(url)
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
      <div key={asset.id} className="flex items-center gap-3 border-t border-rule px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <FilePreview path={asset.storagePath} previewUrl={asset.fileId ? previewUrls[asset.fileId] : undefined} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{getAssetDisplayName(asset)}</p>
            <p className="truncate text-xs text-ink-faint">
              {asset.entryLabel || (asset.downloadKind === 'requestAttachment' ? 'Atașament' : 'Fișier încărcat')}
              {asset.versionNumber ? ` · v${asset.versionNumber}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {previewable && (
            <button type="button" onClick={() => openAsset(asset)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-faint hover:bg-paper-sunk hover:text-[var(--sg-accent)]" title="Deschide" aria-label={`Deschide ${getAssetDisplayName(asset)}`}>
              <Eye className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => downloadAsset(asset)} disabled={downloading === actionId} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-faint hover:bg-paper-sunk hover:text-[var(--sg-accent)] disabled:opacity-50" title="Descarcă" aria-label={`Descarcă ${getAssetDisplayName(asset)}`}>
            {downloading === actionId ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
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

    return (
      <article key={document.id} className="min-w-0 overflow-hidden rounded-xl border border-rule bg-white shadow-sm">
        <div className="flex flex-wrap items-start gap-3 p-3 sm:items-center">
          <div className="flex min-w-0 flex-1 basis-full items-start gap-3 sm:basis-auto sm:items-center">
            <FilePreview
              path={currentAssets[0]?.storagePath || 'document'}
              previewUrl={currentAssets[0]?.fileId ? previewUrls[currentAssets[0].fileId] : undefined}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => selectDocument(document)} className="block w-full cursor-pointer text-left" aria-label={`Deschide cererea ${document.docName}`} title="Deschide cererea de document">
                <p className="break-words text-sm font-semibold text-ink hover:text-[var(--sg-accent)] hover:underline sm:truncate">{document.docName}</p>
              </button>
              <div className="flex min-w-0 items-center gap-1 truncate text-xs text-ink-soft">
                <span className="truncate">{document.folderName}</span>
                {document.activityName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{document.activityName}</span>
                  </>
                )}
                {currentVersion?.version ? <><span aria-hidden="true">·</span><span>v{currentVersion.version}</span></> : null}
                <span aria-hidden="true">·</span>
                <span className="whitespace-nowrap">{formatDate(document.uploadedAt)}</span>
              </div>
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
            {document.publicationStatus === 'unpublished' && <PublicationPill reason={document.publicationReason} />}
            <StatusPill status={document.docStatus} />
            {hasHistory && (
              <button type="button" onClick={() => toggleExpanded(document.id)} className="max-w-full rounded-lg px-2 py-1 text-left text-xs font-semibold text-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)]" aria-expanded={expanded} aria-controls={`drive-document-${document.id}`} aria-label={expanded ? 'Ascunde istoricul' : `Vezi istoricul: ${document.versions.length} versiuni, ${totalAssetCount} fișiere`}>
                <span className="sm:hidden">{expanded ? 'Ascunde istoricul' : `Istoric (${document.versions.length})`}</span>
                <span className="hidden sm:inline">{expanded ? 'Ascunde istoricul' : `Vezi istoricul · ${document.versions.length} versiuni / ${totalAssetCount} fișiere`}</span>
              </button>
            )}
          </div>
        </div>
        <div id={`drive-document-${document.id}`}>
          {currentAssets.map(asset => renderAsset(asset))}
          {expanded && hasHistory && document.versions.slice(1).map(version => (
            <div key={version.version} className="border-t border-rule bg-paper-sunk">
              <p className="px-3 py-2 text-xs font-semibold text-ink-soft">Varianta {version.version}</p>
              {version.assets.map(asset => renderAsset(asset))}
            </div>
          ))}
        </div>
      </article>
    )
  }

  const renderToolbar = () => (
    <div className="flex-shrink-0 px-4 pt-4 pb-2">
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Caută în documente" aria-label="Caută în documente" className="w-full rounded-full bg-paper-sunk py-2.5 pl-12 pr-10 text-sm text-ink outline-none focus:bg-white focus:ring-2 focus:ring-[var(--sg-accent)]" />
        {search && <button type="button" onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint" aria-label="Golește căutarea">×</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-full border border-rule" role="group" aria-label="Mod de afișare">
          {([
            { mode: 'folders' as const, label: 'Dosare', Icon: FolderOpen },
            { mode: 'flat' as const, label: 'Listă', Icon: List },
          ]).map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              aria-pressed={browseMode === mode}
              className={`inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition ${
                browseMode === mode ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]' : 'text-ink-soft hover:bg-paper-sunk'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)} aria-label="Filtrează după status" className="min-h-9 rounded-full border border-rule bg-white px-3 py-1.5 text-xs text-ink-soft outline-none focus:ring-2 focus:ring-[var(--sg-accent)]">
          <option value="all">Toate statusurile</option>
          <option value="pending">În așteptare</option>
          <option value="review">În verificare</option>
          <option value="approved">Aprobate</option>
          <option value="rejected">Respinse</option>
          <option value="sent">Trimise clientului</option>
        </select>
        <select
          value={`${sortKey}:${sortDir}`}
          onChange={event => {
            const [key, direction] = event.target.value.split(':')
            setSortKey(key as SortKey)
            setSortDir(direction as SortDir)
          }}
          aria-label="Sortează documentele"
          className="min-h-9 rounded-full border border-rule bg-white px-3 py-1.5 text-xs text-ink-soft outline-none focus:ring-2 focus:ring-[var(--sg-accent)]"
        >
          <option value="date:desc">Cele mai noi</option>
          <option value="date:asc">Cele mai vechi</option>
          <option value="name:asc">Nume A → Z</option>
          <option value="name:desc">Nume Z → A</option>
          <option value="secondary:asc">După dosar</option>
          <option value="status:asc">După status</option>
        </select>
        <span className="flex-1" />
        <span className="text-xs text-ink-soft">{sortedDocuments.length} {sortedDocuments.length === 1 ? 'document' : 'documente'}</span>
      </div>
    </div>
  )

  // Ecranul plin de eroare doar când chiar n-avem ce arăta. Dacă documentele
  // sunt deja încărcate, un refresh eșuat nu trebuie să le ascundă — altfel
  // singura ieșire era reîncărcarea paginii.
  if (error && documents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-semibold text-ink">Documentele nu au putut fi încărcate</p>
        <p className="text-sm text-ink-soft">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--sg-accent)] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--sg-accent-ink)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Reîncearcă
          </button>
        )}
      </div>
    )
  }

  const showFolders = browseMode === 'folders' && !effectiveFolderId && !hasSearch
  const noResults = sortedDocuments.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-white" style={{ fontFamily: "'Google Sans', Roboto, Arial, sans-serif" }}>
      {renderToolbar()}
      {error && (
        <div role="status" className="mx-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-[var(--sg-warn)]">
            Lista poate fi neactualizată. {error}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-8 flex-shrink-0 items-center gap-1.5 rounded-full border border-[var(--sg-warn)] bg-white px-3 py-1 text-xs font-semibold text-[var(--sg-warn)] transition hover:bg-[var(--sg-warn-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reîncearcă
            </button>
          )}
        </div>
      )}
      {browseMode === 'folders' && (effectiveFolderId || hasSearch) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-3 text-sm">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex min-h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-rule bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-rule-strong hover:bg-paper-sunk"
            aria-label={hasSearch ? 'Înapoi — golește căutarea' : 'Înapoi la lista de dosare'}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Înapoi
          </button>
          <nav aria-label="Cale documente" className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => onFolderChange?.(null)} className="font-semibold text-[var(--sg-accent)] hover:underline">Drive</button>
            {selectedFolder && <><span className="text-ink-faint" aria-hidden="true">/</span><span className="truncate font-semibold text-ink">{selectedFolder.name}</span></>}
            {hasSearch && <span className="whitespace-nowrap text-xs text-ink-faint">· rezultate în tot proiectul</span>}
          </nav>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {showFolders ? (
          folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center"><FolderOpen className="mb-4 h-16 w-16 text-ink-faint" /><p className="font-semibold text-ink">Nu există foldere</p><p className="text-sm text-ink-soft">Documentele vor apărea aici când vor fi disponibile.</p></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {folders.map(folder => <button type="button" key={folder.id} onClick={() => onFolderChange?.(folder.id)} className="flex items-center gap-3 rounded-xl border border-rule p-4 text-left transition hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)]"><FolderOpen className="h-8 w-8 flex-shrink-0 text-[var(--sg-accent)]" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink">{folder.name}</span><span className="text-xs text-ink-soft">{folder.documentCount} {folder.documentCount === 1 ? 'document' : 'documente'}</span></span><span className="text-ink-faint">›</span></button>)}
            </div>
          )
        ) : noResults ? (
          <div className="flex flex-col items-center justify-center py-24 text-center"><FolderOpen className="mb-4 h-16 w-16 text-ink-faint" /><p className="font-semibold text-ink">{hasSearch || filterStatus !== 'all' ? 'Niciun rezultat' : 'Folder gol'}</p><p className="text-sm text-ink-soft">{hasSearch || filterStatus !== 'all' ? 'Încearcă să modifici filtrele.' : 'Fișierele vor apărea aici când vor fi încărcate.'}</p></div>
        ) : (
          <div className="space-y-3">{sortedDocuments.map(document => renderDocument(document))}</div>
        )}
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
