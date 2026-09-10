'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  FileText,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  FileCheck,
  AlertCircle,
  Loader2,
  Eye,
  Package,
  Upload,
  FolderUp,
  Files,
  Trash2,
  UserRound,
  Check
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import { downloadFilesArchive } from '@/app/api/_utils/download-files-archive'
import { isPreviewableFile, buildPreviewPageUrl, openInNewTab, downloadUrl } from '@/lib/file-preview'
import InlineDateEditor from '@/components/InlineDateEditor'
import { Mail } from 'lucide-react'
import {
  getManualReminderType,
  REMINDER_LABELS,
  REMINDER_BADGE,
} from '@/lib/document-reminder'
import type { ReminderEntityState } from '@/lib/reminder-state'
import ReminderStatus, { getReminderDisplayStatus } from '@/components/ReminderStatus'
import { REQUIREMENT_LABELS, type RequirementType } from '@/lib/requirement-type'
import {
  formatFileSize,
  isAllowedUploadFile,
  runClientUpload,
  validateUploadFile,
  MAX_UPLOAD_FILE_SIZE,
  type ClientUploadCandidate,
  type PendingClientUploadCompletion,
} from '@/lib/client-upload'

interface DocumentRequest {
  id: string
  name: string
  description: string | null
  requirement_type?: RequirementType
  status: 'pending' | 'review' | 'approved' | 'rejected'
  is_outgoing?: boolean
  attachment_path: string | null
  attachment_missing_at?: string | null
  attachment_missing_checked_at?: string | null
  attachments?: {
    id: string
    storage_path: string
    original_name: string | null
    missing_at?: string | null
    order_index?: number
  }[]
  deadline_at: string | null
  visibility?: 'draft' | 'published'
  created_by: string | null
  created_at: string
  assigned_to: string | null
  assigned_consultant?: { id: string; full_name: string | null; email: string } | null
  creator?: { full_name: string | null; email: string | null }
  files?: {
    id: string
    storage_path: string
    original_name: string
    version_number: number
    comments: string | null
    created_at: string
    uploaded_by: string | null
    deleted_at?: string | null
  }[]
  latest_rejection?: {
    id: string
    reason: string
    reviewed_at: string
    reviewed_by: { id: string; full_name: string | null } | null
  } | null
}

type ClientUploadFile = ClientUploadCandidate & { error?: string }

/** Textul aruncat de handlere e deja pentru utilizator; altfel rămâne mesajul locului. */
function documentActionMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : ''
  return message || fallback
}

/** Modelul atașat de consultant trece prin aceleași reguli ca răspunsul clientului, fără verificarea de duplicat. */
function validateModelFile(file: File) {
  if (file.size > MAX_UPLOAD_FILE_SIZE) return `Fișierul depășește ${formatFileSize(MAX_UPLOAD_FILE_SIZE)}`
  if (!isAllowedUploadFile(file)) return 'Tip de fișier nepermis'
  return null
}

