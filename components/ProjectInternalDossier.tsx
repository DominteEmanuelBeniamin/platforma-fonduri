'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronsDownUp, ChevronsUpDown, Download, Eye, FileText, Loader2, Pencil, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import { Button } from '@/components/ui/Button'
import type { ProjectPhase } from '@/components/ProjectPhasesSidebar'
import { serverMessage } from '@/lib/api-error'
import { Highlight } from '@/components/ui/Highlight'
import { rangesOf, searchItems, snippetAround, type SearchHit } from '@/lib/search'
import { bandFor, bandVar } from '@/lib/signage'
import RowActionsMenu from '@/components/RowActionsMenu'
import { isPreviewableFile, openInNewTab } from '@/lib/file-preview'
import { ALLOWED_UPLOAD_EXTENSIONS, getFileExtension } from '@/lib/upload-file-types'
import SelectFilter from '@/components/SelectFilter'
import { AutoGrowTextarea } from '@/components/template-editor/AutoGrowTextarea'

const MAX_FILE_SIZE = 25 * 1024 * 1024

interface Attachment {
  id: string
  original_name: string
  mime_type: string | null
  file_size: number | null
  created_at: string
  uploaded_by: string | null
}

export interface InternalEntry {
  id: string
  project_id: string
  title: string
  body: string | null
  phase_id: string | null
  activity_id: string | null
  document_requirement_id: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  author: { id: string; full_name: string | null } | null
  context: { type: 'phase' | 'activity' | 'requirement'; id: string; label: string } | null
  attachments: Attachment[]
}

interface ProjectRequest {
  id: string
  name: string
  deleted_at?: string | null
  is_outgoing?: boolean
  activity_id?: string | null
  activity?: { id?: string | null; name?: string | null; phase_id?: string | null } | null
}

interface PendingFile {
  id: string
  file: File
  error?: string
  tooLarge?: boolean
  invalidType?: boolean
  attachmentId?: string
  uploadUrl?: string
  token?: string
  uploaded?: boolean
}

interface ProjectInternalDossierProps {
  projectId: string
  phases: ProjectPhase[]
  requests: ProjectRequest[]
  readOnly: boolean
  userId: string | null
  role: string | null
  consultantLevel?: string | null
  selectedEntryId?: string | null
  contextFilter?: string | null
  onClearContextFilter?: () => void
  onOpenContext?: (context: string) => void
  onEntriesChange?: (entries: InternalEntry[]) => void
  initialContext?: string
  onFormClose?: () => void
  onCreated?: (entryId: string) => void
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Chisinau' })
}

