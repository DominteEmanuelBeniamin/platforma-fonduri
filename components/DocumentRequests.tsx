/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useEffect, useMemo, useState, JSX, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  FileText,
  Plus,
  Download,
  Upload,
  CheckCircle2,
  Clock,
  Calendar,
  X,
  ChevronRight,
  Eye,
  MessageSquare,
  FileSpreadsheet,
  FolderUp,
  Files,
  AlertCircle,
  GripVertical,
  Loader2,
  Image as ImageIcon,
  File,
  Trash2,
  Pencil,
} from 'lucide-react'
import DocumentModal from './DocumentModal'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import PublishStatusControl from './PublishStatusControl'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import { usePatchField } from '@/hooks/usePatchField'
import { useReminderStates } from '@/hooks/useReminderStates'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import type { PickedFile } from './document-requests/types'
import SendDocumentModal from './document-requests/SendDocumentModal'
import RequestFormDialog from './document-requests/RequestFormDialog'
import { buildPreviewPageUrl, isPreviewableFile, openInNewTab, downloadUrl } from '@/lib/file-preview'
import { publishBlockers } from '@/lib/publish-rules'
import {
  formatFileSize,
  getFileExtension,
  runClientUpload,
  validateUploadFile,
  type PendingClientUploadCompletion,
  type UploadValidationError,
} from '@/lib/client-upload'
import { RequirementType } from '@/lib/requirement-type'
import { Spinner } from '@/components/ui/Spinner'

