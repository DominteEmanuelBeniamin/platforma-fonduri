/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useEffect, useMemo, useState, JSX, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  FileText,
  Plus,
  Download,
  Upload,
  CheckCircle2,
  Calendar,
  X,
  Eye,
  MessageSquare,
  FileSpreadsheet,
  FolderUp,
  AlertCircle,
  GripVertical,
  Image as ImageIcon,
  File,
  Trash2,
  Pencil,
  Archive,
} from 'lucide-react'
import DocumentModal from './DocumentModal'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import RowActionsMenu from './RowActionsMenu'
import PublishStatusControl from './PublishStatusControl'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import { usePatchField } from '@/hooks/usePatchField'
import { useReminderStates } from '@/hooks/useReminderStates'
import type { PickedFile } from './document-requests/types'
import SendDocumentModal from './document-requests/SendDocumentModal'
import RequestFormDialog from './document-requests/RequestFormDialog'
import ClientUploadDialog from './document-requests/ClientUploadDialog'
import { buildPreviewPageUrl, isPreviewableFile, openInNewTab, downloadUrl } from '@/lib/file-preview'
import { publishBlockers } from '@/lib/publish-rules'
import {
  getFileExtension,
  validateUploadFile,
  type UploadValidationError,
} from '@/lib/client-upload'
import { RequirementType } from '@/lib/requirement-type'
import { Spinner } from '@/components/ui/Spinner'
import { isRequestFinal, mergeVisibleOrder } from '@/lib/completion'
import { countLabel } from '@/lib/count-label'
import HiddenFinalRow from './HiddenFinalRow'
import { CELL, DeadlineCell, StatusCell, formatShortDate } from './project-table/cells'
import { activityColumnsTemplate } from './project-table/TableGroup'
import { closedRequestClientNote, displayedRequestStatus, requestStatusInfo, type RequestStatus } from '@/lib/request-status'
import { PROJECT_CLOSED_CLIENT_NOTE } from '@/lib/project-lifecycle'

interface DocumentRequest {
  id: string
  name: string
  description: string | null
  requirement_type?: RequirementType
  status: RequestStatus
  /** Starea la care revine o cerere închisă (#109). */
  status_before_close?: 'pending' | 'rejected' | 'approved' | null
  closed_at?: string | null
  closer?: { id: string; full_name: string | null } | null
  visibility?: 'draft' | 'published'
  is_outgoing?: boolean
  activity_id?: string | null
  activity?: {
    id: string
    name: string
    visibility?: 'draft' | 'published'
    assigned_to?: string | null
    phase?: { id: string; name?: string | null; visibility?: 'draft' | 'published' } | null
  } | null
  order_index?: number
  attachment_path: string | null
  attachment_original_name?: string | null
  attachment_missing_at?: string | null
  attachment_missing_checked_at?: string | null
  attachments?: {
    id: string
    storage_path: string
    original_name: string | null
    mime_type?: string | null
    file_size?: number | null
    order_index?: number
    missing_at?: string | null
    missing_checked_at?: string | null
  }[]
  deadline_at: string | null
  created_by: string | null
  created_at: string
  deleted_at?: string | null
  deleted_by?: string | null
  creator?: { full_name: string | null; email: string | null; is_active?: boolean | null }
  assigned_to: string | null
  assigned_consultant: { id: string; full_name: string | null; email: string; is_active?: boolean | null } | null
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
    reviewed_by: { id: string; full_name: string | null; is_active?: boolean | null } | null
  } | null
}




function getRequestAttachments(request: DocumentRequest) {
  return request.attachments?.length
    ? request.attachments
    : request.attachment_path
    ? [{
        id: undefined,
        storage_path: request.attachment_path,
        original_name: request.attachment_original_name || null,
        missing_at: request.attachment_missing_at || null,
      }]
    : []
}

/** Câte fișiere a încărcat clientul la cerere (fără cele șterse). */
function uploadedFileCount(request: DocumentRequest): number {
  return (request.files ?? []).filter(file => !file.deleted_at).length
}

/** Când a încărcat clientul ultimul fișier — „Data realizare” din monday. */
function lastUploadAt(request: DocumentRequest): string | null {
  const dates = (request.files ?? []).filter(file => !file.deleted_at).map(file => file.created_at)
  return dates.length ? dates.reduce((latest, date) => (date > latest ? date : latest)) : null
}

function validateFile(file: File, existingFiles: PickedFile[]): UploadValidationError | null {
  return validateUploadFile(file, existingFiles)
}

function getFileIcon(file: PickedFile): JSX.Element {
  const ext = getFileExtension(file.name)
  
  if (file.type.startsWith('image/')) {
    return <ImageIcon className="w-5 h-5" />
  }
  
  if (ext === 'pdf' || file.type === 'application/pdf') {
    return <FileText className="w-5 h-5" />
  }
  
  if (['xls', 'xlsx'].includes(ext) || file.type.includes('spreadsheet')) {
    return <FileSpreadsheet className="w-5 h-5" />
  }
  
  if (['doc', 'docx'].includes(ext) || file.type.includes('document')) {
    return <FileText className="w-5 h-5" />
  }
  
  return <File className="w-5 h-5" />
}

/** Butoanele mici de încărcare de sub rândul cererii. */
const uploadButtonClass =
  'inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-plate)] border border-dashed border-rule-strong bg-plate px-3 text-ink-soft ' +
  'transition-colors duration-[120ms] hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)] pointer-fine:min-h-8'