function fileSizeLabel(size: number | null) {
  if (size === null || !Number.isFinite(size)) return ''
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function contextKey(entry: InternalEntry) {
  if (entry.phase_id) return `phase:${entry.phase_id}`
  if (entry.activity_id) return `activity:${entry.activity_id}`
  if (entry.document_requirement_id) return `requirement:${entry.document_requirement_id}`
  return ''
}

function contextPayload(key: string) {
  const [kind, id] = key.split(':', 2)
  return {
    phase_id: kind === 'phase' ? id : null,
    activity_id: kind === 'activity' ? id : null,
    document_requirement_id: kind === 'requirement' ? id : null,
  }
}

export default function ProjectInternalDossier({
  projectId,
  phases,
  requests,
  readOnly,
  userId,
  role,
  consultantLevel,
  selectedEntryId,
  contextFilter,
  onClearContextFilter,
  onOpenContext,
  onEntriesChange,
  initialContext,
  onFormClose,
  onCreated,
}: ProjectInternalDossierProps) {
  const { apiFetch } = useAuth()
  const { showToast, confirm } = useToast()
  const [entries, setEntries] = useState<InternalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [formOpen, setFormOpen] = useState(Boolean(initialContext))
  const [editingEntry, setEditingEntry] = useState<InternalEntry | null>(null)
  const [createdEntryId, setCreatedEntryId] = useState<string | null>(null)
  const [metadataSaved, setMetadataSaved] = useState(false)
  const [formDirty, setFormDirty] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [context, setContext] = useState(initialContext ?? '')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [query, setQuery] = useState('')
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [busyAttachmentId, setBusyAttachmentId] = useState<string | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [allGroupsCollapsed, setAllGroupsCollapsed] = useState(true)

  const baseUrl = `/api/projects/${projectId}/internal-entries`
  const isManager = role === 'admin' || (role === 'consultant' && consultantLevel === 'senior')

  const contextOptions = useMemo(() => {
    const options: { key: string; label: string }[] = []
    for (const phase of phases) {
      options.push({ key: `phase:${phase.id}`, label: `Fază: ${phase.name}` })
      for (const activity of phase.activities ?? []) {
        options.push({ key: `activity:${activity.id}`, label: `Fază: ${phase.name} / Activitate: ${activity.name}` })
      }
    }
    for (const request of requests) {
      if (!request.deleted_at && !request.is_outgoing) {
        const activityId = request.activity?.id ?? request.activity_id
        const phase = phases.find(item => item.activities?.some(activity => activity.id === activityId))
        const activity = phase?.activities?.find(item => item.id === activityId)
        options.push({ key: `requirement:${request.id}`, label: [phase && `Fază: ${phase.name}`, (activity?.name || request.activity?.name) && `Activitate: ${activity?.name || request.activity?.name}`, `Cerere: ${request.name}`].filter(Boolean).join(' / ') })
      }
    }
    return options
  }, [phases, requests])

  const contextLabel = useCallback((entry: InternalEntry) => entry.context
    ? contextOptions.find(option => option.key === contextKey(entry))?.label || `${entry.context.type === 'phase' ? 'Fază' : entry.context.type === 'activity' ? 'Activitate' : 'Cerere'}: ${entry.context.label}`
    : '', [contextOptions])
  const hits = useMemo(() => searchItems(contextFilter ? entries.filter(entry => contextKey(entry) === contextFilter) : entries, query, entry => [
    { key: 'title', label: 'Titlu', value: entry.title },
    { key: 'context', label: 'Context', value: contextLabel(entry) },
    { key: 'body', label: 'Notă', value: entry.body },
    ...entry.attachments.map(file => ({ key: `file:${file.id}`, label: 'Fișier', value: file.original_name })),
  ]), [entries, query, contextLabel, contextFilter])

  const groups = useMemo(() => {
    type Hit = SearchHit<InternalEntry>
    const phaseGroups = phases.map((phase, index) => ({
      phase, index, direct: [] as Hit[],
      activities: (phase.activities ?? []).map(activity => ({ activity, hits: [] as Hit[] })),
    }))
    const noContext: Hit[] = []
    const generalRequests: Hit[] = []
    const unavailable: Hit[] = []
    for (const hit of hits) {
      const entry = hit.item
      if (!entry.phase_id && !entry.activity_id && !entry.document_requirement_id) {
        noContext.push(hit)
        continue
      }
      if (entry.phase_id) {
        const phase = phaseGroups.find(group => group.phase.id === entry.phase_id)
        ;(phase?.direct ?? unavailable).push(hit)
        continue
      }
      const request = entry.document_requirement_id ? requests.find(item => item.id === entry.document_requirement_id) : null
      if (entry.document_requirement_id && !request) { unavailable.push(hit); continue }
      const activityId = entry.activity_id ?? request?.activity?.id ?? request?.activity_id
      if (!activityId) { generalRequests.push(hit); continue }
      const activity = phaseGroups.flatMap(group => group.activities).find(group => group.activity.id === activityId)
      ;(activity?.hits ?? unavailable).push(hit)
    }
    return { phaseGroups, noContext, generalRequests, unavailable }
  }, [hits, phases, requests])

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const response = await apiFetch(baseUrl)
      if (!response.ok) throw new Error('Nu am putut încărca dosarul intern.')
      const data = await response.json()
      const nextEntries = Array.isArray(data.entries) ? data.entries : []
      setEntries(nextEntries)
      onEntriesChange?.(nextEntries)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, baseUrl, onEntriesChange])

  useEffect(() => { void loadEntries() }, [loadEntries])

  useEffect(() => {
    if (loading || (!selectedEntryId && !contextFilter)) return
    const target = selectedEntryId ? document.getElementById(`internal-entry-${selectedEntryId}`) : document.getElementById('internal-dossier-results')
    target?.scrollIntoView({ block: 'start' })
    const cards = selectedEntryId ? (target ? [target] : []) : Array.from(sectionRef.current?.querySelectorAll<HTMLElement>('[data-internal-result]') ?? [])
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const card of cards) card.animate([{ boxShadow: '0 0 0 0 transparent' }, { boxShadow: '0 0 0 3px var(--sg-accent)', offset: 0.18 }, { boxShadow: '0 0 0 3px var(--sg-accent)', offset: 0.68 }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1800, easing: 'ease-out' })
    }
  }, [loading, selectedEntryId, contextFilter, entries])

  const resetForm = () => {
    setFormOpen(false)
    setEditingEntry(null)
    setCreatedEntryId(null)
    setMetadataSaved(false)
    setFormDirty(false)
    setTitle('')
    setBody('')
    setContext('')
    setFiles([])
  }

  const openCreateForm = () => {
    setEditingEntry(null)
    setCreatedEntryId(null)
    setMetadataSaved(false)
    setFormDirty(false)
    setTitle('')
    setBody('')
    setContext('')
    setFiles([])
    setFormOpen(true)
  }

  const openEditForm = (entry: InternalEntry) => {
    setEditingEntry(entry)
    setCreatedEntryId(null)
    setMetadataSaved(false)
    setFormDirty(false)
    setTitle(entry.title)
    setBody(entry.body ?? '')
    setContext(contextKey(entry))
    setFiles([])
    setFormOpen(true)
  }

  const closeForm = async () => {
    if (saving || busyAttachmentId) return false
    if (files.length > 0 || formDirty) {
      const persistedEntryId = editingEntry?.id ?? createdEntryId
      const description = metadataSaved
        ? 'Textul înregistrării este salvat. Fișierele selectate care nu s-au încărcat vor fi eliminate din formular.'
        : persistedEntryId
          ? 'Modificările din formular și fișierele selectate nu au fost salvate. Înregistrarea existentă va rămâne neschimbată în dosar.'
          : 'Înregistrarea și fișierele selectate nu au fost salvate. Închiderea va elimina titlul, nota, contextul și fișierele din formular.'
      const discard = await confirm({
        title: metadataSaved ? 'Renunți la fișierele neîncărcate?' : 'Renunți la modificările nesalvate?',
        description,
        confirmText: metadataSaved ? 'Renunță la fișiere' : 'Elimină modificările',
      })
      if (!discard) return false
    }
    resetForm()
    onFormClose?.()
    return true
  }

  const selectFiles = (selected: FileList | null) => {
    if (!selected?.length) return
    const additions = Array.from(selected).map(file => ({
      id: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
      file,
      error: file.size > MAX_FILE_SIZE ? 'Fișierul depășește limita de 25 MiB.' : undefined,
      tooLarge: file.size > MAX_FILE_SIZE,
      invalidType: !ALLOWED_UPLOAD_EXTENSIONS.includes(getFileExtension(file.name)),
      ...(!ALLOWED_UPLOAD_EXTENSIONS.includes(getFileExtension(file.name)) ? { error: 'Tip de fișier nepermis' } : {}),
    }))
    setFiles(current => [...current, ...additions])
  }

  const uploadFile = async (entryId: string, pending: PendingFile): Promise<PendingFile | null> => {
    let attachmentId = pending.attachmentId
    let uploadUrl = pending.uploadUrl
    let uploadToken = pending.token
    let uploaded = pending.uploaded ?? false
    try {
      if (!attachmentId || !uploadUrl || !uploadToken) {
        const initResponse = await apiFetch(`${baseUrl}/${entryId}/attachments/init`, {
          method: 'POST',
          body: JSON.stringify({
            originalName: pending.file.name,
            mimeType: pending.file.type || 'application/octet-stream',
            fileSize: pending.file.size,
          }),
        })
        if (!initResponse.ok) throw new Error(await serverMessage(initResponse, 'Nu am putut pregăti încărcarea.'))
        const init = await initResponse.json()
        attachmentId = init.attachmentId
        uploadUrl = init.uploadUrl
        uploadToken = init.token
        if (!attachmentId || !uploadUrl || !uploadToken) throw new Error('Nu am primit datele pentru încărcare.')
      }

      if (!uploaded) {
        try {
          const uploadResponse = await fetch(uploadUrl!, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${uploadToken}`,
              'Content-Type': pending.file.type || 'application/octet-stream',
            },
            body: pending.file,
          })
          if (!uploadResponse.ok) throw new Error('Încărcarea fișierului a eșuat.')
        } catch (error) {
          // A new reservation is safer to retry after a failed storage PUT.
          attachmentId = undefined
          uploadUrl = undefined
          uploadToken = undefined
          throw error
        }
        uploaded = true
      }

      const completeResponse = await apiFetch(`${baseUrl}/${entryId}/attachments/complete`, {
        method: 'POST',
        body: JSON.stringify({ attachmentId }),
      })
      if (!completeResponse.ok) throw new Error(await serverMessage(completeResponse, 'Fișierul nu a putut fi salvat în dosar.'))
      return null
    } catch (error) {
      return {
        ...pending,
        attachmentId,
        uploadUrl,
        token: uploadToken,
        uploaded,
        error: error instanceof Error ? error.message : 'Nu am putut încărca fișierul. Reîncearcă.',
      }
    }
  }

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || readOnly || files.some(file => file.tooLarge || file.invalidType)) return
    setSaving(true)
    try {
      let entryId = editingEntry?.id ?? createdEntryId
      const payload = { title: title.trim(), body: body.trim(), ...contextPayload(context) }

      if (entryId) {
        const response = await apiFetch(`${baseUrl}/${entryId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error(await serverMessage(response, 'Nu am putut salva modificările.'))
      } else {
        const response = await apiFetch(baseUrl, { method: 'POST', body: JSON.stringify(payload) })
        if (!response.ok) throw new Error(await serverMessage(response, 'Nu am putut adăuga în dosarul intern.'))
        const data = await response.json()
        entryId = data.entry?.id
        if (!entryId) throw new Error('Înregistrarea a fost creată, dar răspunsul nu conține identificatorul ei.')
        setCreatedEntryId(entryId)
      }

      setMetadataSaved(true)
      setFormDirty(false)

      await loadEntries()
      if (files.length) {
        const remaining: PendingFile[] = []
        for (const pending of files) {
          const failed = await uploadFile(entryId!, pending)
          if (failed) remaining.push(failed)
        }
        setFiles(remaining)
        await loadEntries()
        if (remaining.length) {
          showToast('Înregistrarea a fost salvată. Unele fișiere au eșuat; le poți reîncerca aici.', 'warning')
          return
        }
      }

      resetForm()
      if (onCreated && entryId && !editingEntry) onCreated(entryId)
      else showToast(editingEntry ? 'Înregistrarea a fost actualizată.' : 'Înregistrarea a fost adăugată în dosar.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nu am putut salva în dosarul intern.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeEntry = async (entry: InternalEntry) => {
    const accepted = await confirm({
      title: 'Retragi această înregistrare?',
      description: 'Înregistrarea nu va mai apărea în dosar. Fișierele atașate rămân păstrate pentru audit.',
      confirmText: 'Retrage',
    })
    if (!accepted) return
    try {
      const response = await apiFetch(`${baseUrl}/${entry.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await serverMessage(response, 'Nu am putut retrage înregistrarea.'))
      await loadEntries()
      showToast('Înregistrarea a fost retrasă.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nu am putut retrage înregistrarea.', 'error')
    }
  }

  const removeAttachment = async (entry: InternalEntry, attachment: Attachment) => {
    const accepted = await confirm({
      title: `Retragi „${attachment.original_name}”?`,
      description: 'Fișierul va fi retras imediat din dosar și din Documente. Va rămâne păstrat pentru audit.',
      confirmText: 'Retrage fișierul',
    })
    if (!accepted) return
    setBusyAttachmentId(attachment.id)
    try {
      const response = await apiFetch(`${baseUrl}/${entry.id}/attachments/${attachment.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await serverMessage(response, 'Nu am putut retrage fișierul.'))
      setEditingEntry(current => current?.id === entry.id ? { ...current, attachments: current.attachments.filter(file => file.id !== attachment.id) } : current)
      await loadEntries()
      showToast('Fișierul a fost retras.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nu am putut retrage fișierul.', 'error')
    } finally {
      setBusyAttachmentId(null)
    }
  }

  const downloadAttachment = async (entry: InternalEntry, attachment: Attachment) => {
    setBusyAttachmentId(attachment.id)
    try {
      const response = await apiFetch(`${baseUrl}/${entry.id}/attachments/${attachment.id}/signed-download`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      if (!response.ok) throw new Error(await serverMessage(response, 'Nu am putut descărca fișierul.'))
      const data = await response.json()
      if (typeof data.url !== 'string') throw new Error('Linkul de descărcare lipsește.')
      window.location.assign(data.url)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nu am putut descărca fișierul.', 'error')
    } finally {
      setBusyAttachmentId(null)
    }
  }

  const canEditEntry = (entry: InternalEntry) => !readOnly && (!!userId && entry.created_by === userId || isManager)

  const renderEntries = (groupHits: SearchHit<InternalEntry>[]) => (
        <ul className="space-y-3" aria-label="Înregistrări din dosarul intern">
          {groupHits.map(({ item: entry, matches }) => {
            const canEdit = canEditEntry(entry)
            const bodyRanges = rangesOf(matches, 'body')
            const bodySnippet = entry.body && bodyRanges.length ? snippetAround(entry.body, bodyRanges) : null
            const matchingFiles = entry.attachments.filter(file => rangesOf(matches, `file:${file.id}`).length > 0)
            const notePreview = entry.body?.split('\n').slice(0, 3).join('\n').slice(0, 240) ?? ''
            const noteTruncated = !!entry.body && notePreview.length < entry.body.length
            return (
              <li data-internal-result id={`internal-entry-${entry.id}`} key={entry.id} className={`relative scroll-mt-32 rounded-[var(--radius-plate-lg)] border bg-plate p-4 md:p-5 ${selectedEntryId === entry.id || contextFilter ? 'border-[var(--sg-accent)]' : 'border-rule'}`}>
                {canEdit && <RowActionsMenu className="absolute right-3 top-3 md:right-4 md:top-4" label={`Acțiuni pentru ${entry.title}`} actions={[
                  { label: 'Editează', icon: <Pencil className="h-4 w-4" />, onSelect: () => openEditForm(entry) },
                  { label: 'Retrage', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void removeEntry(entry) },
                ]} />}
                <details open={selectedEntryId === entry.id ? true : undefined}>
                <summary className="cursor-pointer break-words pr-10 text-ink">
                  <span className="font-semibold"><Highlight text={entry.title} ranges={rangesOf(matches, 'title')} /></span>
                  <span className="mt-1 block text-xs text-ink-faint">{entry.author?.full_name || 'Membru al echipei'}{dateLabel(entry.created_at) ? ` · ${dateLabel(entry.created_at)}` : ''}</span>
                  {entry.context && <span className="mt-2 block text-xs text-ink-soft"><Highlight text={contextLabel(entry)} ranges={rangesOf(matches, 'context')} /></span>}
                  {bodySnippet && <span className="mt-2 block truncate text-xs text-ink-soft">Găsit în notă: <Highlight text={bodySnippet.text} ranges={bodySnippet.ranges} /></span>}
                  {matchingFiles.map(file => <span key={file.id} className="mt-2 block truncate text-xs text-ink-soft">Găsit în fișier: <Highlight text={file.original_name} ranges={rangesOf(matches, `file:${file.id}`)} /></span>)}
                </summary>
                {entry.body && <div className="mt-3 text-sm font-normal leading-6 text-ink">
                  <p className="whitespace-pre-wrap break-words"><Highlight text={expandedNotes.has(entry.id) ? entry.body : notePreview} query={query} />{noteTruncated && !expandedNotes.has(entry.id) ? '…' : ''}</p>
                  {noteTruncated && <button type="button" className="mt-1 font-medium text-[var(--sg-accent)]" aria-expanded={expandedNotes.has(entry.id)} onClick={() => setExpandedNotes(current => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next })}>{expandedNotes.has(entry.id) ? 'Restrânge nota' : 'Citește toată nota'}</button>}
                </div>}
                {entry.attachments?.length > 0 && (
                  <ul className="mt-4 space-y-2" aria-label={`Fișiere pentru ${entry.title}`}>
                    {entry.attachments.map(attachment => (
                      <li key={attachment.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-plate)] bg-paper-sunk px-3 py-2">
                        <FileText className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                        <span className="min-w-0 flex-1 break-all text-sm text-ink"><Highlight text={attachment.original_name} ranges={rangesOf(matches, `file:${attachment.id}`)} /><span className="ml-2 text-xs text-ink-faint">{fileSizeLabel(attachment.file_size)}</span></span>
                        {isPreviewableFile({ mimeType: attachment.mime_type, fileName: attachment.original_name }) && <button type="button" data-tooltip="Previzualizează" aria-label={`Deschide ${attachment.original_name}`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-faint hover:bg-paper hover:text-[var(--sg-accent)]" onClick={() => openInNewTab(`/preview/internal/${attachment.id}?${new URLSearchParams({ projectId, entryId: entry.id, name: attachment.original_name })}`)}><Eye className="h-4 w-4" aria-hidden="true" /></button>}
                        <button type="button" data-tooltip="Descarcă" aria-label={`Descarcă ${attachment.original_name}`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-faint hover:bg-paper hover:text-[var(--sg-accent)] disabled:opacity-50" disabled={busyAttachmentId === attachment.id} onClick={() => void downloadAttachment(entry, attachment)}>
                          {busyAttachmentId === attachment.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                </details>
              </li>
            )
          })}
        </ul>
  )
  const shouldOpen = (groupHits: SearchHit<InternalEntry>[]) => Boolean(query.trim()) || Boolean(contextFilter) || groupHits.some(hit => hit.item.id === selectedEntryId)
  const countLabel = (count: number) => `${count} ${count === 1 ? 'înregistrare' : 'înregistrări'}`
  const updateGroupState = () => {
    const groups = Array.from(sectionRef.current?.querySelectorAll<HTMLDetailsElement>('details[data-dossier-group]') ?? [])
    setAllGroupsCollapsed(groups.length > 0 && groups.every(group => !group.open))
  }
  const toggleAllGroups = () => {
    const groups = sectionRef.current?.querySelectorAll<HTMLDetailsElement>('details[data-dossier-group]') ?? []
    for (const group of groups) group.open = allGroupsCollapsed
    setAllGroupsCollapsed(!allGroupsCollapsed)
  }
  const renderLooseGroup = (label: string, groupHits: SearchHit<InternalEntry>[]) => groupHits.length > 0 && (
    <details data-dossier-group onToggle={updateGroupState} key={`${label}:${Boolean(query.trim())}:${shouldOpen(groupHits)}`} open={shouldOpen(groupHits)} className="space-y-2">
      <summary className="cursor-pointer py-2 font-bold text-ink">{label} <span className="ml-2 text-xs font-normal text-ink-faint">{countLabel(groupHits.length)}</span></summary>
      {renderEntries(groupHits)}
    </details>
  )

  return (
    <section ref={sectionRef} className={initialContext ? 'hidden' : 'mx-auto w-full max-w-5xl px-4 py-5 md:px-6'} aria-labelledby="internal-dossier-heading">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="internal-dossier-heading" className="text-lg font-bold text-ink">Dosar intern</h2>
          <p className="mt-1 max-w-[65ch] text-sm leading-6 text-ink-soft">
            Note și fișiere pentru echipa proiectului. Clientul nu poate vedea acest dosar.
          </p>
        </div>
        {!readOnly && (
          <Button variant="primary" size="sm" onClick={openCreateForm}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Adaugă în dosar
          </Button>
        )}
      </header>

      {readOnly && (
        <p className="mb-4 rounded-[var(--radius-plate)] border border-rule bg-paper-sunk px-3 py-2 text-sm text-ink-soft">
          Proiectul este încheiat. Dosarul intern se poate doar consulta.
        </p>
      )}

      <Dialog.Root open={formOpen} onOpenChange={open => { if (!open) void closeForm() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[999999]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
          <Dialog.Content
            onEscapeKeyDown={event => { if (document.querySelector('[role="combobox"][aria-label="Context asociat (opțional)"][aria-expanded="true"]')) event.preventDefault() }}
            className="fixed left-1/2 top-1/2 z-[999999] max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-plate-lg)] border border-rule bg-plate p-5 focus:outline-none sm:p-6"
            style={{ boxShadow: 'var(--sg-lift)' }}
          >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <Dialog.Title className="font-semibold text-ink">{editingEntry ? 'Editează înregistrarea' : 'Adaugă în dosar'}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-ink-soft">Notă și fișiere vizibile doar echipei proiectului.</Dialog.Description>
            </div>
            <button type="button" onClick={() => void closeForm()} disabled={saving || busyAttachmentId !== null} aria-label="Închide formularul" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-plate)] text-ink-soft hover:bg-paper-sunk hover:text-ink disabled:opacity-50 pointer-fine:min-h-9 pointer-fine:min-w-9">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={submitForm}>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium text-ink">
              Titlu <span className="sr-only">obligatoriu</span>
              <input
                autoFocus
                required
                maxLength={200}
                value={title}
                onChange={event => { setTitle(event.target.value); setFormDirty(true) }}
                disabled={saving}
                className="min-h-11 rounded-[var(--radius-plate)] border border-rule bg-plate px-4 text-sm font-normal focus:border-[var(--sg-accent)] focus:outline-none sm:min-h-10"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-ink">
              Notă (opțional)
              <AutoGrowTextarea
                value={body}
                onChange={value => { setBody(value); setFormDirty(true) }}
                disabled={saving}
                className="font-normal"
              />
            </label>
            <div className="grid gap-1.5 text-sm font-medium text-ink">
              Context asociat (opțional)
              <SelectFilter value={context} onChange={value => { setContext(value); if (editingEntry || createdEntryId) setFormDirty(true) }} placeholder="Fără context" ariaLabel="Context asociat (opțional)" searchable searchPlaceholder="Caută context" options={contextOptions.map(option => ({ value: option.key, label: option.label }))} className="w-full font-normal" />
              {context && <p role="status" aria-live="polite" className="text-xs font-normal text-[var(--sg-accent)]">{loading ? 'Se verifică înregistrările asociate…' : loadError ? <>Nu am putut verifica înregistrările asociate. <button type="button" className="font-semibold underline" onClick={() => void loadEntries()}>Reîncearcă</button></> : (() => { const count = entries.filter(entry => contextKey(entry) === context).length; return count === 0 ? 'Nu există încă înregistrări asociate direct acestui context.' : <>{count} {count === 1 ? 'înregistrare asociată' : 'înregistrări asociate'} direct acestui context. {onOpenContext && <button type="button" className="font-semibold underline underline-offset-2 hover:text-[var(--sg-accent-ink)]" onClick={() => { void (async () => { if (await closeForm()) { setQuery(''); onOpenContext(context) } })() }}>Vezi în dosarul intern</button>}</> })()}</p>}
            </div>
            <div>
              {editingEntry && editingEntry.attachments.length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 text-sm font-medium text-ink">Fișiere existente</p>
                  <ul className="space-y-2">
                    {editingEntry.attachments.map(attachment => (
                      <li key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-plate)] bg-paper-sunk px-3 py-2 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                        <span className="min-w-0 flex-1 break-all">{attachment.original_name}</span>
                        {isManager && <Button type="button" variant="quiet" size="sm" disabled={saving || busyAttachmentId !== null} onClick={() => void removeAttachment(editingEntry, attachment)} aria-label={`Retrage fișierul ${attachment.original_name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /> Retrage</Button>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <label className="grid min-h-11 cursor-pointer place-items-center rounded-[var(--radius-plate)] border border-dashed border-rule-strong bg-paper px-3 py-2 text-sm font-semibold text-ink-soft hover:border-[var(--sg-accent)] hover:text-[var(--sg-accent)] sm:flex sm:justify-start sm:gap-2">
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>Atașează fișiere</span>
                <span className="text-xs font-normal">până la 25 MiB fiecare</span>
                <input
                  type="file"
                  accept={ALLOWED_UPLOAD_EXTENSIONS.map(extension => `.${extension}`).join(',')}
                  multiple
                  disabled={saving}
                  onChange={event => { selectFiles(event.target.files); event.currentTarget.value = '' }}
                  className="sr-only"
                  aria-label="Atașează fișiere"
                />
              </label>
              <p className="mt-1 text-xs text-ink-faint">PDF, Word, Excel, CSV sau imagini JPG, PNG, GIF și WebP.</p>
              {files.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {files.map(pending => (
                    <li key={pending.id} className="flex min-w-0 items-start gap-2 rounded-[var(--radius-plate)] bg-paper-sunk px-3 py-2 text-sm">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                      <span className="min-w-0 flex-1 break-all text-ink">
                        {pending.file.name} <span className="text-ink-faint">({fileSizeLabel(pending.file.size)})</span>
                        {pending.error && <span className="block text-xs text-[var(--sg-danger)]">{pending.error}</span>}
                      </span>
                      <button
                        type="button"
                        aria-label={`Elimină ${pending.file.name}`}
                        disabled={saving}
                        onClick={() => setFiles(current => current.filter(item => item.id !== pending.id))}
                        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint hover:bg-paper hover:text-ink pointer-fine:min-h-8 pointer-fine:min-w-8"
                      ><X className="h-4 w-4" aria-hidden="true" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {!createdEntryId && <Button variant="quiet" size="sm" type="button" onClick={() => void closeForm()} disabled={saving || busyAttachmentId !== null}>Renunță</Button>}
            <Button variant="primary" size="sm" type="submit" disabled={saving || busyAttachmentId !== null || !title.trim() || files.some(file => file.tooLarge || file.invalidType)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : files.some(file => file.error) ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {saving ? 'Se salvează…' : files.some(file => file.tooLarge || file.invalidType) ? 'Elimină fișierele nepermise' : files.length && (createdEntryId || editingEntry) ? `Reîncearcă fișierele (${files.length})` : editingEntry ? 'Salvează modificările' : 'Adaugă în dosar'}
            </Button>
          </div>
          </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="relative mb-4">
        <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Caută în dosarul intern" aria-label="Caută în dosarul intern" className="w-full rounded-[var(--radius-plate)] border border-rule bg-paper py-2 pl-3 pr-11 text-sm" />
        {query && <button type="button" aria-label="Golește căutarea" data-tooltip="Golește căutarea" onClick={() => { setQuery(''); searchRef.current?.focus() }} className="absolute right-0 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint hover:text-ink"><X className="h-4 w-4" aria-hidden="true" /></button>}
      </div>

      {(contextFilter || (!loading && !loadError && hits.length > 0)) && <div id="internal-dossier-results" className="mb-3 flex scroll-mt-32 flex-wrap items-center justify-between gap-2">
        {contextFilter && <span className="inline-flex min-w-0 items-center gap-2 rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--sg-accent)]">
          <span className="break-words">{contextOptions.find(option => option.key === contextFilter)?.label ?? 'Context indisponibil'}</span>
          <button type="button" onClick={onClearContextFilter} aria-label="Elimină filtrul de context" data-tooltip="Arată tot dosarul" className="shrink-0 hover:text-[var(--sg-accent-ink)]"><X className="h-3 w-3" aria-hidden="true" /></button>
        </span>}
        {!loading && !loadError && hits.length > 0 && <Button className="ml-auto" variant="quiet" size="sm" onClick={toggleAllGroups} data-tooltip={allGroupsCollapsed ? 'Deschide toate grupurile' : 'Restrânge toate grupurile'}>{allGroupsCollapsed ? <ChevronsUpDown className="h-4 w-4" aria-hidden="true" /> : <ChevronsDownUp className="h-4 w-4" aria-hidden="true" />}{allGroupsCollapsed ? 'Extinde toate grupurile' : 'Restrânge toate grupurile'}</Button>}
      </div>}

      {loading ? (
        <div role="status" className="flex items-center gap-2 py-8 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Se încarcă dosarul intern…</div>
      ) : loadError ? (
        <div className="rounded-[var(--radius-plate)] border border-[var(--sg-danger)] bg-[var(--sg-danger-soft)] p-4 text-sm text-ink">
          <p>Nu am putut încărca dosarul intern.</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void loadEntries()}>Reîncearcă</Button>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-[var(--radius-plate-lg)] border border-dashed border-rule-strong px-5 py-10 text-center">
          <p className="font-semibold text-ink">Dosarul intern este gol</p>
          <p className="mx-auto mt-2 max-w-[55ch] text-sm leading-6 text-ink-soft">Adaugă note și fișiere de lucru pentru echipa proiectului. Acestea nu sunt trimise clientului.</p>
        </div>
      ) : hits.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-soft">{query.trim() ? `Niciun rezultat pentru „${query}”.` : 'Nu există înregistrări pentru această cerere.'}</p>
      ) : (
        <div className="space-y-5">
          {renderLooseGroup('Fără context', groups.noContext)}
          {renderLooseGroup('Cereri generale', groups.generalRequests)}
          {groups.phaseGroups.map(({ phase, index, direct, activities }) => {
            const all = [...direct, ...activities.flatMap(activity => activity.hits)]
            if (!all.length) return null
            return (
              <details data-dossier-group onToggle={updateGroupState} key={`${phase.id}:${Boolean(query.trim())}:${shouldOpen(all)}`} open={shouldOpen(all)} className="space-y-2">
                <summary className="cursor-pointer py-2 font-bold" style={{ color: bandVar(bandFor(index)) }}>Fază: {phase.name} <span className="ml-2 text-xs font-normal text-ink-faint">{countLabel(all.length)}</span></summary>
                <div className="space-y-3 border-l-4 pl-3" style={{ borderColor: bandVar(bandFor(index)) }}>
                  {direct.length > 0 && renderEntries(direct)}
                  {activities.filter(activity => activity.hits.length > 0).map(({ activity, hits: activityHits }) => (
                    <details data-dossier-group onToggle={updateGroupState} key={`${activity.id}:${Boolean(query.trim())}:${shouldOpen(activityHits)}`} open={shouldOpen(activityHits)} className="rounded-[var(--radius-plate)] bg-paper-sunk/60 px-3 py-1 sm:px-4">
                      <summary className="cursor-pointer py-2 text-sm font-semibold text-ink">Activitate: {activity.name} <span className="ml-2 text-xs font-normal text-ink-faint">{countLabel(activityHits.length)}</span></summary>
                      <div className="mb-3 ml-1 border-l-2 border-[var(--sg-accent)] pl-3 sm:ml-2 sm:pl-4">
                        {renderEntries(activityHits)}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            )
          })}
          {renderLooseGroup('Context indisponibil', groups.unavailable)}
        </div>
      )}
    </section>
  )
}