interface DocumentRequest {
  id: string
  name: string
  description: string | null
  requirement_type?: RequirementType
  status: 'pending' | 'review' | 'approved' | 'rejected'
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
  creator?: { full_name: string | null; email: string | null }
  assigned_to: string | null
  assigned_consultant: { id: string; full_name: string | null; email: string } | null
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
  projectMembers?: { id: string; full_name: string | null; email: string }[]
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
}

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
}: DocumentRequestsProps) {
  const { loading: authLoading, token, profile, apiFetch } = useAuth()
  const { showToast, confirm } = useToast()
  const patchField = usePatchField()

  const [internalRequests, setInternalRequests] = useState<DocumentRequest[]>([])
  const [loading, setLoading] = useState(!externalRequests)
  const [showForm, setShowForm] = useState(false)
  const [editingRequest, setEditingRequest] = useState<DocumentRequest | null>(null)
  
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const formScrollY = useRef(0)

  useEffect(() => {
    if (!folderInputRef.current) return
    // setăm atributul doar în browser
    folderInputRef.current.setAttribute('webkitdirectory', '')
    folderInputRef.current.setAttribute('directory', '')
  }, [])

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
  const [showSendDoc, setShowSendDoc] = useState(false)
  const [selectedOutgoingDoc, setSelectedOutgoingDoc] = useState<DocumentRequest | null>(null)
  const [sendFiles, setSendFiles] = useState<PickedFile[]>([])
  const [sendSubmitting, setSendSubmitting] = useState(false)

  // Client upload state - IMPROVED
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [clientFiles, setClientFiles] = useState<PickedFile[]>([])
  const [showFilePreview, setShowFilePreview] = useState(false)
  const pendingClientUploadRef = useRef<PendingClientUploadCompletion | null>(null)
  const [requestToDelete, setRequestToDelete] = useState<DocumentRequest | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [missingAttachments, setMissingAttachments] = useState<Set<string>>(() => new Set())

  // Pliere per-cerere — set de „închise" (implicit deschis), ca cererile nou create
  // să nu aibă nevoie de sincronizare specială.
  const [closedRequestIds, setClosedRequestIds] = useState<Set<string>>(() => new Set())
  const toggleRequestFold = (id: string) => {
    setClosedRequestIds(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

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
    if (request) {
      setSelectedRequest(request)
      setClosedRequestIds(prev => {
        if (!prev.has(request.id)) return prev
        const next = new Set(prev)
        next.delete(request.id)
        return next
      })
    }
  }, [autoOpenRequestId, requests])

  const isAdminOrConsultant = profile?.role === 'admin' || profile?.role === 'consultant'
  const isClient = profile?.role === 'client'

  // Drag & drop reorder — override temporar peste ordinea din API până la refresh
  const [draggedReqId, setDraggedReqId] = useState<string | null>(null)
  const [reqOrder, setReqOrder] = useState<string[] | null>(null)

  const displayRequests = reqOrder
    ? reqOrder
        .map(id => requests.find((r: any) => r.id === id))
        .filter((r): r is DocumentRequest => !!r)
    : requests

  const handleReqDragStart = (e: React.DragEvent, reqId: string) => {
    setDraggedReqId(reqId)
    setReqOrder(requests.map((r: any) => r.id))
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
    const original = requests.map((r: any) => r.id)
    const unchanged = order.length === original.length && original.every((id, i) => id === order[i])
    if (unchanged) { setReqOrder(null); return }
    try {
      const res = await apiFetch(`/api/projects/${projectId}/document-requests/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: order.map((id, i) => ({ id, order_index: i + 1 })) }),
      })
      if (res.ok) await Promise.resolve(onRefresh ? onRefresh() : fetchRequests())
      else { showToast('Nu am putut salva ordinea. Reîncearcă.', 'error') }
    } finally { setReqOrder(null) }
  }

  // Computed stats pentru fișiere selectate
  const fileStats = useMemo(() => {
    const total = clientFiles.length
    const valid = clientFiles.filter(f => !f.validationError).length
    const invalid = total - valid
    const totalSize = clientFiles.reduce((sum, f) => sum + f.size, 0)
    const uploading = clientFiles.filter(f => f.uploadStatus === 'uploading').length
    const success = clientFiles.filter(f => f.uploadStatus === 'success').length
    const error = clientFiles.filter(f => f.uploadStatus === 'error').length
    
    return { total, valid, invalid, totalSize, uploading, success, error }
  }, [clientFiles])

  const sendFileStats = useMemo(() => {
    const total = sendFiles.length
    const valid = sendFiles.filter(f => !f.validationError && f.uploadStatus !== 'success').length
    const invalid = sendFiles.filter(f => f.validationError).length
    const totalSize = sendFiles.reduce((sum, f) => sum + f.size, 0)
    const uploading = sendFiles.filter(f => f.uploadStatus === 'uploading').length

    return { total, valid, invalid, totalSize, uploading }
  }, [sendFiles])

  // Procesare fișiere cu validare
  const processFiles = (fileList: FileList | null, requestId: string) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return

    pendingClientUploadRef.current = null
    const newFiles: PickedFile[] = files.map((file) => {
      const picked: PickedFile = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        relativePath: (file as any).webkitRelativePath || null,
        uploadStatus: 'pending',
        uploadProgress: 0
      }

      // Validare
      const error = validateFile(file, clientFiles)
      if (error) {
        picked.validationError = error
      }

      return picked
    })

    setClientFiles(prev => [...prev, ...newFiles])
    setUploadingFor(requestId)
    setShowFilePreview(true)
  }

  // Eliminare fișier individual
  const removeFile = (fileId: string) => {
    pendingClientUploadRef.current = null
    setClientFiles(prev => prev.filter(f => f.id !== fileId))
  }

  // Clear all files
  const clearAllFiles = () => {
    pendingClientUploadRef.current = null
    setClientFiles([])
    setUploadingFor(null)
    setShowFilePreview(false)
  }

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

  const handleClientUpload = async (requestId: string) => {
    if (submitting) return
    const validFiles = clientFiles.filter(f => !f.validationError)
    const pending = pendingClientUploadRef.current?.requestId === requestId
      ? pendingClientUploadRef.current
      : null

    if (!pending && validFiles.length === 0) {
      showToast('Nu există fișiere valide. Verifică erorile de validare.', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const result = await runClientUpload({
        apiFetch,
        requestId,
        files: validFiles,
        pending,
        onPending: next => { pendingClientUploadRef.current = next },
        onFileState: (id, state) => setClientFiles(prev => prev.map(file => file.id !== id ? file : (
          state.status === 'uploading' ? { ...file, uploadStatus: 'uploading' as const, uploadProgress: 0 }
            : state.status === 'success' ? { ...file, uploadStatus: 'success' as const, uploadProgress: 100 }
            : { ...file, uploadStatus: 'error' as const, uploadError: state.message }
        ))),
      })

      showToast(
        result.failed === 0
          ? `Au fost încărcate ${result.successful} fișiere.`
          : `${result.successful} fișiere au fost încărcate, iar ${result.failed} au eșuat. Verifică lista fișierelor.`,
        result.failed === 0 ? 'success' : 'warning',
      )

      clearAllFiles()
      await fetchRequests()
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : 'Nu am putut încărca fișierele. Reîncearcă.',
        'error',
      )
    } finally {
      setSubmitting(false)
    }
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
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
          rejectionReason: req.status === 'rejected' ? req.latest_rejection?.reason ?? null : null
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
        rejectionReason: req.status === 'rejected' ? req.latest_rejection?.reason ?? null : null
      })
    }

    return map
  }, [requests])


  const statusConfig: Record<string, { label: string; dot: string; icon: string }> = {
    pending: { label: isClient ? 'De încărcat' : 'Așteaptă răspuns', dot: 'bg-[var(--sg-warn)]', icon: 'bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]' },
    review: { label: 'În verificare', dot: 'bg-[var(--sg-accent)]', icon: 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]' },
    approved: { label: 'Aprobat', dot: 'bg-[var(--sg-ok)]', icon: 'bg-[var(--sg-ok-soft)] text-[var(--sg-ok)]' },
    rejected: { label: 'Respins', dot: 'bg-[var(--sg-danger)]', icon: 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]' },
  }
  const isEmbedded = activityId !== undefined

  if (loading) {
    return (
      <div className={`bg-white min-h-[400px] flex items-center justify-center ${isEmbedded ? '' : 'rounded-2xl border border-rule'}`}>
        <div className="flex flex-col items-center gap-4">
          <Spinner />
          <p className="text-sm text-ink-soft font-medium">Se încarcă documentele...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={`bg-white ${isEmbedded ? '' : 'rounded-2xl border border-rule shadow-sm overflow-hidden'}`}>
        {(!isEmbedded || (activityId === null && isAdminOrConsultant)) && (
        <div className={`${isEmbedded ? 'flex items-center justify-between px-4 pb-5 sm:pb-6 border-b border-rule' : 'p-4 sm:p-5 border-b border-rule'}`}>
          <div className={`flex items-center ${isEmbedded ? 'w-full justify-between' : 'flex-col gap-3 xl:flex-row xl:items-start xl:justify-between'}`}>
            {!isEmbedded && <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-[var(--sg-accent)] flex items-center justify-center flex-shrink-0">
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

            {isAdminOrConsultant && (
              <div className={`flex flex-wrap items-center gap-2 ${isEmbedded ? 'order-first' : 'w-full xl:w-auto xl:flex-shrink-0'}`}>
                {!activityId && (
                  <button
                    type="button"
                    title="Trimite documente"
                    onClick={() => setShowSendDoc(true)}
                    className="flex items-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2.5 rounded-xl text-sm font-medium transition-all bg-[var(--sg-ok)] text-white hover:brightness-90"
                  >
                    <Upload className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Trimite documente</span><span className="sr-only sm:hidden">Trimite documente</span>
                  </button>
                )}
                <button
                  onClick={openCreateForm}
                  className="flex items-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2.5 rounded-xl text-sm font-medium transition-all bg-ink text-white hover:brightness-90"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Cerere de document nouă</span><span className="sr-only sm:hidden">Cerere de document nouă</span>
                </button>
              </div>
            )}
          </div>
        </div>
        )}

      <RequestFormDialog
        open={showForm && isAdminOrConsultant}
        editing={editingRequest}
        submitting={submitting}
        name={name} onNameChange={setName}
        description={description} onDescriptionChange={setDescription}
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

        {!activityId && (outgoingDocs.length > 0 || isAdminOrConsultant) && (
          <div className="border-b border-rule bg-[var(--sg-ok-soft)]">
            <div className="px-4 sm:px-5 py-3 flex items-center gap-2">
              <FolderUp className="w-4 h-4 text-[var(--sg-ok)]" />
              <h3 className="text-sm font-semibold text-ink">Documente trimise clientului</h3>
              <span className="text-xs text-ink-soft">({outgoingDocs.length})</span>
            </div>
            {outgoingDocs.length === 0 ? (
              isAdminOrConsultant && (
                <p className="px-4 sm:px-5 pb-4 text-xs text-ink-soft">
                  Trimite documente către client cu butonul „Trimite documente”.
                </p>
              )
            ) : (
              <div className="divide-y divide-[var(--sg-ok)]">
                {outgoingDocs.map((doc: DocumentRequest) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedOutgoingDoc(doc)}
                    className="w-full px-4 sm:px-5 py-3 flex items-center gap-3 text-left hover:bg-[var(--sg-ok-soft)] transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg bg-white border border-[var(--sg-ok)] flex items-center justify-center text-[var(--sg-ok)] flex-shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                        <p className="min-w-0 text-sm font-medium text-ink break-words">{doc.name}</p>
                        <PublishStatusControl
                          status={doc.visibility ?? 'draft'}
                          canPublish={false}
                          showPublishedStatus={isAdminOrConsultant}
                          onPublish={() => undefined}
                          size="sm"
                        />
                      </div>
                      <p className="text-xs text-ink-soft truncate">
                        {getRequestAttachments(doc).map(attachment => attachment.original_name || attachment.storage_path.split('/').pop() || 'document').join(', ')} · {new Date(doc.created_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--sg-ok)] flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="divide-y divide-rule">
          {requests.length === 0 ? (
            <div className="p-8 sm:p-12 text-center">
              <div className="w-16 h-16 bg-paper-sunk rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-ink-faint" />
              </div>
              <p className="font-semibold text-ink mb-1">Nicio cerere încă</p>
              <p className="text-sm text-ink-soft max-w-xs mx-auto">
                {isClient ? 'Vei fi notificat când consultantul adaugă cereri noi.' : 'Creează prima cerere de document pentru client.'}
              </p>
            </div>
          ) : (
            displayRequests.map((req) => {
              const status = statusConfig[req.status] || statusConfig.pending
              const isOverdue = req.deadline_at && new Date(req.deadline_at) < new Date()
              const isFolded = closedRequestIds.has(req.id)

              return (
                <div
                  key={req.id}
                  id={`request-${req.id}`}
                  onDragOver={e => handleReqDragOver(e, req.id)}
                  className={`group scroll-mt-24 px-4 py-4 sm:px-5 transition-colors cursor-pointer hover:bg-paper-sunk ${
                    draggedReqId === req.id ? 'opacity-50' : ''
                  }`}
                  onClick={() => setSelectedRequest(req)}
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    {isAdminOrConsultant && (
                      <span
                        draggable
                        onDragStart={e => handleReqDragStart(e, req.id)}
                        onDragEnd={handleReqDragEnd}
                        onClick={e => e.stopPropagation()}
                        title="Trage pentru a reordona"
                        className="mt-2.5 -ml-1.5 p-0.5 rounded text-ink-faint hover:text-ink-soft opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing flex-shrink-0"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                    )}
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${status.icon}`}>
                      <FileText className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <h3 className="flex-1 min-w-0 font-semibold text-ink text-sm sm:text-base leading-snug break-words">{req.name}</h3>
                        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                          {!isFolded && isAdminOrConsultant && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditForm(req)}
                                className="p-1.5 rounded-lg text-ink-faint hover:text-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] transition-colors"
                                title="Modifică cererea"
                                aria-label="Modifică cererea"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setRequestToDelete(req)}
                                className="p-1.5 rounded-lg text-ink-faint hover:text-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)] transition-colors"
                                title="Șterge din proiect"
                                aria-label="Șterge din proiect"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleRequestFold(req.id)}
                            className="p-1.5 rounded-lg text-ink-faint hover:text-ink-soft hover:bg-paper-sunk transition-colors"
                            aria-label={isFolded ? 'Arată detaliile cererii' : 'Ascunde detaliile cererii'}
                            aria-expanded={!isFolded}
                          >
                            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isFolded ? '' : 'rotate-90'}`} />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-sunk px-2 py-1 text-xs text-ink-soft">
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          {status.label}
                        </span>
                        {!isFolded && (
                          <PublishStatusControl
                            status={req.visibility ?? 'draft'}
                            canPublish={isAdminOrConsultant}
                            showPublishedStatus={isAdminOrConsultant}
                            onPublish={() => publishRequest(req.id)}
                            blockers={requestBlockers(req)}
                            onSetDeadline={date => saveRequestDeadline(req.id, date)}
                            size="sm"
                          />
                        )}
                        {!isFolded && req.deadline_at && (
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${
                            isOverdue ? 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)] font-medium' : 'bg-paper-sunk text-ink-soft'
                          }`}>
                            <Clock className="w-3.5 h-3.5" />
                            Termen: {new Date(req.deadline_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>

                      {!isFolded && (
                        <>


                          {req.description && <p className="mt-3 text-sm text-ink-soft leading-6 line-clamp-2">{req.description}</p>}

                        </>
                      )}

                    </div>
                  </div>

                  {isClient && (req.attachment_missing_at || missingAttachments.has(req.id)) && (
                    <div className="mt-4 p-3 bg-[var(--sg-warn-soft)] border border-[var(--sg-warn)] rounded-xl" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-[var(--sg-warn)] flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-[var(--sg-warn)]">
                          Modelul pentru această cerere este momentan indisponibil. Echipa îl va atașa când este disponibil; așteaptă actualizarea cererii înainte de completare.
                        </p>
                      </div>
                    </div>
                  )}

                  {isClient && (req.status === 'pending' || req.status === 'rejected') && (
                    <div className="mt-4 pt-4 border-t border-rule" onClick={(e) => e.stopPropagation()}>
                      {uploadingFor === req.id && showFilePreview && clientFiles.length > 0 ? (
                        // PREVIEW ȘI GESTIONARE FIȘIERE
                        <div className="space-y-3">
                          {/* Header cu statistici */}
                          <div className="flex items-center justify-between p-3 bg-[var(--sg-accent-soft)] rounded-xl border border-[var(--sg-accent)]">
                            <div className="flex items-center gap-3">
                              <Files className="w-5 h-5 text-[var(--sg-accent)]" />
                              <div>
                                <p className="text-sm font-bold text-[var(--sg-accent)]">
                                  {fileStats.total} {fileStats.total === 1 ? 'fișier' : 'fișiere'} selectat{fileStats.total !== 1 ? 'e' : ''}
                                </p>
                                <p className="text-xs text-[var(--sg-accent)]">
                                  {fileStats.valid} valid{fileStats.valid !== 1 ? 'e' : ''} • {formatFileSize(fileStats.totalSize)}
                                  {fileStats.invalid > 0 && ` • ${fileStats.invalid} erori`}
                                </p>
                              </div>
                            </div>

                            <button
                              onClick={clearAllFiles}
                              disabled={submitting}
                              className="p-2 text-ink-faint hover:text-ink-soft rounded-lg hover:bg-white transition-all disabled:opacity-50"
                              title="Anulează tot"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>

                          {/* Lista fișiere cu scroll */}
                          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                            {clientFiles.map((pickedFile) => {
                              const hasError = !!pickedFile.validationError
                              const isUploading = pickedFile.uploadStatus === 'uploading'
                              const isSuccess = pickedFile.uploadStatus === 'success'
                              const isError = pickedFile.uploadStatus === 'error'
                              const isPending = pickedFile.uploadStatus === 'pending'

                              return (
                                <div
                                  key={pickedFile.id}
                                  className={`p-3 rounded-xl border transition-all ${
                                    hasError
                                      ? 'bg-[var(--sg-danger-soft)] border-[var(--sg-danger)]'
                                      : isSuccess
                                      ? 'bg-[var(--sg-ok-soft)] border-[var(--sg-ok)]'
                                      : isError
                                      ? 'bg-[var(--sg-danger-soft)] border-[var(--sg-danger)]'
                                      : isUploading
                                      ? 'bg-[var(--sg-accent-soft)] border-[var(--sg-accent)]'
                                      : 'bg-white border-rule'
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    {/* Icon */}
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                      hasError
                                        ? 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]'
                                        : isSuccess
                                        ? 'bg-[var(--sg-ok-soft)] text-[var(--sg-ok)]'
                                        : isError
                                        ? 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]'
                                        : isUploading
                                        ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]'
                                        : 'bg-paper-sunk text-ink-soft'
                                    }`}>
                                      {isUploading ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                      ) : isSuccess ? (
                                        <CheckCircle2 className="w-5 h-5" />
                                      ) : (isError || hasError) ? (
                                        <AlertCircle className="w-5 h-5" />
                                      ) : (
                                        getFileIcon(pickedFile)
                                      )}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-sm font-medium truncate ${
                                        hasError || isError ? 'text-[var(--sg-danger)]' : isSuccess ? 'text-[var(--sg-ok)]' : 'text-ink'
                                      }`}>
                                        {pickedFile.name}
                                      </p>
                                      <p className="text-xs text-ink-soft mt-0.5">
                                        {formatFileSize(pickedFile.size)}
                                        {pickedFile.relativePath && ` • ${pickedFile.relativePath}`}
                                      </p>

                                      {/* Validation Error */}
                                      {hasError && <FeedbackMessage variant="error" className="mt-1 text-xs">{pickedFile.validationError?.message}</FeedbackMessage>}

                                      {/* Upload Error */}
                                      {isError && pickedFile.uploadError && <FeedbackMessage variant="error" className="mt-1 text-xs">{pickedFile.uploadError}</FeedbackMessage>}

                                      {/* Success Message */}
                                      {isSuccess && (
                                        <p className="text-xs text-[var(--sg-ok)] font-medium mt-1 flex items-center gap-1">
                                          <CheckCircle2 className="w-3 h-3" />
                                          Încărcat cu succes
                                        </p>
                                      )}

                                      {/* Progress Bar */}
                                      {isUploading && (
                                        <div className="mt-2">
                                          <div className="h-1.5 bg-[var(--sg-accent-soft)] rounded-full overflow-hidden">
                                            <div
                                              className="h-full bg-[var(--sg-accent)] rounded-full transition-all duration-300"
                                              style={{ width: `${pickedFile.uploadProgress || 0}%` }}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Remove button (doar pentru pending/error) */}
                                    {(isPending || hasError) && !submitting && (
                                      <button
                                        onClick={() => removeFile(pickedFile.id)}
                                        className="p-1.5 text-ink-faint hover:text-[var(--sg-danger)] rounded-lg hover:bg-white transition-all flex-shrink-0"
                                        title="Elimină"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {/* Actions */}
                          <div className="flex flex-col sm:flex-row gap-2 pt-2">
                            {/* Add more files */}
                            <div className="flex gap-2 flex-1">
                              <label className="flex-1 cursor-pointer">
                                <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-rule rounded-xl text-ink-soft hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)] transition-all">
                                  <Plus className="w-4 h-4" />
                                  <span className="text-sm font-medium">Adaugă mai multe</span>
                                </div>
                                <input
                                  type="file"
                                  multiple
                                  onClick={(e) => { e.currentTarget.value = '' }}
                                  onChange={(e) => {
                                    processFiles(e.currentTarget.files, req.id)
                                    e.currentTarget.value = ''
                                  }}
                                  disabled={submitting}
                                  className="hidden"
                                />
                              </label>

                              {canUploadFolder && (
                                <label className="flex-1 cursor-pointer">
                                  <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-rule rounded-xl text-ink-soft hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)] transition-all">
                                    <FolderUp className="w-4 h-4" />
                                    <span className="text-sm font-medium hidden sm:inline">Folder</span>
                                  </div>
                                  <input
                                    type="file"
                                    multiple
                                    ref={(el) => {
                                      if (!el) return
                                      el.setAttribute('webkitdirectory', '')
                                      el.setAttribute('directory', '')
                                    }}
                                    onChange={(e) => {
                                      processFiles(e.currentTarget.files, req.id)
                                      e.currentTarget.value = ''
                                    }}
                                    disabled={submitting}
                                    className="hidden"
                                  />
                                </label>
                              )}
                            </div>

                            {/* Upload button */}
                            <button
                              onClick={() => handleClientUpload(req.id)}
                              disabled={submitting || fileStats.valid === 0 || fileStats.uploading > 0}
                              className="px-6 py-2.5 bg-[var(--sg-accent)] text-white rounded-xl text-sm font-bold hover:bg-[var(--sg-accent-ink)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                            >
                              {submitting ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Se încarcă...
                                </>
                              ) : (
                                <>
                                  <Upload className="w-4 h-4" />
                                  Încarcă {fileStats.valid > 0 ? `(${fileStats.valid})` : ''}
                                </>
                              )}
                            </button>
                          </div>

                          {/* Warnings pentru validări */}
                          {fileStats.invalid > 0 && (
                            <div className="p-3 bg-[var(--sg-warn-soft)] border border-[var(--sg-warn)] rounded-xl">
                              <div className="flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 text-[var(--sg-warn)] flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-xs font-bold text-[var(--sg-warn)]">
                                    {fileStats.invalid} {fileStats.invalid === 1 ? 'fișier are' : 'fișiere au'} erori de validare
                                  </p>
                                  <p className="text-xs text-[var(--sg-warn)] mt-1">
                                    Doar fișierele valide vor fi încărcate. Elimină sau înlocuiește fișierele cu erori.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        // SELECTARE INIȚIALĂ
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="cursor-pointer block">
                            <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-rule rounded-xl text-ink-soft hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)] transition-all">
                              <Upload className="w-4 h-4" />
                              <span className="text-sm font-medium">{req.status === 'rejected' ? 'Reîncarcă fișiere' : 'Încarcă fișiere'}</span>
                            </div>
                            <input
                              type="file"
                              multiple
                              onClick={(e) => { e.currentTarget.value = '' }}
                              onChange={(e) => {
                                processFiles(e.currentTarget.files, req.id)
                                e.currentTarget.value = ''
                              }}
                              className="hidden"
                            />
                          </label>

                          {canUploadFolder ? (
                            <label className="cursor-pointer block">
                              <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-rule rounded-xl text-ink-soft hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)] transition-all">
                                <FolderUp className="w-4 h-4" />
                                <span className="text-sm font-medium">{req.status === 'rejected' ? 'Reîncarcă folder' : 'Încarcă folder'}</span>
                              </div>
                              <input
                                type="file"
                                multiple
                                ref={(el) => {
                                  if (!el) return
                                  el.setAttribute('webkitdirectory', '')
                                  el.setAttribute('directory', '')
                                }}
                                onClick={(e) => { e.currentTarget.value = '' }}
                                onChange={(e) => {
                                  processFiles(e.currentTarget.files, req.id)
                                  e.currentTarget.value = ''
                                }}
                                className="hidden"
                              />
                            </label>
                          ) : (
                            <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-rule rounded-xl text-ink-faint">
                              <FolderUp className="w-4 h-4" />
                              <span className="text-sm font-medium">Folder indisponibil pe mobil</span>
                            </div>
                          )}
                        </div>
                      )}

                      {req.status === 'rejected' && (
                        <div className="mt-3 p-3 bg-[var(--sg-danger-soft)] border border-[var(--sg-danger)] rounded-xl">
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

                  {isClient && req.status === 'approved' && (
                    <div className="mt-4 pt-4 border-t border-rule">
                      <div className="flex items-center gap-2 text-[var(--sg-ok)] bg-[var(--sg-ok-soft)] px-4 py-2.5 rounded-xl">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-semibold">Document aprobat cu succes</span>
                      </div>
                    </div>
                  )}

                  {isClient && req.status === 'review' && (
                    <div className="mt-4 pt-4 border-t border-rule">
                      <div className="flex items-center gap-2 text-[var(--sg-accent)] bg-[var(--sg-accent-soft)] px-4 py-2.5 rounded-xl">
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
              )
            })
          )}
          {isEmbedded && isAdminOrConsultant && (
            <button
              type="button"
              onClick={openCreateForm}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[var(--sg-accent)] bg-[var(--sg-accent-soft)] hover:brightness-90 transition-colors"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]">
                <Plus className="w-4 h-4" />
              </span>
              <span className="text-sm font-semibold">Adaugă cerere de document nouă</span>
            </button>
          )}
        </div>
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
        />
      )}

      {selectedOutgoingDoc && createPortal((
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--sg-ok)] bg-[var(--sg-ok-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--sg-ok)]">
                  <FolderUp className="w-3 h-3" />
                  Document trimis clientului
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-lg font-semibold text-ink break-words">{selectedOutgoingDoc.name}</h3>
                  {isAdminOrConsultant && (
                    <PublishStatusControl
                      status={selectedOutgoingDoc.visibility ?? 'draft'}
                      canPublish
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
                className="rounded-lg p-1 text-ink-faint hover:bg-paper-sunk hover:text-ink-soft"
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
                        className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                          isMissing
                            ? 'border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]'
                            : 'border-[var(--sg-ok)] bg-[var(--sg-ok-soft)] text-[var(--sg-ok)] hover:bg-[var(--sg-ok-soft)]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => downloadAttachmentModel(selectedOutgoingDoc.id, attachment.id)}
                          disabled={isMissing}
                          className="flex min-w-0 flex-1 items-center gap-3 disabled:cursor-not-allowed"
                        >
                          {isMissing ? <AlertCircle className="w-5 h-5 flex-shrink-0" /> : <Download className="w-5 h-5 flex-shrink-0" />}
                          <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">{label}</span>
                          <span className="text-xs font-medium">{isMissing ? 'Indisponibil' : 'Descarcă'}</span>
                        </button>
                        {!isMissing && isPreviewableFile({ fileName: label }) && (
                          <button
                            type="button"
                            onClick={() => openInNewTab(buildPreviewPageUrl({ type: 'attachment', id: selectedOutgoingDoc.id, name: label, attachmentId: attachment.id }))}
                            title="Deschide"
                            aria-label={`Deschide ${label}`}
                            className="rounded-lg p-2 hover:bg-[var(--sg-ok-soft)]"
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

            {isAdminOrConsultant && (
              <div className="flex justify-center gap-2 border-t border-rule bg-paper-sunk px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setRequestToDelete(selectedOutgoingDoc)
                    setSelectedOutgoingDoc(null)
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--sg-danger)] bg-white px-3 py-2 text-sm font-medium text-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)]"
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

                return `Status curent: ${statusConfig[requestToDelete.status]?.label || requestToDelete.status}. ` +
                  responseWarning +
                  'Template-ul nu va fi modificat. Istoricul cererii rămâne păstrat.'
              })()
            : 'Template-ul nu va fi modificat. Istoricul cererii rămâne păstrat.'
        }
        confirmText="Șterge din proiect"
        confirmWord="sterge"
        loading={deleteLoading}
      />

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