function joinVisibilityRequirements(items: string[]) {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} și ${items[items.length - 1]}`
}

interface DocumentRequestsProps {
  projectId: string
  /** Dacă e furnizat, filtrează cererile după activity_id */
  activityId?: string | null
  /** Titlul activității afișat în header */
  activityName?: string
  parentActivityVisibility?: 'draft' | 'published'
  /** Consultantul activității-părinte — acoperă cererile care nu au unul al lor (#70) */
  parentActivityAssignee?: string | null
  /** Consultantul general al proiectului — același rol, pentru cererile generale */
  generalConsultantId?: string | null
  parentPhaseName?: string
  parentPhaseVisibility?: 'draft' | 'published'
  /** Consultanții proiectului, pentru atribuirea unei cereri */
  projectMembers?: { id: string; full_name: string | null; email: string; is_active?: boolean | null }[]
  /** Date externe de la pagina părinte (evită fetch duplicat) */
  externalRequests?: any[]
  /** Callback refresh pentru pagina părinte */
  onRefresh?: () => void | Promise<void>
  /** Date client pentru reminder-uri — transmise din pagina proiectului */
  clientEmail?: string | null
  clientName?: string | null
  projectTitle?: string
  /** Id-ul unei cereri de deschis automat din panoul „Ce ai de făcut”. */
  autoOpenRequestId?: string | null
  /** Închide și redeschide cereri: adminul și seniorul membru (#109, D1). */
  canCloseRequests?: boolean
  /**
   * Cererile finalizate ascunse acum (#109, A9). Ascunderea e doar la randare:
   * lista completă rămâne pentru reordonare, contoare și fișa deschisă.
   */
  hiddenRequestIds?: ReadonlySet<string>
  /** Arată cererile ascunse din lista asta. */
  onRevealRequests?: (ids: string[]) => void
  /** Proiectul e încheiat: lista se poate doar citi, de oricine (8 octombrie 2026). */
  readOnly?: boolean
  /**
   * `sent`: doar documentele trimise clientului, ca grup separat de cererile
   * generale (S-20). Butonul „Trimite documente” stă în antetul grupului, deci
   * dialogul lui se deschide din pagină (`sendOpen`).
   */
  section?: 'requests' | 'sent'
  sendOpen?: boolean
  onSendOpenChange?: (open: boolean) => void
}

/** Respinsă acum sau închisă din „Respins” (#109): motivul respingerii rămâne la vedere. */
const wasRejected = (req: { status?: string | null; status_before_close?: string | null }) =>
  req.status === 'rejected' || (req.status === 'closed' && req.status_before_close === 'rejected')

export default function DocumentRequests({
  projectId,
  activityId,
  activityName,
  parentActivityVisibility,
  parentActivityAssignee,
  generalConsultantId,
  parentPhaseName,
  parentPhaseVisibility,
  projectMembers = [],
  externalRequests,
  onRefresh,
  clientEmail,
  clientName,
  projectTitle,
  autoOpenRequestId,
  canCloseRequests = false,
  hiddenRequestIds,
  onRevealRequests,
  readOnly = false,
  section = 'requests',
  sendOpen,
  onSendOpenChange,
}: DocumentRequestsProps) {
  const { loading: authLoading, token, profile, apiFetch } = useAuth()
  const { showToast, confirm } = useToast()
  const patchField = usePatchField()

  const [internalRequests, setInternalRequests] = useState<DocumentRequest[]>([])
  const [loading, setLoading] = useState(!externalRequests)
  const [showForm, setShowForm] = useState(false)
  const [editingRequest, setEditingRequest] = useState<DocumentRequest | null>(null)
  
  const formScrollY = useRef(0)

  useEffect(() => {
    if (!showForm) return
    formScrollY.current = window.scrollY
    requestAnimationFrame(() => window.scrollTo(0, formScrollY.current))
    return () => { requestAnimationFrame(() => window.scrollTo(0, formScrollY.current)) }
  }, [showForm])

  // Modal state
  const [selectedRequest, setSelectedRequest] = useState<DocumentRequest | null>(null)

  // Create request form
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<RequirementType>('obligatoriu')
  const [templateFiles, setTemplateFiles] = useState<File[]>([])
  const [templateAttachments, setTemplateAttachments] = useState<NonNullable<DocumentRequest['attachments']>>([])
  const [templateAttachmentsTouched, setTemplateAttachmentsTouched] = useState(false)
  const [templateFileError, setTemplateFileError] = useState('')
  const [deadline, setDeadline] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Trimitere documente către client (is_outgoing)
  const [ownSendOpen, setOwnSendOpen] = useState(false)
  const showSendDoc = sendOpen ?? ownSendOpen
  const setShowSendDoc = onSendOpenChange ?? setOwnSendOpen
  const [selectedOutgoingDoc, setSelectedOutgoingDoc] = useState<DocumentRequest | null>(null)
  const [sendFiles, setSendFiles] = useState<PickedFile[]>([])
  const [sendSubmitting, setSendSubmitting] = useState(false)

  // Încărcarea clientului: dialogul unei singure cereri. Fișierele alese stau
  // în dialog, nu aici — o listă comună pe activitate le trimitea la cererea
  // aleasă ultima (feedback-ul lui Sandu, 21 octombrie 2026).
  const [uploadTarget, setUploadTarget] = useState<{ request: DocumentRequest; startWith: 'files' | 'folder'; opener: HTMLElement } | null>(null)
  const [requestToDelete, setRequestToDelete] = useState<DocumentRequest | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [missingAttachments, setMissingAttachments] = useState<Set<string>>(() => new Set())

  const canUploadFolder =
    typeof window !== 'undefined' &&
    'webkitdirectory' in HTMLInputElement.prototype &&
    !window.matchMedia?.('(pointer: coarse)').matches &&
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

  const getPublishRequestCopy = (requestId: string) => {
    const request = requests.find(req => req.id === requestId) ?? outgoingDocs.find(req => req.id === requestId)
    const isOutgoing = Boolean(request?.is_outgoing)
    const noun = isOutgoing ? 'Documentul' : 'Cererea'
    const lowerNoun = request?.is_outgoing ? 'documentul' : 'cererea'
    const publishedForm = isOutgoing ? 'publicat' : 'publicată'
    const visibleForm = isOutgoing ? 'vizibil' : 'vizibilă'
    const missingParents = []

    const phaseVisibility = request?.activity?.phase?.visibility ?? parentPhaseVisibility
    const activityVisibility = request?.activity?.visibility ?? parentActivityVisibility

    if (request?.activity_id && phaseVisibility !== 'published') {
      missingParents.push(`faza „${request.activity?.phase?.name || parentPhaseName || 'părinte'}”`)
    }
    if (request?.activity_id && activityVisibility !== 'published') {
      missingParents.push(`activitatea „${request.activity?.name || activityName || 'părinte'}”`)
    }

    return {
      title: request?.is_outgoing ? 'Publică documentul?' : 'Publică cererea?',
      description: missingParents.length
        ? `${noun} va fi ${publishedForm}, dar clientul va vedea ${lowerNoun} doar după ce publici ${joinVisibilityRequirements(missingParents)}.`
        : `${noun} va deveni ${visibleForm} clientului.`,
    }
  }

  // Vizibilitatea efectivă pentru client: cererea publicată ȘI, dacă atârnă de o
  // activitate, activitatea + faza publicate. Aceleași reguli ca lib/client-visibility,
  // aplicate pe datele deja încărcate în componentă.
  const isRequestClientVisible = (request: DocumentRequest) => {
    if ((request.visibility ?? 'draft') !== 'published') return false
    if (!request.activity_id) return true
    const phaseVisibility = request.activity?.phase?.visibility ?? parentPhaseVisibility
    const activityVisibility = request.activity?.visibility ?? parentActivityVisibility
    return phaseVisibility === 'published' && activityVisibility === 'published'
  }

  const publishRequest = async (requestId: string) => {
    const copy = getPublishRequestCopy(requestId)
    if (!await confirm({
      title: copy.title,
      description: copy.description,
      confirmText: 'Publică',
    })) return
    // `patchField` a arătat deja motivul și aruncă mai departe; aici nu mai e
    // nimic de făcut cu eroarea.
    try {
      await patchField(`/api/document-requests/${requestId}`, { visibility: 'published' }, {
        fallback: 'Nu am putut publica cererea. Reîncearcă.',
        success: 'Cererea a fost publicată.',
        refresh: fetchRequests,
      })
      setSelectedOutgoingDoc(prev => prev?.id === requestId ? { ...prev, visibility: 'published' } : prev)
    } catch { /* mesajul e pe ecran */ }
  }

  const saveRequestDeadline = (requestId: string, deadline: string) =>
    patchField(
      `/api/document-requests/${requestId}`,
      { deadline_at: deadline },
      {
        fallback: 'Nu am putut salva termenul. Reîncearcă.',
        success: 'Termenul limită a fost salvat.',
        refresh: fetchRequests,
      },
    )

  // Responsabilul unei cereri: al ei sau, în lipsă, cel al părintelui —
  // consultantul activității, respectiv consultantul general al proiectului
  // pentru cererile generale. Aceeași regulă ca pe server.
  const requestBlockers = (request: DocumentRequest) => publishBlockers({
    kind: 'document',
    isOutgoing: Boolean(request.is_outgoing),
    currentDeadline: request.deadline_at,
    currentAssignee: request.assigned_to,
    parentAssignee: request.activity_id
      ? request.activity?.assigned_to ?? parentActivityAssignee ?? null
      : generalConsultantId ?? null,
  })

  // Requests derivate: externe filtrate sau interne
  const requests = useMemo(() => {
    const src = (externalRequests ?? internalRequests).filter((r: any) => !r.is_outgoing)
    if (activityId !== undefined) {
      // activityId=string -> filtrare; activityId=null -> fără activitate (generale)
      return src.filter((r: any) =>
        activityId ? r.activity_id === activityId : !r.activity_id
      )
    }
    return src
  }, [externalRequests, internalRequests, activityId])

  // Modalul primește aceeași cerere reîmprospătată ca lista după upload/review;
  // altfel rămâne cu obiectul capturat la click și afișează statusul/fișierele vechi.
  // Căutarea merge pe sursa nefiltrată: o cerere care iese din filtrul curent —
  // mutată la „Cereri generale” după ștergerea activității, de pildă — nu are de
  // ce să închidă modalul deschis. Se închide doar când chiar a dispărut.
  useEffect(() => {
    if (!selectedRequest) return
    const source = externalRequests ?? internalRequests
    const refreshed = source.find((request: any) => request.id === selectedRequest.id) ?? null
    if (refreshed !== selectedRequest) setSelectedRequest(refreshed)
  }, [externalRequests, internalRequests, selectedRequest])

  const reminderIds = selectedRequest ? [selectedRequest.id] : []
  const { states: reminderStates, refresh: refreshReminderStates, loading: reminderStatesLoading } = useReminderStates(
    apiFetch,
    'request',
    reminderIds,
    profile?.role === 'admin' || profile?.role === 'consultant',
  )

  // Documente trimise de consultant CĂTRE client (informative) — nivel proiect
  const outgoingDocs = useMemo(() => {
    return (externalRequests ?? internalRequests).filter((r: any) => r.is_outgoing && !r.deleted_at)
  }, [externalRequests, internalRequests])

  useEffect(() => {
    if (!autoOpenRequestId) return
    const request = requests.find(r => r.id === autoOpenRequestId)
    if (request) setSelectedRequest(request)
  }, [autoOpenRequestId, requests])

  const isAdminOrConsultant = profile?.role === 'admin' || profile?.role === 'consultant'
  const isClient = profile?.role === 'client'
  // Echipa vede tot, dar într-un proiect încheiat nu mai adaugă, nu mai
  // modifică și nu mai reordonează nimic; clientul nu mai încarcă.
  const canChange = isAdminOrConsultant && !readOnly

  // Cererile de afișat: fără cele finalizate ascunse (#109). `requests` rămâne
  // lista completă — din ea se trimite ordinea, ca cele ascunse să-și păstreze
  // locul (`mergeVisibleOrder`).
  const visibleRequests = useMemo(
    () => (hiddenRequestIds ? requests.filter(r => !hiddenRequestIds.has(r.id)) : requests),
    [requests, hiddenRequestIds],
  )
  const hiddenHere = requests.length - visibleRequests.length

  // Drag & drop reorder — override temporar peste ordinea din API până la refresh
  const [draggedReqId, setDraggedReqId] = useState<string | null>(null)
  const [reqOrder, setReqOrder] = useState<string[] | null>(null)

  const displayRequests = reqOrder
    ? reqOrder
        .map(id => visibleRequests.find((r: any) => r.id === id))
        .filter((r): r is DocumentRequest => !!r)
    : visibleRequests

  const handleReqDragStart = (e: React.DragEvent, reqId: string) => {
    setDraggedReqId(reqId)
    setReqOrder(visibleRequests.map((r: any) => r.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleReqDragOver = (e: React.DragEvent, targetId: string) => {
    if (!draggedReqId || !reqOrder) return
    e.preventDefault()
    if (draggedReqId === targetId) return
    const from = reqOrder.indexOf(draggedReqId)
    const to = reqOrder.indexOf(targetId)
    if (from === -1 || to === -1 || from === to) return
    const next = [...reqOrder]
    next.splice(from, 1)
    next.splice(to, 0, draggedReqId)
    setReqOrder(next)
  }

  const handleReqDragEnd = async () => {
    const order = reqOrder
    setDraggedReqId(null)
    if (!order) return
    const original = visibleRequests.map((r: any) => r.id)
    const unchanged = order.length === original.length && original.every((id, i) => id === order[i])
    if (unchanged) { setReqOrder(null); return }
    // Ruta scrie exact `1..n` primit; cu cereri ascunse, lista afișată nu e
    // toată lista, deci se trimite ordinea completă, cu cele ascunse pe loc.
    const fullOrder = mergeVisibleOrder(requests.map((r: any) => r.id), order)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/document-requests/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: fullOrder.map((id, i) => ({ id, order_index: i + 1 })) }),
      })
      if (res.ok) await Promise.resolve(onRefresh ? onRefresh() : fetchRequests())
      else { showToast('Nu am putut salva ordinea. Reîncearcă.', 'error') }
    } finally { setReqOrder(null) }
  }

  const sendFileStats = useMemo(() => {
    const total = sendFiles.length
    const valid = sendFiles.filter(f => !f.validationError && f.uploadStatus !== 'success').length
    const invalid = sendFiles.filter(f => f.validationError).length
    const totalSize = sendFiles.reduce((sum, f) => sum + f.size, 0)
    const uploading = sendFiles.filter(f => f.uploadStatus === 'uploading').length

    return { total, valid, invalid, totalSize, uploading }
  }, [sendFiles])

  const closeSendDoc = () => {
    if (sendSubmitting) return
    setShowSendDoc(false)
    setSendFiles([])
  }

  const processSendFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return

    setSendFiles(prev => {
      const next: PickedFile[] = []

      for (const file of files) {
        const picked: PickedFile = {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          relativePath: null,
          uploadStatus: 'pending',
          uploadProgress: 0,
        }
        const error = validateFile(file, [...prev, ...next])
        if (error) picked.validationError = error
        next.push(picked)
      }

      return [...prev, ...next]
    })
  }

  const removeSendFile = (fileId: string) => {
    setSendFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const updateSendFile = (fileId: string, patch: Partial<PickedFile>) => {
    setSendFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...patch } : f))
  }

  /** `''` ca nume: descarcă, dar păstrează numele trimis de server. */
  const forceDownload = (url: string) => downloadUrl(url, '')

  const fetchRequests = async () => {
    // Dacă avem date externe, delegăm refresh-ul la pagina părinte
    if (externalRequests !== undefined) {
      await onRefresh?.()
      return
    }
    if (!projectId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/document-requests`, { method: 'GET' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error('Nu am putut încărca cererile de documente.')
      setInternalRequests(data?.requests || [])
    } catch (e: any) {
      console.error('Eroare la încărcare cereri:', e.message)
      setInternalRequests([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (externalRequests !== undefined) { setLoading(false); return }
    if (authLoading) return
    if (!token) return
    fetchRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, projectId, externalRequests])


  const handleTemplateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? [])
    e.currentTarget.value = ''
    if (files.length === 0) return

    const accepted: File[] = []
    const errors: string[] = []
    for (const file of files) {
      const existing = [...templateFiles, ...accepted].map(candidate => ({
        id: candidate.name,
        file: candidate,
        name: candidate.name,
        size: candidate.size,
        type: candidate.type,
        relativePath: null,
      }))
      const error = validateFile(file, existing)
      if (error) {
        errors.push(`${file.name}: ${error.message}`)
      } else {
        accepted.push(file)
      }
    }

    if (accepted.length > 0) {
      setTemplateFiles(current => [...current, ...accepted])
      setTemplateAttachmentsTouched(true)
    }
    setTemplateFileError(errors.join('\n'))
  }

  const resetRequestForm = () => {
    setName('')
    setDescription('')
    setCategory('obligatoriu')
    setTemplateFiles([])
    setTemplateAttachments([])
    setTemplateAttachmentsTouched(false)
    setTemplateFileError('')
    setDeadline('')
    setEditingRequest(null)
  }

  const openCreateForm = () => {
    if (showForm && !editingRequest) {
      setShowForm(false)
      resetRequestForm()
      return
    }
    resetRequestForm()
    setShowForm(true)
  }

  const openEditForm = (request: DocumentRequest) => {
    setEditingRequest(request)
    setName(request.name)
    setDescription(request.description ?? '')
    setCategory(request.requirement_type ?? 'obligatoriu')
    setTemplateFiles([])
    setTemplateAttachments(request.attachments?.length
      ? request.attachments
      : request.attachment_path
      ? [{
          id: `legacy-${request.id}`,
          storage_path: request.attachment_path,
          original_name: request.attachment_original_name || null,
          missing_at: request.attachment_missing_at || null,
          missing_checked_at: request.attachment_missing_checked_at || null,
        }]
      : [])
    setTemplateAttachmentsTouched(false)
    setTemplateFileError('')
    setDeadline(request.deadline_at ? request.deadline_at.slice(0, 10) : '')
    setShowForm(true)
  }

  const closeRequestForm = () => {
    setShowForm(false)
    resetRequestForm()
  }

  const fetchAttachmentSignedUrl = async (requestId: string, disposition?: 'inline', attachmentId?: string) => {
    const res = await apiFetch(`/api/document-requests/${requestId}/attachment/signed-download`, {
      method: 'POST',
      body: JSON.stringify({ expiresIn: 60 * 5, ...(disposition ? { disposition } : {}), attachment_id: attachmentId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 404) {
        setMissingAttachments(prev => new Set(prev).add(requestId))
        await fetchRequests()
      }
      showToast('Nu am putut descărca modelul. Reîncearcă.', 'error')
      return null
    }
    return data.url as string
  }

  const downloadAttachmentModel = async (requestId: string, attachmentId?: string) => {
    const url = await fetchAttachmentSignedUrl(requestId, undefined, attachmentId)
    if (url) forceDownload(url)
  }

  const handleDeleteRequest = async () => {
    if (!requestToDelete) return

    setDeleteLoading(true)
    try {
      const res = await apiFetch(`/api/document-requests/${requestToDelete.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ delete_reason: null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Nu s-a putut șterge cererea')

      setRequestToDelete(null)
      await fetchRequests()
    } catch {
      showToast('Nu am putut șterge cererea. Reîncearcă.', 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  // Create request (admin/consultant) via API, with optional template upload
  const handleSubmit = async (e: React.FormEvent, text: { name: string; description: string } = { name, description }) => {
    e.preventDefault()
    const name = text.name
    const description = text.description
    if (!name.trim()) return
    setSubmitting(true)

    try {
      let uploadedAttachments: { storage_path: string; original_name: string | null; mime_type?: string | null; file_size?: number | null }[] | undefined =
        editingRequest
          ? templateAttachmentsTouched ? templateAttachments.map(attachment => ({
              storage_path: attachment.storage_path,
              original_name: attachment.original_name,
              mime_type: attachment.mime_type ?? null,
              file_size: attachment.file_size ?? null,
            })) : undefined
          : []

      if (templateFiles.length > 0) {
        uploadedAttachments = uploadedAttachments ?? templateAttachments.map(attachment => ({
          storage_path: attachment.storage_path,
          original_name: attachment.original_name,
          mime_type: attachment.mime_type ?? null,
          file_size: attachment.file_size ?? null,
        }))
        for (const templateFile of templateFiles) {
          const initRes = await apiFetch(`/api/projects/${projectId}/document-requests/attachment/init`, {
            method: 'POST',
            body: JSON.stringify({
              name: templateFile.name,
              size: templateFile.size,
              type: templateFile.type || 'application/octet-stream',
            }),
          })
          const init = await initRes.json().catch(() => ({}))
          if (!initRes.ok) throw new Error(init?.error || 'Init attachment upload failed')

          const putRes = await fetch(init.signedUploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${init.token}`,
              'Content-Type': templateFile.type || 'application/octet-stream',
            },
            body: templateFile,
          })
          if (!putRes.ok) throw new Error('Attachment upload failed')
          uploadedAttachments.push({
            storage_path: init.storagePath,
            original_name: templateFile.name,
            mime_type: templateFile.type || 'application/octet-stream',
            file_size: templateFile.size,
          })
        }
      }

      const requestBody: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        requirement_type: category,
        deadline_at: deadline || null,
      }

      if (uploadedAttachments !== undefined) {
        requestBody.attachments = uploadedAttachments
        requestBody.attachment_path = uploadedAttachments[0]?.storage_path || null
        requestBody.attachment_original_name = uploadedAttachments[0]?.original_name || null
      }

      if (!editingRequest) {
        requestBody.activity_id = activityId || null
      }

      const res = await apiFetch(
        editingRequest
          ? `/api/document-requests/${editingRequest.id}`
          : `/api/projects/${projectId}/document-requests`,
        {
          method: editingRequest ? 'PATCH' : 'POST',
          body: JSON.stringify(requestBody),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || (editingRequest ? 'Update request failed' : 'Create request failed'))

      closeRequestForm()
      await fetchRequests()
    } catch {
      showToast('Nu am putut salva cererea. Reîncearcă.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Trimite documente către client: fiecare fișier devine o intrare is_outgoing.
  const handleSendDocument = async (e: React.FormEvent) => {
    e.preventDefault()
    const filesToSend = sendFiles.filter(f => !f.validationError && f.uploadStatus !== 'success')
    if (filesToSend.length === 0) return

    setSendSubmitting(true)
    const failures: { id: string; name: string; error: string }[] = []
    let successful = 0

    try {
      for (const pickedFile of filesToSend) {
        updateSendFile(pickedFile.id, { uploadStatus: 'uploading', uploadProgress: 0, uploadError: undefined })

        try {
          const initRes = await apiFetch(`/api/projects/${projectId}/document-requests/attachment/init`, {
            method: 'POST',
            body: JSON.stringify({
              name: pickedFile.name,
              size: pickedFile.size,
              type: pickedFile.type,
            }),
          })
          const init = await initRes.json().catch(() => ({}))
          if (!initRes.ok) throw new Error(init?.error || 'Inițializarea încărcării a eșuat')

          const putRes = await fetch(init.signedUploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${init.token}`,
              'Content-Type': pickedFile.type,
            },
            body: pickedFile.file,
          })
          if (!putRes.ok) throw new Error('Încărcarea fișierului a eșuat')

          const res = await apiFetch(`/api/projects/${projectId}/document-requests`, {
            method: 'POST',
            body: JSON.stringify({
              name: pickedFile.name,
              is_outgoing: true,
              attachment_path: init.storagePath,
              attachment_original_name: pickedFile.name,
              activity_id: null,
            }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data?.error || 'Trimiterea documentului a eșuat')

          successful += 1
          updateSendFile(pickedFile.id, { uploadStatus: 'success', uploadProgress: 100 })
        } catch {
          const message = 'Trimiterea documentului a eșuat. Reîncearcă.'
          failures.push({ id: pickedFile.id, name: pickedFile.name, error: message })
          updateSendFile(pickedFile.id, { uploadStatus: 'error', uploadError: message })
        }
      }

      if (successful > 0) await fetchRequests()

      if (failures.length === 0) {
        setSendFiles([])
        setShowSendDoc(false)
      } else {
        setSendFiles(prev => prev.filter(f => f.validationError || failures.some(fail => fail.id === f.id)))
        showToast(`${successful} documente au fost trimise, iar ${failures.length} au eșuat. Verifică lista fișierelor.`, 'warning')
      }
    } finally {
      setSendSubmitting(false)
    }
  }

  type ReqFile = NonNullable<DocumentRequest['files']>[number]

  const requestMeta = useMemo(() => {
    const map = new Map<
      string,
      {
        responseCount: number
        latestVersion: number | null
        latestFiles: ReqFile[]
        latestFile: ReqFile | null
        rejectionReason: string | null
      }
    >()

    for (const req of requests) {
      const files: ReqFile[] = ((req.files ?? []) as ReqFile[]).filter(file => !file.deleted_at)

      if (files.length === 0) {
        map.set(req.id, {
          responseCount: 0,
          latestVersion: null,
          latestFiles: [],
          latestFile: null,
          rejectionReason: wasRejected(req) ? req.latest_rejection?.reason ?? null : null
        })
        continue
      }

      const byVersion = new Map<number, ReqFile[]>()
      for (const f of files) {
        const arr = byVersion.get(f.version_number) ?? []
        arr.push(f)
        byVersion.set(f.version_number, arr)
      }

      const versions = Array.from(byVersion.keys())
      const latestVersion = versions.length ? Math.max(...versions) : null

      const latestFiles =
        latestVersion === null
          ? []
          : [...(byVersion.get(latestVersion) ?? [])].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )

      map.set(req.id, {
        responseCount: byVersion.size,          
        latestVersion,
        latestFiles,
        latestFile: latestFiles[0] ?? null,
        rejectionReason: wasRejected(req) ? req.latest_rejection?.reason ?? null : null
      })
    }

    return map
  }, [requests])


  // Starea vine din dicționarul comun (#109): o valoare necunoscută nu mai cade
  // pe „De încărcat", iar o cerere închisă are cuvântul și semnul ei — în afară
  // de cea închisă din „Aprobat”, care se arată tot „Aprobat”.
  const statusLabel = (req: { status: string; status_before_close?: string | null }) => {
    const info = requestStatusInfo(displayedRequestStatus(req))
    return isClient ? info.clientLabel : info.label
  }
  const isEmbedded = activityId !== undefined
  // Coloanele sub-tabelului: „Vizibil clientului” e a echipei, acțiunile — ale
  // cui poate modifica. Aceleași condiții desenează antetul și rândurile.
  // Aceleași coloane ca rândurile de activitate, cu aceleași nume, ca Status, Documente,
  // Termen și Vizibil să stea unele sub altele (feedback-ul lui Sandu, 22
  // octombrie). Numele cererii ia locul „Activitate” + „Responsabil”.
  const requestColumns = activityColumnsTemplate({ visibility: isAdminOrConsultant, actions: canChange })

  // Grila documentelor trimise: Document, Fișiere, Trimis la, Vizibil
  // clientului (echipa), „⋯” (cine poate modifica).
  const sentColumns = [
    'minmax(10rem,1fr)',
    'minmax(8rem,16rem)',
    '5.75rem',
    isAdminOrConsultant && 'minmax(8rem,10rem)',
    canChange && '2.5rem',
  ].filter(Boolean).join(' ')

  if (loading) {
    return (
      <div className={`bg-white min-h-[400px] flex items-center justify-center ${isEmbedded ? '' : 'rounded-[var(--radius-plate)] border border-rule'}`}>
        <div className="flex flex-col items-center gap-4">
          <Spinner />
          <p className="text-sm text-ink-soft font-medium">Se încarcă documentele...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={`bg-white ${isEmbedded ? '' : 'rounded-[var(--radius-plate)] border border-rule shadow-sm overflow-hidden'}`}>
        {!isEmbedded && (
        <div className={`${isEmbedded ? 'flex items-center justify-between px-4 pb-5 sm:pb-6 border-b border-rule' : 'p-4 sm:p-5 border-b border-rule'}`}>
          <div className={`flex items-center ${isEmbedded ? 'w-full justify-between' : 'flex-col gap-3 xl:flex-row xl:items-start xl:justify-between'}`}>
            {!isEmbedded && <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-[var(--radius-plate)] bg-[var(--sg-accent)] flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-snug text-ink break-words">
                  {activityName ?? (isClient ? 'Documente de completat' : 'Cereri documente')}
                </h2>
                <p className="text-xs text-ink-soft hidden sm:block">
                  {activityName ? `${requests.length} cereri` : (isClient ? 'Descarcă, completează și încarcă' : `${requests.length} cereri în total`)}
                </p>
              </div>
            </div>}

            {canChange && (
              <div className={`flex flex-wrap items-center gap-2 ${isEmbedded ? 'order-first' : 'w-full xl:w-auto xl:flex-shrink-0'}`}>
                {!activityId && (
                  <button
                    type="button"
                    title="Trimite documente"
                    onClick={() => setShowSendDoc(true)}
                    className="flex items-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2.5 rounded-[var(--radius-plate)] text-sm font-medium transition-all bg-[var(--sg-ok)] text-white hover:brightness-90"
                  >
                    <Upload className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Trimite documente</span><span className="sr-only sm:hidden">Trimite documente</span>
                  </button>
                )}
                <button data-tooltip="Cere clientului un document nou"
                  onClick={openCreateForm}
                  className="flex items-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2.5 rounded-[var(--radius-plate)] text-sm font-medium transition-all bg-ink text-white hover:brightness-90"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Cerere de document nouă</span><span className="sr-only sm:hidden">Cerere de document nouă</span>
                </button>
              </div>
            )}
          </div>
        </div>
        )}

      <RequestFormDialog
        open={showForm && canChange}
        editing={editingRequest}
        submitting={submitting}
        name={name}
        description={description}
        category={category} onCategoryChange={setCategory}
        deadline={deadline} onDeadlineChange={setDeadline}
        templateFiles={templateFiles} onTemplateFilesChange={setTemplateFiles}
        onPickTemplateFiles={handleTemplateFileChange}
        templateAttachments={templateAttachments} onTemplateAttachmentsChange={setTemplateAttachments}
        templateFileError={templateFileError}
        onTemplateAttachmentsTouched={setTemplateAttachmentsTouched}
        onClose={closeRequestForm}
        onSubmit={handleSubmit}
      />

        {section === 'sent' ? (
          // Documentele trimise, pe aceeași grilă cu tabelul și cu muchie
          // neutră: verdele e semnalul „gata”, nu decor (S-20, Z-05).
          <div style={{ '--sent-cols': sentColumns } as CSSProperties}>
            {outgoingDocs.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-ink-faint">
                {canChange ? 'Niciun document trimis încă. Trimite-le cu „Trimite documente”, sus.' : 'Niciun document de la consultant încă.'}
              </p>
            ) : (
              <>
                <div aria-hidden="true" className="hidden h-8 border-b border-rule text-[11px] font-medium text-ink-faint @min-[50rem]:grid @min-[50rem]:grid-cols-(--sent-cols)">
                  <span className="flex items-center pl-3">Document</span>
                  <span className="flex items-center px-2">Fișiere</span>
                  <span className="flex items-center justify-center">Trimis la</span>
                  {isAdminOrConsultant && <span className="flex items-center justify-center">Vizibil clientului</span>}
                  {canChange && <span />}
                </div>
                {outgoingDocs.map((doc: DocumentRequest) => (
                  <div
                    key={doc.id}
                    id={`request-${doc.id}`}
                    onClick={() => setSelectedOutgoingDoc(doc)}
                    className="group scroll-mt-24 cursor-pointer border-b border-rule/70 transition-colors duration-[120ms] hover:bg-paper/60 md:scroll-mt-48"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 px-3 py-2 @min-[50rem]:grid-cols-(--sent-cols) @min-[50rem]:gap-0 @min-[50rem]:p-0">
                      <div className="flex min-w-0 items-center gap-2 @min-[50rem]:py-1.5 @min-[50rem]:pl-3 @min-[50rem]:pr-2">
                        <FileText className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                        <button
                          type="button"
                          data-tooltip={isClient ? 'Vezi și descarcă documentul' : 'Vezi documentul trimis clientului'}
                          onClick={e => { e.stopPropagation(); setSelectedOutgoingDoc(doc) }}
                          className="min-h-11 min-w-0 break-words text-left text-[13px] leading-snug text-ink hover:underline pointer-fine:min-h-6"
                        >
                          {doc.name}
                        </button>
                      </div>
                      <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-ink-soft @min-[50rem]:contents">
                        <span className="min-w-0 truncate @min-[50rem]:flex @min-[50rem]:min-h-11 @min-[50rem]:items-center @min-[50rem]:px-2">
                          {getRequestAttachments(doc).map(attachment => attachment.original_name || attachment.storage_path.split('/').pop() || 'document').join(', ')}
                        </span>
                        <span className={`tabular-nums ${CELL}`}>
                          <span className="sr-only">Trimis la </span>{formatShortDate(doc.created_at)}
                        </span>
                        {isAdminOrConsultant && (
                          <span className={`${CELL} @min-[50rem]:px-2`}>
                            <PublishStatusControl
                              status={doc.visibility ?? 'draft'}
                              canPublish={canChange}
                              showPublishedStatus
                              onPublish={() => publishRequest(doc.id)}
                              compact
                              size="sm"
                            />
                          </span>
                        )}
                      </div>
                      {canChange && (
                        <div
                          className={`col-start-2 row-start-1 flex items-start justify-center transition-opacity duration-[120ms] pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-open=true]]:opacity-100 @min-[50rem]:col-start-auto @min-[50rem]:row-start-auto ${CELL}`}
                          onClick={e => e.stopPropagation()}
                        >
                          <RowActionsMenu
                            label={`Acțiuni pentru documentul ${doc.name}`}
                            tooltip="Acțiuni document"
                            size="sm"
                            actions={[
                              { label: 'Deschide', icon: <Eye className="w-3 h-3" />, onSelect: () => setSelectedOutgoingDoc(doc) },
                              { label: 'Șterge documentul', icon: <Trash2 className="w-3 h-3" />, danger: true, onSelect: () => setRequestToDelete(doc) },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
        <div style={{ '--req-cols': requestColumns } as CSSProperties}>
          {requests.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-ink-faint">
              {isClient ? 'Nicio cerere aici încă. Vei fi anunțat când apar.' : 'Nicio cerere de document încă.'}
            </p>
          ) : (
            <>
            {/* Sub o activitate, cererile stau direct sub antetul ei: aceleași
                coloane, un singur antet. Doar „Cereri generale”, fără rând de
                activitate deasupra, are antetul lui — doar pe coloane. */}
            {!activityId && (
              <div
                aria-hidden="true"
                className="hidden h-7 border-b border-rule/70 text-[11px] font-medium text-ink-faint @min-[50rem]:grid @min-[50rem]:grid-cols-(--req-cols)"
              >
                <span className="col-span-2 flex items-center pl-6">Cerere</span>
                <span className="flex items-center justify-center">Status</span>
                <span className="flex items-center justify-center">Documente</span>
                <span className="flex items-center justify-center">Termen</span>
                {isAdminOrConsultant && <span className="flex items-center justify-center">Vizibil clientului</span>}
                {canChange && <span />}
              </div>
            )}
            {displayRequests.map((req) => {
              const statusInfo = requestStatusInfo(displayedRequestStatus(req))
              const isClosed = req.status === 'closed'
              const uploadedAt = lastUploadAt(req)

              return (
                <div
                  key={req.id}
                  id={`request-${req.id}`}
                  onDragOver={e => handleReqDragOver(e, req.id)}
                  className={`group scroll-mt-24 cursor-pointer border-b border-rule/70 transition-colors duration-[120ms] hover:bg-paper/60 md:scroll-mt-48 ${
                    draggedReqId === req.id ? 'opacity-50' : ''
                  }`}
                  onClick={() => setSelectedRequest(req)}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 px-1 py-2 @min-[50rem]:grid-cols-(--req-cols) @min-[50rem]:gap-0 @min-[50rem]:p-0">
                    {/* Cerere */}
                    <div className="flex min-w-0 items-start gap-1.5 @min-[50rem]:col-span-2 @min-[50rem]:items-center @min-[50rem]:py-1.5 @min-[50rem]:pl-1 @min-[50rem]:pr-2">
                      {canChange ? (
                        <span
                          draggable
                          onDragStart={e => handleReqDragStart(e, req.id)}
                          onDragEnd={handleReqDragEnd}
                          onClick={e => e.stopPropagation()}
                          title="Trage pentru a reordona"
                          className="mt-0.5 flex h-5 w-4 flex-shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-plate)] text-ink-faint opacity-0 transition-opacity hover:text-ink-soft active:cursor-grabbing group-hover:opacity-100 pointer-coarse:hidden @min-[50rem]:mt-0"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="w-1 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <h3 className={`break-words text-[13px] leading-snug ${isRequestFinal(req) ? 'text-ink-faint' : 'text-ink'}`}>{req.name}</h3>
                        {req.description && <p className="line-clamp-1 text-xs leading-5 text-ink-faint">{req.description}</p>}
                      </div>
                    </div>

                    {/* Pe fișă, celulele curg sub nume; pe coloane, își iau locul. */}
                    <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-6 @min-[50rem]:contents">
                      <div className={CELL}>
                        <StatusCell tone={statusInfo.tone} label={statusLabel(req)} />
                      </div>
                      <div className={CELL}>
                        {/* Sub „Documente”, ca la activitate: câte fișiere are cererea.
                            Data ultimei încărcări rămâne în tooltip. */}
                        <span className="inline-flex items-center gap-1 text-xs tabular-nums text-ink-soft" data-tooltip={uploadedAt ? `Ultimul fișier încărcat pe ${formatShortDate(uploadedAt)}` : undefined}>
                          <Upload className="h-3.5 w-3.5 text-ink-faint @min-[50rem]:hidden" aria-hidden="true" />
                          {uploadedAt ? (
                            <>
                              {countLabel(uploadedFileCount(req), 'fișier', 'fișiere')}
                              <span className="sr-only">, ultimul încărcat pe {formatShortDate(uploadedAt)}</span>
                            </>
                          ) : (
                            <>
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">Niciun fișier încărcat</span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className={CELL}>
                        <DeadlineCell
                          value={req.deadline_at}
                          done={isRequestFinal(req)}
                          onSave={canChange && !isClosed ? date => saveRequestDeadline(req.id, date) : undefined}
                          itemName={req.name}
                        />
                      </div>
                      {isAdminOrConsultant && (
                        <div className={`${CELL} @min-[50rem]:px-2`}>
                          <PublishStatusControl
                            status={req.visibility ?? 'draft'}
                            canPublish={canChange && !isClosed}
                            showPublishedStatus={isAdminOrConsultant}
                            onPublish={() => publishRequest(req.id)}
                            blockers={requestBlockers(req)}
                            compact
                            size="sm"
                          />
                        </div>
                      )}
                    </div>

                    {canChange && (
                      <div
                        className={`col-start-2 row-start-1 flex items-start justify-center gap-0.5 transition-opacity duration-[120ms] pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-open=true]]:opacity-100 @min-[50rem]:col-start-auto @min-[50rem]:row-start-auto ${CELL}`}
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Toate acțiunile cererii sub „⋯”, ca la activități (S-12). O
                            cerere închisă nu se modifică până la redeschidere (D13);
                            ștergerea rămâne. */}
                        <RowActionsMenu
                          label={`Acțiuni pentru cererea ${req.name}`}
                          tooltip="Acțiuni cerere"
                          size="sm"
                          actions={[
                            {
                              label: 'Modifică cererea',
                              icon: <Pencil className="w-3 h-3" />,
                              hidden: isClosed,
                              onSelect: () => openEditForm(req),
                            },
                            {
                              label: 'Șterge din proiect',
                              icon: <Trash2 className="w-3 h-3" />,
                              danger: true,
                              onSelect: () => setRequestToDelete(req),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>

                  {/* Ce urmează sub rând e al clientului: zona de încărcare și
                      notele despre starea cererii. */}
                  <div className="px-2 empty:hidden [&>*]:mb-2.5 [&>*]:mt-0.5">
                  {isClient && (req.attachment_missing_at || missingAttachments.has(req.id)) && (
                    <div className="p-3 bg-[var(--sg-warn-soft)] border border-[var(--sg-warn)] rounded-[var(--radius-plate)]" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-[var(--sg-warn)] flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-[var(--sg-warn)]">
                          Modelul pentru această cerere este momentan indisponibil. Echipa îl va atașa când este disponibil; așteaptă actualizarea cererii înainte de completare.
                        </p>
                      </div>
                    </div>
                  )}

                  {isClient && readOnly && (req.status === 'pending' || req.status === 'rejected') && (
                    <div>
                      <div className="flex items-center gap-2 bg-[var(--sg-closed-soft)] px-4 py-2.5 rounded-[var(--radius-plate)] text-[var(--sg-closed)]">
                        <Archive className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                        <span className="text-sm">{PROJECT_CLOSED_CLIENT_NOTE}</span>
                      </div>
                    </div>
                  )}

                  {isClient && !readOnly && (req.status === 'pending' || req.status === 'rejected') && (
                    <div onClick={(e) => e.stopPropagation()}>
                      {/* Două butoane mici sub rând: fișierele se aleg și se
                          verifică în dialogul cererii, nu în tabel. */}
                      <div className="flex flex-wrap items-center gap-2 pl-6 @min-[50rem]:pl-11">
                        <button
                          type="button"
                          onClick={event => setUploadTarget({ request: req, startWith: 'files', opener: event.currentTarget })}
                          data-tooltip="Deschide încărcarea pentru această cerere: alegi fișierele, le verifici, apoi le trimiți"
                          className={uploadButtonClass}
                        >
                          <Upload className="w-4 h-4" aria-hidden="true" />
                          <span className="text-xs font-semibold">{req.status === 'rejected' ? 'Reîncarcă fișiere' : 'Încarcă fișiere'}</span>
                        </button>
                        {canUploadFolder ? (
                          <button
                            type="button"
                            onClick={event => setUploadTarget({ request: req, startWith: 'folder', opener: event.currentTarget })}
                            data-tooltip="Alege un folder întreg: se încarcă toate fișierele din el"
                            className={uploadButtonClass}
                          >
                            <FolderUp className="w-4 h-4" aria-hidden="true" />
                            <span className="text-xs font-semibold">{req.status === 'rejected' ? 'Reîncarcă folder' : 'Încarcă folder'}</span>
                          </button>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 text-xs text-ink-faint">
                            <FolderUp className="w-4 h-4" aria-hidden="true" />
                            <span>Folder indisponibil pe mobil</span>
                          </div>
                        )}
                      </div>

                      {wasRejected(req) && (
                        <div className="mt-3 p-3 bg-[var(--sg-danger-soft)] border border-[var(--sg-danger)] rounded-[var(--radius-plate)]">
                          <div className="flex items-start gap-2">
                            <MessageSquare className="w-4 h-4 text-[var(--sg-danger)] flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-semibold text-[var(--sg-danger)] mb-0.5">Motiv respingere:</p>
                              <p className="text-sm text-[var(--sg-danger)]">
                                {requestMeta.get(req.id)?.rejectionReason || 'Motivul respingerii nu este disponibil pentru acest istoric.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isClient && isClosed && (
                    <div>
                      <div className="flex items-center gap-2 bg-paper-sunk px-4 py-2.5 rounded-[var(--radius-plate)] text-ink-soft">
                        <Archive className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                        <span className="text-sm">{closedRequestClientNote(req)}</span>
                      </div>
                    </div>
                  )}

                  {isClient && req.status === 'approved' && (
                    <div>
                      <div className="flex items-center gap-2 text-[var(--sg-ok)] bg-[var(--sg-ok-soft)] px-4 py-2.5 rounded-[var(--radius-plate)]">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-semibold">Document aprobat cu succes</span>
                      </div>
                    </div>
                  )}

                  {isClient && req.status === 'review' && (
                    <div>
                      <div className="flex items-center gap-2 text-[var(--sg-review)] bg-[var(--sg-review-soft)] px-4 py-2.5 rounded-[var(--radius-plate)]">
                        <Eye className="w-4 h-4" />
                        <span className="text-sm font-medium">Documentul este în curs de verificare</span>
                      </div>
                    </div>
                  )}
{/* am putea pune aici ceva asemanator cu partea de download si versioning din DocumentModal
                  {isClient && req.files?.length ? (
                    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => downloadUploadedFileById(req.files![req.files!.length - 1].id)}
                        className="text-xs text-[var(--sg-accent)] hover:text-[var(--sg-accent-ink)] flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descarcă ultimul fișier încărcat (test)
                      </button>
                    </div>
                  ) : null} */}
                  </div>
                </div>
              )
            })}
            </>
          )}
          {hiddenHere > 0 && onRevealRequests && (
            <HiddenFinalRow
              className="border-b border-rule px-3 py-1"
              hiddenCount={hiddenHere}
              total={requests.length}
              singular="cerere"
              plural="cereri"
              onReveal={() => onRevealRequests(requests.filter(r => hiddenRequestIds?.has(r.id)).map(r => r.id))}
              focusTargetId={(() => { const first = requests.find(r => hiddenRequestIds?.has(r.id)); return first ? `request-${first.id}` : undefined })()}
            />
          )}
          {isEmbedded && canChange && (
            <button
              type="button"
              onClick={openCreateForm}
              data-tooltip={activityName && activityId ? `Cere clientului un document nou pentru „${activityName}”` : 'Cere clientului un document nou'}
              className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs font-medium text-[var(--sg-accent)] transition-colors duration-[120ms] hover:bg-[var(--sg-accent-soft)] pointer-fine:min-h-8"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Adaugă cerere de document nouă
            </button>
          )}
        </div>
        )}
      </div>

      {selectedRequest && (
        <DocumentModal
          request={selectedRequest}
          projectId={projectId}
          onClose={() => setSelectedRequest(null)}
          onUpdate={async () => {
            await fetchRequests()
            await refreshReminderStates()
          }}
          clientEmail={clientEmail}
          clientName={clientName}
          projectTitle={projectTitle}
          clientVisible={isRequestClientVisible(selectedRequest)}
          reminderState={reminderStates[selectedRequest.id]}
          reminderStateLoading={reminderStatesLoading}
          projectMembers={projectMembers}
          canCloseRequest={canCloseRequests}
          readOnly={readOnly}
        />
      )}

      {selectedOutgoingDoc && createPortal((
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-lg overflow-hidden rounded-[var(--radius-plate)] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-[var(--radius-plate)] border border-rule bg-paper-sunk px-2 py-0.5 text-xs font-semibold text-ink-soft">
                  <FolderUp className="w-3 h-3" />
                  Document trimis clientului
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-lg font-semibold text-ink break-words">{selectedOutgoingDoc.name}</h3>
                  {isAdminOrConsultant && (
                    <PublishStatusControl
                      status={selectedOutgoingDoc.visibility ?? 'draft'}
                      canPublish={canChange}
                      showPublishedStatus={isAdminOrConsultant}
                      onPublish={() => publishRequest(selectedOutgoingDoc.id)}
                    />
                  )}
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(selectedOutgoingDoc.created_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOutgoingDoc(null)}
                className="rounded-[var(--radius-plate)] p-1 text-ink-faint hover:bg-paper-sunk hover:text-ink-soft"
                aria-label="Închide"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
              {selectedOutgoingDoc.description && (
                <div>
                  <h4 className="mb-1 text-sm font-semibold text-ink">Descriere</h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{selectedOutgoingDoc.description}</p>
                </div>
              )}

              <div>
                <h4 className="mb-2 text-sm font-semibold text-ink">
                  Atașamente ({getRequestAttachments(selectedOutgoingDoc).length})
                </h4>
                <div className="space-y-2">
                  {getRequestAttachments(selectedOutgoingDoc).map((attachment, index) => {
                    const isMissing = Boolean(attachment.missing_at || missingAttachments.has(selectedOutgoingDoc.id))
                    const label = attachment.original_name || attachment.storage_path.split('/').pop() || `Document ${index + 1}`

                    return (
                      <div
                        key={attachment.id || `${attachment.storage_path}-${index}`}
                        className={`w-full flex items-center gap-3 rounded-[var(--radius-plate)] border px-4 py-3 text-left transition-colors ${
                          isMissing
                            ? 'border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]'
                            // Neutru: verdele e semnalul „gata”, nu culoarea unui link.
                            : 'border-rule bg-plate text-ink hover:bg-paper-sunk'
                        }`}
                      >
                        <button data-tooltip={isMissing ? 'Fișierul nu mai e disponibil' : 'Descarcă fișierul'}
                          type="button"
                          onClick={() => downloadAttachmentModel(selectedOutgoingDoc.id, attachment.id)}
                          disabled={isMissing}
                          className="flex min-w-0 flex-1 items-center gap-3 disabled:cursor-not-allowed"
                        >
                          {isMissing ? <AlertCircle className="w-5 h-5 flex-shrink-0" /> : <Download className="w-5 h-5 flex-shrink-0" />}
                          <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">{label}</span>
                          <span className={`text-xs font-semibold ${isMissing ? '' : 'text-[var(--sg-accent)]'}`}>{isMissing ? 'Indisponibil' : 'Descarcă'}</span>
                        </button>
                        {!isMissing && isPreviewableFile({ fileName: label }) && (
                          <button
                            type="button"
                            onClick={() => openInNewTab(buildPreviewPageUrl({ type: 'attachment', id: selectedOutgoingDoc.id, name: label, attachmentId: attachment.id }))}
                            title="Deschide"
                            aria-label={`Deschide ${label}`}
                            className="rounded-[var(--radius-plate)] p-2 text-ink-soft hover:bg-paper-sunk hover:text-ink"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {canChange && (
              <div className="flex justify-center gap-2 border-t border-rule bg-paper-sunk px-6 py-4">
                <button data-tooltip="Scoate documentul trimis din proiect — cere confirmare"
                  type="button"
                  onClick={() => {
                    setRequestToDelete(selectedOutgoingDoc)
                    setSelectedOutgoingDoc(null)
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-plate)] border border-[var(--sg-danger)] bg-white px-3 py-2 text-sm font-medium text-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)]"
                >
                  <Trash2 className="w-4 h-4" />
                  Șterge documentul
                </button>
              </div>
            )}
          </div>
        </div>
      ), document.body)}

      <ConfirmDeleteModal
        isOpen={!!requestToDelete}
        onClose={() => {
          if (deleteLoading) return
          setRequestToDelete(null)
        }}
        onConfirm={handleDeleteRequest}
        title={`Șterge din proiect "${requestToDelete?.name || 'document'}"`}
        description={
          requestToDelete
            ? (() => {
                if (requestToDelete.is_outgoing) {
                  return 'Documentul trimis clientului va fi eliminat din proiect. Istoricul acțiunii rămâne păstrat.'
                }

                const responseCount = (requestToDelete.files ?? []).filter(file => !file.deleted_at).length
                const responseWarning = responseCount > 0
                  ? responseCount === 1
                    ? 'Se va șterge automat și 1 răspuns încărcat. '
                    : `Se vor șterge automat și ${responseCount} răspunsuri încărcate. `
                  : ''

                return `Status curent: ${statusLabel(requestToDelete)}. ` +
                  responseWarning +
                  'Template-ul nu va fi modificat. Istoricul cererii rămâne păstrat.'
              })()
            : 'Template-ul nu va fi modificat. Istoricul cererii rămâne păstrat.'
        }
        confirmText="Șterge din proiect"
        confirmWord="sterge"
        loading={deleteLoading}
      />

      {uploadTarget && (
        <ClientUploadDialog
          key={uploadTarget.request.id}
          request={{
            id: uploadTarget.request.id,
            name: uploadTarget.request.name,
            rejected: wasRejected(uploadTarget.request),
            rejectionReason: requestMeta.get(uploadTarget.request.id)?.rejectionReason ?? null,
          }}
          startWith={uploadTarget.startWith}
          returnFocusTo={uploadTarget.opener}
          canUploadFolder={canUploadFolder}
          apiFetch={apiFetch}
          onUploaded={fetchRequests}
          onClose={() => setUploadTarget(null)}
          getFileIcon={getFileIcon}
        />
      )}

      <SendDocumentModal
        open={showSendDoc}
        files={sendFiles}
        fileStats={sendFileStats}
        submitting={sendSubmitting}
        outgoingDocs={outgoingDocs}
        onClose={closeSendDoc}
        onSubmit={handleSendDocument}
        onPickFiles={processSendFiles}
        onRemoveFile={removeSendFile}
        onClearFiles={() => setSendFiles([])}
        getFileIcon={getFileIcon}
      />
    </>
  )
}