export default function DocumentModal({
  request,
  projectId,
  onClose,
  onUpdate,
  clientEmail,
  clientName,
  projectTitle,
  clientVisible = true,
  reminderState,
  reminderStateLoading = false,
  projectMembers = [],
}: {
  request: DocumentRequest
  projectId: string
  /** Consultanții proiectului, pentru atribuirea cererii */
  projectMembers?: { id: string; full_name: string | null; email: string }[]
  onClose: () => void
  onUpdate: () => void
  clientEmail?: string | null
  clientName?: string | null
  projectTitle?: string
  reminderState?: ReminderEntityState
  reminderStateLoading?: boolean
  /** Cererea e efectiv vizibilă clientului (lanțul fază→activitate→cerere publicat).
   *  Calculat de părinte, ca regulile de vizibilitate să stea într-un singur loc. */
  clientVisible?: boolean
}) {
  const { apiFetch, profile } = useAuth()
  const { showToast, confirm } = useToast()
  const isOutgoing = Boolean(request.is_outgoing)
  const [notes, setNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [attachmentMissing, setAttachmentMissing] = useState(!!request.attachment_missing_at)
  const [localAttachmentPath, setLocalAttachmentPath] = useState<string | null>(request.attachment_path)
  const [attachmentActionLoading, setAttachmentActionLoading] = useState(false)
  const [clientUploadFiles, setClientUploadFiles] = useState<ClientUploadFile[]>([])
  const [clientUploadLoading, setClientUploadLoading] = useState(false)
  const pendingClientUploadRef = useRef<PendingClientUploadCompletion | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const handleApproveRef = useRef<(() => Promise<void>) | null>(null)

  // Deadline edit state — valoarea tastată stă în InlineDateEditor
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [savingDeadline, setSavingDeadline] = useState(false)
  const [localDeadline, setLocalDeadline] = useState<string | null>(request.deadline_at)

  // Responsabilul cererii — condiție de publicare (#70), dar editabil oricând
  const [editingAssignee, setEditingAssignee] = useState(false)
  const [savingAssignee, setSavingAssignee] = useState(false)
  const [localAssignee, setLocalAssignee] = useState<string | null>(request.assigned_to)
  // Selecția se confirmă explicit: atribuirea trimite un email consultantului,
  // iar pe un select cu focus o singură săgeată ar fi declanșat-o.
  const [assigneeDraft, setAssigneeDraft] = useState('')
  const [sendingReminder, setSendingReminder] = useState(false)
  const sendingReminderLock = useRef(false)

  const isAdminOrConsultant = profile?.role === 'admin' || profile?.role === 'consultant'
  const canUploadFolder =
    typeof window !== 'undefined' &&
    'webkitdirectory' in HTMLInputElement.prototype &&
    !window.matchMedia?.('(pointer: coarse)').matches &&
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  // O cerere publicată nu poate rămâne fără termen sau fără responsabil (#70),
  // deci golirea se oferă doar cât e „În pregătire". Serverul respinge oricum.
  const canEmptyRequiredFields = request.visibility !== 'published'
  // Numele responsabilului: din lista de membri, altfel din join-ul cererii
  const assignedMember = localAssignee
    ? projectMembers.find(member => member.id === localAssignee)
    : undefined
  const assigneeLabel = localAssignee
    ? assignedMember?.full_name
      || assignedMember?.email
      || request.assigned_consultant?.full_name
      || request.assigned_consultant?.email
      || 'consultant atribuit'
    : null
  const requestAttachments = request.attachments?.length
    ? request.attachments
    : localAttachmentPath
    ? [{ id: '', storage_path: localAttachmentPath, original_name: null, missing_at: request.attachment_missing_at }]
    : []

  useEffect(() => {
    setLocalAttachmentPath(request.attachment_path)
    setAttachmentMissing(!!request.attachment_missing_at)
    setLocalDeadline(request.deadline_at)
    setLocalAssignee(request.assigned_to)
  }, [request.id, request.attachment_path, request.attachment_missing_at, request.deadline_at, request.assigned_to])

  useEffect(() => {
    pendingClientUploadRef.current = null
    setClientUploadFiles([])
  }, [request.id])

  const handleSaveDeadline = async (deadline: string) => {
    setSavingDeadline(true)
    try {
      const res = await apiFetch(`/api/document-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Doar termenul: PATCH-ul e parțial, iar retrimiterea lui `assigned_to`
        // ar rescrie o atribuire făcută între timp, cu valoarea veche.
        body: JSON.stringify({ deadline_at: deadline || null }),
      })
      if (res.ok) {
        setLocalDeadline(deadline || null)
        setEditingDeadline(false)
        await onUpdate()
      } else {
        const data = await res.json().catch(() => null)
        showToast(data?.message || data?.error || 'Nu am putut salva termenul-limită. Reîncearcă.', 'error')
      }
    } catch {
      showToast('Nu am putut salva termenul-limită. Reîncearcă.', 'error')
    } finally {
      setSavingDeadline(false)
    }
  }

  const handleSaveAssignee = async (consultantId: string | null) => {
    setSavingAssignee(true)
    try {
      const res = await apiFetch(`/api/document-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: consultantId }),
      })
      if (res.ok) {
        setLocalAssignee(consultantId)
        setEditingAssignee(false)
        onUpdate()
      } else {
        const data = await res.json().catch(() => null)
        showToast(data?.message || data?.error || 'Nu am putut salva responsabilul. Reîncearcă.', 'error')
      }
    } catch {
      showToast('Nu am putut salva responsabilul. Reîncearcă.', 'error')
    } finally {
      setSavingAssignee(false)
    }
  }

  const sendReminder = async () => {
    if (sendingReminderLock.current) return
    if (!await confirm({
      title: 'Trimiți reminder clientului?',
      description: `Se trimite acum un email real către client pentru „${request.name}”.`,
      confirmText: 'Trimite email',
    })) return
    sendingReminderLock.current = true
    setSendingReminder(true)
    try {
      const res = await apiFetch(`/api/document-requests/${request.id}/reminder`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        await onUpdate()
        showToast(data?.warning || 'Reminder-ul a fost trimis clientului.', data?.warning ? 'warning' : 'success')
      } else {
        showToast(data?.error || 'Nu am putut trimite reminder-ul. Reîncearcă.', 'error')
      }
    } catch {
      showToast('Nu am putut trimite reminder-ul. Reîncearcă.', 'error')
    } finally {
      sendingReminderLock.current = false
      setSendingReminder(false)
    }
  }

  // Status configuration
  const statusConfig = useMemo(() => {
    const configs = {
      pending: {
        bg: 'bg-[var(--sg-warn-soft)]',
        text: 'text-[var(--sg-warn)]',
        icon: Clock,
        label: isAdminOrConsultant ? 'Așteaptă răspuns' : 'De încărcat',
      },
      review: {
        bg: 'bg-[var(--sg-accent-soft)]',
        text: 'text-[var(--sg-accent)]',
        icon: Eye,
        label: 'În verificare',
      },
      approved: {
        bg: 'bg-[var(--sg-ok-soft)]',
        text: 'text-[var(--sg-ok)]',
        icon: CheckCircle2,
        label: 'Aprobat',
      },
      rejected: {
        bg: 'bg-[var(--sg-danger-soft)]',
        text: 'text-[var(--sg-danger)]',
        icon: XCircle,
        label: 'Respins',
      }
    }
    if (isOutgoing) {
      return {
        bg: 'bg-[var(--sg-ok-soft)]',
        text: 'text-[var(--sg-ok)]',
        icon: FileCheck,
        label: 'Trimis clientului',
      }
    }
    return configs[request.status] || configs.pending
  }, [isAdminOrConsultant, isOutgoing, request.status])

  // Check if deadline is overdue
  const isOverdue = useMemo(() => {
    if (!localDeadline) return false
    const deadline = new Date(localDeadline)
    const today = new Date()
    deadline.setHours(0, 0, 0, 0)
    today.setHours(0, 0, 0, 0)
    return deadline < today
  }, [localDeadline])

  useEffect(() => {
    setMounted(true)
    const scrollY = window.scrollY
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => window.scrollTo(0, scrollY))
    
    // Keyboard shortcuts
    const handleKeyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && e.ctrlKey && isAdminOrConsultant && request.status === 'review') {
        void handleApproveRef.current?.()
      }
    }

    window.addEventListener('keydown', handleKeyboard)

    return () => {
      document.body.style.overflow = previousOverflow
      requestAnimationFrame(() => window.scrollTo(0, scrollY))
      window.removeEventListener('keydown', handleKeyboard)
    }
  }, [request.status, isAdminOrConsultant, onClose])

  /** `''` ca nume: descarcă, dar păstrează numele trimis de server. */
  const forceDownload = (url: string) => downloadUrl(url, '')

  const sanitizeArchiveNamePart = (value?: string | null) => {
    const normalized = (value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')

    return normalized || null
  }

  const buildArchiveName = (version: number) => {
    const parts = [
      sanitizeArchiveNamePart(clientName),
      sanitizeArchiveNamePart(projectTitle),
      sanitizeArchiveNamePart(request.name),
      `v${version}`,
    ].filter(Boolean)

    return parts.join(' - ')
  }

  // Group uploaded files by version_number (folder uploads can create multiple files for the same version)
  type DocFile = NonNullable<DocumentRequest['files']>[number]

  const groupedVersions = useMemo(() => {
    const files: DocFile[] = ((request.files ?? []) as DocFile[]).filter(file => !file.deleted_at)

    const map = new Map<number, DocFile[]>()

    for (const f of files) {
      const current = map.get(f.version_number) ?? []
      current.push(f)
      map.set(f.version_number, current)
    }

    return Array.from(map.entries())
      .map(([version, items]) => {
        const sortedItems = [...items].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        return {
          version,
          files: sortedItems,
          createdAt: sortedItems[0]?.created_at
        }
      })
      .sort((a, b) => b.version - a.version)
  }, [request.files])

  const latestRejectionReason = useMemo(() => {
    if (request.status !== 'rejected') return null
    return request.latest_rejection?.reason ?? null
  }, [request.latest_rejection?.reason, request.status])


  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)

  useEffect(() => {
    // reset when request changes / files refresh
    setSelectedVersion(groupedVersions[0]?.version ?? null)
  }, [request.id, groupedVersions])

  const downloadAllFilesForVersion = async (version: number) => {
    const group = groupedVersions.find(v => v.version === version)
    if (!group || group.files.length === 0) return
  
    const opId = `all-v${version}`
    setDownloadingId(opId)

    try {
      await downloadFilesArchive({
        fileIds: group.files.map(file => file.id),
        apiFetch,
        zipName: buildArchiveName(version)
      })
  
      showToast('Arhiva a fost descărcată.', 'success')
    } catch {
      showToast('Nu am putut descărca arhiva. Reîncearcă.', 'error')
    } finally {
      setDownloadingId(null)
    }
  }


  const downloadAttachmentModel = async (attachmentId?: string) => {
    if (!localAttachmentPath || attachmentMissing) return
    setDownloadingId('attachment')
    try {
      const res = await apiFetch(`/api/document-requests/${request.id}/attachment/signed-download`, {
        method: 'POST',
        body: JSON.stringify({ expiresIn: 60 * 5, attachment_id: attachmentId || undefined })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          setAttachmentMissing(true)
          onUpdate()
        }
        throw new Error('Nu am putut descărca modelul.')
      }
      
      forceDownload(data.url)
      showToast('Descărcare începută', 'success')
    } catch {
      showToast('Nu am putut descărca modelul. Reîncearcă.', 'error')
    } finally {
      setDownloadingId(null)
    }
  }

  const openAttachmentModel = (attachmentId?: string, fileName?: string | null) => {
    if (!localAttachmentPath || attachmentMissing) return
    openInNewTab(buildPreviewPageUrl({ type: 'attachment', id: request.id, name: fileName, attachmentId }))
    // verificare în fundal: dacă fișierul a dispărut din storage între timp,
    // cererea rămâne marcată corect chiar dacă utilizatorul nu apasă Descarcă
    apiFetch(`/api/document-requests/${request.id}/attachment/signed-download`, {
      method: 'POST',
      body: JSON.stringify({ expiresIn: 60, attachment_id: attachmentId || undefined }),
    }).then(res => {
      if (res.status === 404) {
        setAttachmentMissing(true)
        onUpdate()
      }
    }).catch(() => {})
  }

  const patchAttachmentPath = async (attachmentPath: string | null, attachmentOriginalName?: string | null) => {
    const res = await apiFetch(`/api/document-requests/${request.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachment_path: attachmentPath,
        attachment_original_name: attachmentOriginalName ?? null,
        attachments: attachmentPath
          ? [{ storage_path: attachmentPath, original_name: attachmentOriginalName ?? null }]
          : [],
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Nu s-a putut actualiza modelul')
  }

  const handleReplacementModel = async (file: File | null | undefined) => {
    if (!file || !isAdminOrConsultant) {
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      return
    }

    const validationError = validateModelFile(file)
    if (validationError) {
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      showToast(validationError, 'error')
      return
    }

    setAttachmentActionLoading(true)
    try {
      const initRes = await apiFetch(`/api/projects/${projectId}/document-requests/attachment/init`, {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          type: file.type || 'application/octet-stream',
        }),
      })
      const initData = await initRes.json().catch(() => ({}))
      if (!initRes.ok) throw new Error(initData?.error || 'Nu s-a putut inițializa upload-ul')

      const uploadRes = await fetch(initData.signedUploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          Authorization: `Bearer ${initData.token}`,
        },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('Upload-ul modelului a eșuat')

      await patchAttachmentPath(initData.storagePath, file.name)
      setLocalAttachmentPath(initData.storagePath)
      setAttachmentMissing(false)
      onUpdate()
      showToast('Modelul a fost actualizat.', 'success')
    } catch {
      showToast('Nu am putut actualiza modelul. Reîncearcă.', 'error')
    } finally {
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      setAttachmentActionLoading(false)
    }
  }

  const addClientUploadFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return

    pendingClientUploadRef.current = null
    setClientUploadFiles(current => {
      const added: ClientUploadFile[] = []
      for (const file of files) {
        const item: ClientUploadFile = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || null,
        }
        item.error = validateUploadFile(file, [...current, ...added])?.message
        added.push(item)
      }
      return [...current, ...added]
    })
  }

  const clearClientUploadSelection = () => {
    pendingClientUploadRef.current = null
    setClientUploadFiles([])
  }

  const handleClientUpload = async () => {
    if (clientUploadLoading) return
    const validFiles = clientUploadFiles.filter(file => !file.error)
    const pending = pendingClientUploadRef.current?.requestId === request.id
      ? pendingClientUploadRef.current
      : null

    if (!pending && validFiles.length === 0) {
      showToast('Nu există fișiere valide. Verifică selecția.', 'warning')
      return
    }

    setClientUploadLoading(true)
    try {
      const result = await runClientUpload({
        apiFetch,
        requestId: request.id,
        files: validFiles,
        pending,
        onPending: next => { pendingClientUploadRef.current = next },
      })

      setClientUploadFiles([])
      await onUpdate()
      showToast(
        result.failed === 0
          ? `Au fost încărcate ${result.successful} fișiere.`
          : `${result.successful} fișiere au fost încărcate, iar ${result.failed} au eșuat.`,
        result.failed === 0 ? 'success' : 'warning',
      )
    } catch (error) {
      showToast(documentActionMessage(error, 'Nu am putut încărca fișierele. Reîncearcă.'), 'error')
    } finally {
      setClientUploadLoading(false)
    }
  }

  const handleRemoveModel = async () => {
    if (!isAdminOrConsultant || attachmentActionLoading) return
    if (!await confirm({ title: 'Elimini modelul?', description: 'Clientul nu va mai vedea că există un model atașat.', confirmText: 'Elimină modelul' })) return

    setAttachmentActionLoading(true)
    try {
      await patchAttachmentPath(null)
      setLocalAttachmentPath(null)
      setAttachmentMissing(false)
      onUpdate()
      showToast('Modelul a fost eliminat din cerere.', 'success')
    } catch {
      showToast('Nu am putut elimina modelul. Reîncearcă.', 'error')
    } finally {
      setAttachmentActionLoading(false)
    }
  }

  const downloadUploadedFileById = async (fileId: string) => {
    setDownloadingId(fileId)
    try {
      const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
        method: 'POST',
        body: JSON.stringify({ expiresIn: 60 * 5 })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error('Nu am putut descărca fișierul.')
      
      forceDownload(data.url)
      showToast('Descărcare începută', 'success')
    } catch {
      showToast('Nu am putut descărca fișierul. Reîncearcă.', 'error')
    } finally {
      setDownloadingId(null)
    }
  }

  const openUploadedFileById = (fileId: string, fileName?: string) => {
    openInNewTab(buildPreviewPageUrl({ type: 'file', id: fileId, name: fileName }))
  }


  const reviewRequest = async (action: 'approved' | 'rejected') => {
    const res = await apiFetch(`/api/document-requests/${request.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, notes: notes.trim() || null })
    })
    const data = await res.json().catch(() => ({}))
    // `error` e rescris de apiFetch cu un text generic; motivul real vine în `message`.
    if (!res.ok) throw new Error(data?.message || '')
  }

  const handleApprove = async () => {
    setActionLoading(true)
    try {
      await reviewRequest('approved')
      showToast('Document aprobat cu succes!', 'success')
      setNotes('')
      setTimeout(() => {
        onUpdate()
        onClose()
      }, 500)
    } catch (error) {
      showToast(documentActionMessage(error, 'Nu am putut aproba documentul. Reîncearcă.'), 'error')
    } finally {
      setActionLoading(false)
    }
  }
  handleApproveRef.current = handleApprove

  const handleReject = async () => {
    if (!notes.trim()) {
      showToast('Te rog scrie motivul respingerii', 'error')
      return
    }
    
    setActionLoading(true)
    try {
      await reviewRequest('rejected')
      showToast('Document respins', 'success')
      setNotes('')
      setTimeout(() => {
        onUpdate()
        onClose()
      }, 500)
    } catch (error) {
      showToast(documentActionMessage(error, 'Nu am putut respinge documentul. Reîncearcă.'), 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const confirmReject = async () => {
    if (!notes.trim()) {
      showToast('Te rog scrie motivul respingerii, ca utilizatorul să știe ce să corecteze.', 'warning')
      return
    }
    if (await confirm({ title: 'Confirmă respingerea', description: 'Utilizatorul va trebui să reîncarce documentele.', confirmText: 'Respinge documentul' })) {
      await handleReject()
    }
  }

  if (!mounted) return null

  const StatusIcon = statusConfig.icon
  const requirementType = request.requirement_type ?? 'obligatoriu'
  const requirementStyle = requirementType === 'obligatoriu'
    ? 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]'
    : requirementType === 'daca_e_cazul'
    ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]'
    : 'bg-paper-sunk text-ink-soft'

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 999999,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)'
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-white w-full max-w-3xl max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header: titlu + status */}
        <div className="px-5 sm:px-6 pt-4 pb-3 border-b border-rule flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 flex items-center gap-2.5 flex-wrap">
              <h2 className="min-w-0 break-words text-xl font-bold leading-tight text-ink">
                {request.name}
              </h2>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                <StatusIcon className="w-3.5 h-3.5" />
                {statusConfig.label}
              </span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${requirementStyle}`}>
                {REQUIREMENT_LABELS[requirementType]}
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-2 -m-1 text-ink-faint hover:text-ink hover:bg-paper-sunk rounded-lg transition-colors flex-shrink-0"
              aria-label="Închide"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-4 space-y-3 bg-white">
          {request.description && (
            <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line break-words max-h-52 overflow-y-auto">
              {request.description}
            </p>
          )}
          {/* Acțiuni rapide, atunci când nu există încă termen și/sau model — pe același rând.
              Termenul și reminderul n-au sens la un document trimis clientului, dar
              reatașarea da: altfel, odată eliminat documentul, cererea rămâne fără
              nicio cale de a primi altul și dispare și din Drive. */}
          {(
            (!isOutgoing && !localDeadline && !editingDeadline) ||
            (!localAttachmentPath && !attachmentMissing) ||
            (!isOutgoing && (request.status === 'pending' || request.status === 'rejected'))
          ) && isAdminOrConsultant && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {!isOutgoing && !localDeadline && !editingDeadline && (
                <button
                  onClick={() => setEditingDeadline(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--sg-accent-soft)] text-[var(--sg-accent)] text-xs font-semibold hover:brightness-90 transition-colors"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Adaugă termen
                </button>
              )}
              {!localAttachmentPath && !attachmentMissing && (
                <>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                    onClick={(e) => { e.currentTarget.value = '' }}
                    onChange={(e) => handleReplacementModel(e.currentTarget.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={attachmentActionLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--sg-accent-soft)] text-[var(--sg-accent)] text-xs font-semibold hover:brightness-90 transition-colors disabled:opacity-50"
                  >
                    {attachmentActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {isOutgoing ? 'Atașează documentul' : 'Atașează model'}
                  </button>
                </>
              )}
              {!isOutgoing && (request.status === 'pending' || request.status === 'rejected') && (() => {
                // Reminder-ul are sens doar dacă avem unde trimite, clientul chiar
                // vede cererea în platformă și există un termen de comunicat.
                const reminderType = getManualReminderType(localDeadline)
                const blockedReason = !clientEmail
                  ? 'Reminder indisponibil'
                  : !clientVisible
                  ? 'Publică cererea întâi'
                  : !reminderType
                  ? 'Fără termen limită'
                  : null
                if (blockedReason !== null || !reminderType) {
                  return (
                    <span
                      title={blockedReason ?? undefined}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-paper-sunk text-xs text-ink-faint"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      {blockedReason ?? 'Reminder indisponibil'}
                    </span>
                  )
                }

                const threshold = reminderState?.current_threshold ?? reminderType
                const thresholdState = reminderState?.thresholds[threshold]
                const sentAt = thresholdState?.sent_at ?? null
                const displayStatus = getReminderDisplayStatus(reminderState, threshold)
                const alreadySent = displayStatus === 'sent'
                const skipped = displayStatus === 'skipped'
                const claimed = displayStatus === 'claimed'
                const badge = REMINDER_BADGE[threshold]
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={sendReminder}
                      disabled={sendingReminder || claimed || reminderStateLoading}
                      title={alreadySent
                        ? `Trimis pe ${sentAt ? new Date(sentAt).toLocaleDateString('ro-RO') : 'recent'} — apasă pentru a retrimite`
                        : 'Trimite emailul de reminder către client'}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-opacity hover:opacity-75 disabled:opacity-60 disabled:cursor-not-allowed ${
                        alreadySent
                          ? 'bg-[var(--sg-ok-soft)] text-[var(--sg-ok)] border-[var(--sg-ok)]'
                          : `${badge.bg} ${badge.text} ${badge.border}`
                      }`}
                    >
                      {sendingReminder
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                      : alreadySent || skipped
                        ? <CheckCircle2 className="w-3 h-3" />
                        : <Mail className="w-3 h-3" />}
                      {sendingReminder ? 'Se trimite...' : reminderStateLoading || claimed ? 'Se verifică...' : alreadySent || skipped ? 'Trimite din nou' : 'Trimite reminder clientului'}
                      <span className="mx-0.5 opacity-50">·</span>
                      {REMINDER_LABELS[threshold]}
                    </button>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Bara de termen. Fără termen, cei care pot edita văd în locul ei
              cum se adaugă unul — altfel un termen șters n-ar mai avea drum
              înapoi. */}
          {!localDeadline && !editingDeadline && isAdminOrConsultant && !isOutgoing && (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <Clock className="w-4 h-4 flex-shrink-0 text-ink-faint" />
              <span>Fără termen limită</span>
              <button
                onClick={() => setEditingDeadline(true)}
                className="text-xs font-semibold text-[var(--sg-accent)] hover:underline flex-shrink-0"
              >
                Adaugă
              </button>
            </div>
          )}
          {!isOutgoing && (localDeadline || editingDeadline) && (
          editingDeadline ? (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 flex-shrink-0 text-ink-faint" />
              <InlineDateEditor
                value={localDeadline}
                saving={savingDeadline}
                allowClear={canEmptyRequiredFields}
                onSave={handleSaveDeadline}
                onCancel={() => setEditingDeadline(false)}
              />
            </div>
          ) : (
            <div className={`flex items-center gap-2 text-sm ${isOverdue ? 'text-[var(--sg-danger)]' : 'text-ink-soft'}`}>
              <Clock className={`w-4 h-4 flex-shrink-0 ${isOverdue ? 'text-[var(--sg-danger)]' : 'text-ink-faint'}`} />
              <span>
                {isOverdue ? 'Termen depășit: ' : 'Termen limită: '}
                <strong>
                  {new Date(localDeadline as string).toLocaleDateString('ro-RO', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </strong>
              </span>
              {isAdminOrConsultant && (
                <button
                  onClick={() => setEditingDeadline(true)}
                  className="text-xs font-semibold text-[var(--sg-accent)] hover:underline flex-shrink-0"
                >
                  Modifică
                </button>
              )}
            </div>
          )
          )}

          {isAdminOrConsultant && !isOutgoing && (
            <ReminderStatus state={reminderState} />
          )}

          {/* Responsabilul cererii — condiție de publicare (#70) */}
          {isAdminOrConsultant && !isOutgoing && (
            editingAssignee ? (
              <div className="flex items-center gap-2">
                <UserRound className="w-4 h-4 flex-shrink-0 text-ink-faint" />
                <select
                  autoFocus
                  value={assigneeDraft}
                  disabled={savingAssignee}
                  onChange={e => setAssigneeDraft(e.target.value)}
                  aria-label="Consultant responsabil"
                  className="text-sm px-2 py-1 border border-[var(--sg-accent)] rounded-lg bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[var(--sg-accent)] disabled:opacity-50"
                >
                  <option value="" disabled={!canEmptyRequiredFields}>Fără responsabil</option>
                  {projectMembers.map(member => (
                    <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleSaveAssignee(assigneeDraft || null)}
                  disabled={savingAssignee || assigneeDraft === (localAssignee ?? '')}
                  className="p-1.5 rounded-lg bg-[var(--sg-ok-soft)] text-[var(--sg-ok)] hover:brightness-90 disabled:opacity-40 flex-shrink-0"
                  title="Salvează responsabilul"
                  aria-label="Salvează responsabilul"
                >
                  {savingAssignee
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Check className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => setEditingAssignee(false)}
                  disabled={savingAssignee}
                  className="p-1.5 rounded-lg bg-paper text-ink-soft hover:bg-rule-strong disabled:opacity-50 flex-shrink-0"
                  aria-label="Renunță"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <UserRound className="w-4 h-4 flex-shrink-0 text-ink-faint" />
                <span>
                  Responsabil:{' '}
                  <strong>{assigneeLabel ?? 'neatribuit'}</strong>
                </span>
                <button
                  onClick={() => { setAssigneeDraft(localAssignee ?? ''); setEditingAssignee(true) }}
                  className="text-xs font-semibold text-[var(--sg-accent)] hover:underline flex-shrink-0"
                >
                  {localAssignee ? 'Modifică' : 'Atribuie'}
                </button>
              </div>
            )
          )}

          {/* Documente: model + răspunsuri client */}
          <div>
            <div className="space-y-3">
              {/* Modelele de completat - dacă există */}
              {requestAttachments.length > 0 && !attachmentMissing && (
                <div>
                  <h3 className="text-sm font-semibold text-ink mb-2">
                    {isOutgoing
                      ? requestAttachments.length > 1 ? `Documente trimise clientului (${requestAttachments.length})` : 'Document trimis clientului'
                      : requestAttachments.length > 1 ? `Modele de completat (${requestAttachments.length})` : 'Modelul de completat'}
                  </h3>
                  <div className="space-y-2">
                    {requestAttachments.map((attachment, index) => {
                      const fileName = attachment.original_name?.trim()
                        || attachment.storage_path.split('/').filter(Boolean).pop()
                        || `Model ${index + 1}`
                      const isDownloading = downloadingId === 'attachment'
                      return (
                        <div
                          key={attachment.id || `${attachment.storage_path}-${index}`}
                          className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-rule px-3 py-2.5"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-paper-sunk text-[var(--sg-accent)] flex items-center justify-center flex-shrink-0">
                              {isDownloading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <FileText className="w-5 h-5" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-ink truncate">{fileName}</p>
                              <p className="text-xs text-ink-soft">
                                {isOutgoing ? 'Doar pentru informare — nu necesită completare sau răspuns.' : 'Se descarcă, se completează și se trimite înapoi'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            {isPreviewableFile({ fileName }) && (
                              <button
                                onClick={() => openAttachmentModel(attachment.id || undefined, fileName)}
                                title="Deschide"
                                aria-label="Deschide"
                                className="p-2 rounded-lg text-ink-faint hover:text-[var(--sg-accent)] hover:bg-paper-sunk transition-colors"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => downloadAttachmentModel(attachment.id || undefined)}
                              disabled={isDownloading}
                              title="Descarcă"
                              aria-label="Descarcă"
                              className="p-2 rounded-lg text-ink-faint hover:text-[var(--sg-accent)] hover:bg-paper-sunk transition-colors disabled:opacity-50"
                            >
                              {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {attachmentMissing && (
                <div className="rounded-xl border-2 border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-[var(--sg-warn)] flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[var(--sg-warn)] mb-1">
                        {isOutgoing
                          ? isAdminOrConsultant ? 'Document indisponibil' : 'Document indisponibil momentan'
                          : isAdminOrConsultant ? 'Model indisponibil' : 'Model indisponibil momentan'}
                      </p>
                      <p className="text-sm text-[var(--sg-warn)] leading-relaxed">
                        {isOutgoing
                          ? isAdminOrConsultant
                            ? 'Fișierul documentului trimis nu mai există în storage. Reîncarcă documentul sau elimină-l din proiect.'
                            : 'Documentul trimis clientului este momentan indisponibil.'
                          : isAdminOrConsultant
                          ? 'Fișierul model nu mai există în storage. Reîncarcă modelul sau elimină-l din cerere.'
                          : 'Modelul pentru această cerere este momentan indisponibil. Echipa îl va atașa când este disponibil; așteaptă actualizarea cererii înainte de completare.'}
                      </p>
                      {isAdminOrConsultant && (
                        <div className="mt-3 flex flex-col sm:flex-row gap-2">
                          <input
                            ref={attachmentInputRef}
                            type="file"
                            className="hidden"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                            onClick={(e) => { e.currentTarget.value = '' }}
                            onChange={(e) => handleReplacementModel(e.currentTarget.files?.[0])}
                          />
                          <button
                            type="button"
                            onClick={() => attachmentInputRef.current?.click()}
                            disabled={attachmentActionLoading}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--sg-warn)] text-white text-xs font-bold hover:brightness-90 disabled:opacity-50"
                          >
                            {attachmentActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            {isOutgoing ? 'Reîncarcă documentul' : 'Reîncarcă model'}
                          </button>
                          <button
                            type="button"
                            onClick={handleRemoveModel}
                            disabled={attachmentActionLoading}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--sg-warn)] text-[var(--sg-warn)] text-xs font-bold hover:bg-[var(--sg-warn-soft)] disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {isOutgoing ? 'Elimină documentul' : 'Elimină modelul'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!isAdminOrConsultant && clientVisible && !isOutgoing && (request.status === 'pending' || request.status === 'rejected') && (
                <div className="rounded-xl border-t border-rule pt-4" onClick={(event) => event.stopPropagation()}>
                  <h3 className="mb-2 text-sm font-semibold text-ink">
                    {request.status === 'rejected' ? 'Reîncarcă documentele' : 'Încarcă documentele'}
                  </h3>

                  {clientUploadFiles.length > 0 && (
                    <div className="mb-3 space-y-2 rounded-xl border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--sg-accent)]">
                          <Files className="h-4 w-4" />
                          {clientUploadFiles.length} {clientUploadFiles.length === 1 ? 'fișier selectat' : 'fișiere selectate'}
                        </div>
                        <button
                          type="button"
                          onClick={clearClientUploadSelection}
                          disabled={clientUploadLoading}
                          className="rounded-lg p-1.5 text-[var(--sg-accent)] hover:bg-white disabled:opacity-50"
                          title="Anulează selecția"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-1">
                        {clientUploadFiles.map(file => (
                          <div key={file.id} className="flex items-center gap-2 text-xs text-[var(--sg-accent)]">
                            <span className="min-w-0 flex-1 truncate">{file.name}</span>
                            <span className="shrink-0 text-[var(--sg-accent)]">{formatFileSize(file.size)}</span>
                            {file.error && <span className="shrink-0 text-[var(--sg-danger)]">{file.error}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block cursor-pointer">
                      <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-rule px-4 py-3 text-ink-soft transition-all hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)]">
                        <Upload className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          {request.status === 'rejected' ? 'Reîncarcă fișiere' : 'Încarcă fișiere'}
                        </span>
                      </div>
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                        onClick={(event) => { event.currentTarget.value = '' }}
                        onChange={(event) => {
                          addClientUploadFiles(event.currentTarget.files)
                          event.currentTarget.value = ''
                        }}
                        disabled={clientUploadLoading}
                        className="hidden"
                      />
                    </label>

                    {canUploadFolder && (
                      <label className="block cursor-pointer">
                        <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-rule px-4 py-3 text-ink-soft transition-all hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)]">
                          <FolderUp className="h-4 w-4" />
                          <span className="text-sm font-medium">
                            {request.status === 'rejected' ? 'Reîncarcă folder' : 'Încarcă folder'}
                          </span>
                        </div>
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                          ref={(element) => {
                            if (!element) return
                            element.setAttribute('webkitdirectory', '')
                            element.setAttribute('directory', '')
                          }}
                          onChange={(event) => {
                            addClientUploadFiles(event.currentTarget.files)
                            event.currentTarget.value = ''
                          }}
                          disabled={clientUploadLoading}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleClientUpload}
                    disabled={clientUploadLoading || clientUploadFiles.every(file => file.error)}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sg-accent)] px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-[var(--sg-accent-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {clientUploadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {clientUploadLoading ? 'Se încarcă...' : `Încarcă${clientUploadFiles.length ? ` (${clientUploadFiles.filter(file => !file.error).length})` : ''}`}
                  </button>
                </div>
              )}

              {!isOutgoing && (
              <div>
                <h3 className="text-sm font-semibold text-ink mb-2">Fișierele trimise de client</h3>

                {groupedVersions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-rule px-4 py-4 text-center">
                    <p className="text-sm text-ink-soft">Clientul nu a trimis încă niciun fișier.</p>
                  </div>
                ) : (() => {
                  const group = groupedVersions.find(v => v.version === selectedVersion) || groupedVersions[0]
                  const opAllId = `all-v${group.version}`

                  return (
                    <div className="space-y-2">
                      {/* Variante (doar când există mai multe) */}
                      {groupedVersions.length > 1 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {groupedVersions.map(v => (
                            <button
                              key={v.version}
                              onClick={() => setSelectedVersion(v.version)}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                                v.version === group.version
                                  ? 'bg-ink text-white'
                                  : 'bg-paper-sunk text-ink-soft hover:bg-paper'
                              }`}
                            >
                              {v === groupedVersions[0] ? `Varianta ${v.version} (recentă)` : `Varianta ${v.version}`}
                            </button>
                          ))}
                        </div>
                      )}

                      {group.createdAt && (
                        <p className="text-xs text-ink-faint">
                          Trimis pe {new Date(group.createdAt).toLocaleDateString('ro-RO', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      )}

                      <div className="rounded-xl border border-rule divide-y divide-rule">
                        {group.files.map(file => {
                          const fileName = file.original_name?.trim() || file.storage_path.split('/').filter(Boolean).pop() || 'fisier'
                          return (
                            <div key={file.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-2.5">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-9 h-9 rounded-lg bg-paper-sunk text-[var(--sg-ok)] flex items-center justify-center flex-shrink-0">
                                  <FileCheck className="w-4 h-4" />
                                </div>
                                <p className="flex-1 min-w-0 text-sm font-semibold text-ink truncate">
                                  {fileName}
                                </p>
                              </div>
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {isPreviewableFile({ fileName }) && (
                                  <button
                                    onClick={() => openUploadedFileById(file.id, fileName)}
                                    title="Deschide"
                                    aria-label="Deschide"
                                    className="p-2 rounded-lg text-ink-faint hover:text-[var(--sg-accent)] hover:bg-paper-sunk transition-colors"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => downloadUploadedFileById(file.id)}
                                  disabled={downloadingId === file.id}
                                  title="Descarcă"
                                  aria-label="Descarcă"
                                  className="p-2 rounded-lg text-ink-faint hover:text-[var(--sg-accent)] hover:bg-paper-sunk transition-colors disabled:opacity-50"
                                >
                                  {downloadingId === file.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Download className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {group.files.length > 1 && (
                        <button
                          onClick={() => downloadAllFilesForVersion(group.version)}
                          disabled={downloadingId === opAllId}
                          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--sg-accent)] hover:underline disabled:opacity-50"
                        >
                          {downloadingId === opAllId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Package className="w-3.5 h-3.5" />
                          )}
                          Descarcă toate cele {group.files.length} fișiere într-o arhivă
                        </button>
                      )}
                    </div>
                  )
                })()}
              </div>
              )}

            </div>
          </div>

          {/* Motivul respingerii anterioare */}
          {request.status === 'rejected' && (
            <div className="rounded-xl bg-[var(--sg-danger-soft)] px-4 py-3">
              <p className="text-xs font-semibold text-[var(--sg-danger)] mb-1">Motivul respingerii</p>
              <p className="text-sm text-[var(--sg-danger)] leading-relaxed">
                {latestRejectionReason || 'Motivul respingerii nu este disponibil pentru acest istoric.'}
              </p>
            </div>
          )}

          {/* Mesaj pentru client - doar la verificare, doar pentru echipă */}
          {isAdminOrConsultant && request.status === 'review' && (
            <div>
              <label className="block text-sm font-semibold text-ink mb-2">
                Mesaj pentru client
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Opțional la aprobare, obligatoriu la respingere"
                rows={3}
                className="w-full p-3 rounded-xl border border-rule text-sm focus:border-[var(--sg-accent)] focus:ring-2 focus:ring-[var(--sg-accent)] outline-none resize-none transition-colors"
              />
            </div>
          )}
        </div>

        {/* Footer - doar când există acțiuni de făcut */}
        {isAdminOrConsultant && request.status === 'review' && (
          <div className="px-5 sm:px-6 py-4 border-t border-rule flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={confirmReject}
              disabled={actionLoading}
              className="flex-1 py-3 rounded-xl text-sm font-bold border border-[var(--sg-danger)] text-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              Respinge
            </button>

            <button
              onClick={handleApprove}
              disabled={actionLoading}
              className="flex-[2] py-3 rounded-xl text-sm font-bold text-white bg-[var(--sg-ok)] hover:brightness-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {actionLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Se procesează...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Aprobă documentul
                </>
              )}
            </button>
          </div>
        )}
      </div>

    </div>
  )

  return createPortal(modalContent, document.body)
}
