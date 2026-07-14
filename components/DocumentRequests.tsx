/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useEffect, useMemo, useState, JSX, useRef } from 'react'
import {
  FileText,
  Plus,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  User,
  X,
  Paperclip,
  ChevronRight,
  Eye,
  MessageSquare,
  FileSpreadsheet,
  FileCheck,
  FileClock,
  FileX,
  FileQuestion,
  FolderUp,
  Files,
  AlertCircle,
  GripVertical,
  Loader2,
  Image as ImageIcon,
  File,
  Mail,
  Trash2,
  Pencil,
} from 'lucide-react'
import DocumentModal from './DocumentModal'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import { useAuth } from '@/app/providers/AuthProvider'
import {
  getReminderType,
  generateMailtoLink,
  REMINDER_LABELS,
  REMINDER_BADGE,
} from '@/lib/document-reminder'
import { RequirementType, REQUIREMENT_TYPES, REQUIREMENT_LABELS, REQUIREMENT_BADGE } from '@/lib/requirement-type'

interface DocumentRequest {
  id: string
  name: string
  description: string | null
  requirement_type?: RequirementType
  status: 'pending' | 'review' | 'approved' | 'rejected'
  is_outgoing?: boolean
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

type ValidationError = {
  type: 'size' | 'type' | 'duplicate'
  message: string
}

type PickedFile = {
  id: string // unique id for tracking
  file: File
  name: string
  size: number
  type: string
  relativePath: string | null
  validationError?: ValidationError
  uploadProgress?: number // 0-100
  uploadStatus?: 'pending' | 'uploading' | 'success' | 'error'
  uploadError?: string
}

// Validare constante
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp'
]

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.webp']

// Helper functions
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

function normalizeFileName(filename: string | null | undefined): string {
  return (filename || '').trim().toLowerCase()
}

function validateFile(file: File, existingFiles: PickedFile[]): ValidationError | null {
  // Check size
  if (file.size > MAX_FILE_SIZE) {
    return {
      type: 'size',
      message: `Fișierul depășește ${formatFileSize(MAX_FILE_SIZE)}`
    }
  }

  // Check type
  const ext = `.${getFileExtension(file.name)}`
  const isValidType = ALLOWED_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(ext)
  
  if (!isValidType) {
    return {
      type: 'type',
      message: 'Tip de fișier nepermis'
    }
  }

  // Check duplicates
  const isDuplicate = existingFiles.some(f => f.name === file.name && f.size === file.size)
  if (isDuplicate) {
    return {
      type: 'duplicate',
      message: 'Fișier duplicat'
    }
  }

  return null
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

interface DocumentRequestsProps {
  projectId: string
  /** Dacă e furnizat, filtrează cererile după activity_id */
  activityId?: string | null
  /** Titlul activității afișat în header */
  activityName?: string
  /** Date externe de la pagina părinte (evită fetch duplicat) */
  externalRequests?: any[]
  /** Callback refresh pentru pagina părinte */
  onRefresh?: () => void
  /** Consultantul asignat activității */
  activityAssignedTo?: string | null
  activityAssignedUser?: { id: string; full_name: string | null; email: string } | null
  projectMembers?: { id: string; full_name: string | null; email: string }[]
  onAssignActivity?: (assignedTo: string | null) => void
  /** Date client pentru reminder-uri — transmise din pagina proiectului */
  clientEmail?: string | null
  clientName?: string | null
  projectTitle?: string
}

export default function DocumentRequests({
  projectId,
  activityId,
  activityName,
  externalRequests,
  onRefresh,
  activityAssignedTo,
  activityAssignedUser,
  projectMembers: externalProjectMembers,
  onAssignActivity,
  clientEmail,
  clientName,
  projectTitle,
}: DocumentRequestsProps) {
  const { loading: authLoading, token, profile, apiFetch } = useAuth()

  const [internalRequests, setInternalRequests] = useState<DocumentRequest[]>([])
  const [loading, setLoading] = useState(!externalRequests)
  const [showForm, setShowForm] = useState(false)
  const [editingRequest, setEditingRequest] = useState<DocumentRequest | null>(null)
  
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!folderInputRef.current) return
    // setăm atributul doar în browser
    folderInputRef.current.setAttribute('webkitdirectory', '')
    folderInputRef.current.setAttribute('directory', '')
  }, [])

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
  const [sendFiles, setSendFiles] = useState<PickedFile[]>([])
  const [sendSubmitting, setSendSubmitting] = useState(false)

  // Client upload state - IMPROVED
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [clientFiles, setClientFiles] = useState<PickedFile[]>([])
  const [showFilePreview, setShowFilePreview] = useState(false)
  const [requestToDelete, setRequestToDelete] = useState<DocumentRequest | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [missingAttachments, setMissingAttachments] = useState<Set<string>>(() => new Set())

  const canUploadFolder =
    typeof window !== 'undefined' &&
    'webkitdirectory' in HTMLInputElement.prototype &&
    !window.matchMedia?.('(pointer: coarse)').matches &&
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

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

  // Documente trimise de consultant CĂTRE client (informative) — nivel proiect
  const outgoingDocs = useMemo(() => {
    return (externalRequests ?? internalRequests).filter((r: any) => r.is_outgoing && !r.deleted_at)
  }, [externalRequests, internalRequests])

  const isAdminOrConsultant = profile?.role === 'admin' || profile?.role === 'consultant'
  const isAdmin = profile?.role === 'admin'
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
      else { const d = await res.json().catch(() => null); alert(d?.error || 'Eroare la salvarea ordinii') }
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
    setClientFiles(prev => prev.filter(f => f.id !== fileId))
  }

  // Clear all files
  const clearAllFiles = () => {
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

  const forceDownload = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const fetchRequests = async () => {
    // Dacă avem date externe, delegăm refresh-ul la pagina părinte
    if (externalRequests !== undefined) {
      onRefresh?.()
      return
    }
    if (!projectId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/document-requests`, { method: 'GET' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || res.statusText)
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

  // Upload improved cu progress tracking și error handling granular
  const uploadFilesToRequest = async (requestId: string, filesToUpload: PickedFile[]) => {
    // Doar fișierele valide
    const validFiles = filesToUpload.filter(f => !f.validationError)
    
    if (validFiles.length === 0) {
      throw new Error('Niciun fișier valid de încărcat')
    }

    // 1. Init upload
    const initRes = await apiFetch(`/api/document-requests/${requestId}/uploads/init`, {
      method: 'POST',
      body: JSON.stringify({
        files: validFiles.map((p) => ({
          name: p.name,
          size: p.size,
          type: p.type,
          relativePath: p.relativePath,
        })),
      }),
    })
    const init = await initRes.json().catch(() => ({}))
    if (!initRes.ok) throw new Error(init?.error || 'Init upload failed')

    // 2. Upload fișiere INDIVIDUAL cu progress tracking
    const uploadResults = await Promise.allSettled(
      init.uploads.map(async (u: any) => {
        const pickedFile = validFiles[u.clientFileId]
        
        // Update status: uploading
        setClientFiles(prev => 
          prev.map(f => 
            f.id === pickedFile.id 
              ? { ...f, uploadStatus: 'uploading' as const, uploadProgress: 0 }
              : f
          )
        )

        try {
          const res = await fetch(u.signedUploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${u.token}`,
              'Content-Type': pickedFile.type,
            },
            body: pickedFile.file,
          })

          if (!res.ok) {
            throw new Error(`Upload failed: ${res.statusText}`)
          }

          // Success
          setClientFiles(prev => 
            prev.map(f => 
              f.id === pickedFile.id 
                ? { ...f, uploadStatus: 'success' as const, uploadProgress: 100 }
                : f
            )
          )

          return { success: true, upload: u, file: pickedFile }
        } catch (error: any) {
          // Error
          setClientFiles(prev => 
            prev.map(f => 
              f.id === pickedFile.id 
                ? { ...f, uploadStatus: 'error' as const, uploadError: error.message }
                : f
            )
          )

          return { success: false, upload: u, file: pickedFile, error: error.message }
        }
      })
    )

    // 3. Verificăm rezultatele
    const successful = uploadResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value)

    const failed = uploadResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && !r.value.success)
      .map(r => r.value)

    if (successful.length === 0) {
      throw new Error('Toate fișierele au eșuat la încărcare')
    }

    // 4. Complete doar cu fișierele reușite
    const completeRes = await apiFetch(`/api/document-requests/${requestId}/uploads/complete`, {
      method: 'POST',
      body: JSON.stringify({
        batchId: init.batchId,
        versionNumber: init.versionNumber,
        uploaded: successful.map((s: any) => ({
          storagePath: s.upload.storagePath,
          originalName: s.file.name,
          mimeType: s.file.type,
          fileSize: s.file.size,
          relativePath: s.file.relativePath,
        })),
      }),
    })
    const complete = await completeRes.json().catch(() => ({}))
    if (!completeRes.ok) throw new Error(complete?.error || 'Complete upload failed')

    return {
      total: uploadResults.length,
      successful: successful.length,
      failed: failed.length,
      failures: failed.map((f: any) => ({ name: f.file.name, error: f.error }))
    }
  }

  const handleClientUpload = async (requestId: string) => {
    const validFiles = clientFiles.filter(f => !f.validationError)
    
    if (validFiles.length === 0) {
      alert('Niciun fișier valid de încărcat. Verifică erorile de validare.')
      return
    }

    setSubmitting(true)
    try {
      const result = await uploadFilesToRequest(requestId, clientFiles)
      
      // Success message
      if (result.failed === 0) {
        alert(`✓ Toate ${result.successful} fișiere încărcate cu succes!`)
      } else {
        alert(
          `Parțial reușit:\n` +
          `✓ ${result.successful} fișiere încărcate\n` +
          `✗ ${result.failed} fișiere eșuate\n\n` +
          `Erori:\n${result.failures.map((f: any) => `- ${f.name}: ${f.error}`).join('\n')}`
        )
      }

      // Clear și refresh
      clearAllFiles()
      await fetchRequests()
    } catch (e: any) {
      alert('Eroare la încărcare: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }


  const downloadAttachmentModel = async (requestId: string, attachmentId?: string) => {
    const res = await apiFetch(`/api/document-requests/${requestId}/attachment/signed-download`, {
      method: 'POST',
      body: JSON.stringify({ expiresIn: 60 * 5, attachment_id: attachmentId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 404) {
        setMissingAttachments(prev => new Set(prev).add(requestId))
        await fetchRequests()
      }
      return alert('Eroare la descărcare: ' + (data?.error || res.statusText))
    }
    forceDownload(data.url)
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
    } catch (e: any) {
      alert('Eroare la ștergere: ' + e.message)
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
    } catch (e: any) {
      alert('Eroare: ' + e.message)
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
        } catch (error: any) {
          const message = error?.message || 'Trimiterea documentului a eșuat'
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
        alert(
          `Parțial reușit:\n` +
          `${successful} documente trimise\n` +
          `${failures.length} documente eșuate\n\n` +
          failures.map(f => `- ${f.name}: ${f.error}`).join('\n')
        )
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


  const statusConfig: Record<string, {
    bg: string; text: string; border: string; icon: JSX.Element; docIcon: JSX.Element; label: string; iconBg: string
  }> = {
    pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: <Clock className="w-4 h-4" />, docIcon: <FileClock className="w-5 h-5" />, label: 'Așteaptă', iconBg: 'bg-amber-100' },
    review: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: <Eye className="w-4 h-4" />, docIcon: <FileQuestion className="w-5 h-5" />, label: 'În verificare', iconBg: 'bg-blue-100' },
    approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: <CheckCircle2 className="w-4 h-4" />, docIcon: <FileCheck className="w-5 h-5" />, label: 'Aprobat', iconBg: 'bg-emerald-100' },
    rejected: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: <XCircle className="w-4 h-4" />, docIcon: <FileX className="w-5 h-5" />, label: 'Respins', iconBg: 'bg-red-100' },
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-slate-500 font-medium">Se încarcă documentele...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-snug text-slate-900 break-words">
                  {activityName ?? (isClient ? 'Documente de completat' : 'Cereri documente')}
                </h2>
                <p className="text-xs text-slate-500 hidden sm:block">
                  {activityName ? `${requests.length} cereri` : (isClient ? 'Descarcă, completează și încarcă' : `${requests.length} cereri în total`)}
                </p>
                {(activityId !== undefined) && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-xs text-slate-500">Consultant responsabil:</span>
                    {isAdmin && onAssignActivity && externalProjectMembers ? (
                      <select
                        value={activityAssignedTo ?? ''}
                        onChange={e => onAssignActivity(e.target.value || null)}
                        className="max-w-full text-xs border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-700 bg-white focus:border-indigo-500 outline-none transition-all"
                      >
                        <option value="">Neatribuit</option>
                        {externalProjectMembers.map(m => (
                          <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs font-medium text-slate-700">
                        {activityAssignedUser?.full_name ?? activityAssignedUser?.email ?? 'Neatribuit'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {isAdminOrConsultant && (
              <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:flex-shrink-0">
                {!activityId && (
                  <button
                    type="button"
                    title="Trimite documente"
                    onClick={() => setShowSendDoc(true)}
                    className="flex items-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2.5 rounded-xl text-sm font-medium transition-all bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/10"
                  >
                    <Upload className="w-4 h-4" /><span className="hidden sm:inline">Trimite documente</span>
                  </button>
                )}
                <button
                  onClick={openCreateForm}
                  className={`flex items-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    showForm ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-900/10'
                  }`}
                >
                  {showForm && !editingRequest ? (<><X className="w-4 h-4" /><span className="hidden sm:inline">Anulează</span></>) : (<><Plus className="w-4 h-4" /><span className="hidden sm:inline">Cerere de document nouă</span></>)}
                </button>
              </div>
            )}
          </div>
        </div>

        {showForm && isAdminOrConsultant && (
          <div className="p-4 sm:p-5 bg-slate-50/80 border-b border-slate-200">
            <form onSubmit={handleSubmit} className="space-y-4">
              {editingRequest && (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Modifică cererea de document</p>
                    <p className="text-xs text-slate-500">Actualizează detaliile cererii pentru client.</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeRequestForm}
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    title="Anulează editarea"
                    aria-label="Anulează editarea"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Titlu document</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Termen limită</label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Instrucțiuni</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none resize-none transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Tip cerință</label>
                <div className="flex flex-wrap gap-4">
                  {REQUIREMENT_TYPES.map(rt => (
                    <label key={rt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="liveDocCategory"
                        value={rt}
                        checked={category === rt}
                        onChange={() => setCategory(rt)}
                        className="w-4 h-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700">{REQUIREMENT_LABELS[rt]}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <label className="flex-1 cursor-pointer">
                  <div className={`px-4 py-3 border-2 border-dashed rounded-xl text-center transition-all ${
                    templateFiles.length > 0 ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}>
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <Paperclip className={`w-4 h-4 ${templateFiles.length > 0 ? 'text-indigo-600' : 'text-slate-400'}`} />
                      <span className={templateFiles.length > 0 ? 'text-indigo-700 font-medium' : 'text-slate-500'}>
                        {templateFiles.length > 0
                          ? templateFiles.map(file => file.name).join(', ')
                          : editingRequest
                          ? 'Adaugă modele (opțional)'
                          : 'Atașează modele (opțional)'}
                      </span>
                    </div>
                  </div>
                  <input
                    type="file"
                    multiple
                    onClick={(e) => { e.currentTarget.value = '' }}
                    onChange={handleTemplateFileChange}
                    className="hidden"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
                >
                  {submitting
                    ? editingRequest ? 'Se salvează...' : 'Se trimite...'
                    : editingRequest ? 'Salvează modificările' : 'Trimite cerere'}
                </button>
              </div>
              {(templateAttachments.length > 0 || templateFiles.length > 0) && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {templateAttachments.map(attachment => (
                    <div key={attachment.id} className="flex items-center gap-2 text-xs text-slate-600">
                      <Paperclip className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{attachment.original_name || attachment.storage_path.split('/').pop() || 'model atașat'}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setTemplateAttachments(current => current.filter(item => item.id !== attachment.id))
                          setTemplateAttachmentsTouched(true)
                        }}
                        className="text-red-600 hover:text-red-700"
                      >
                        Elimină
                      </button>
                    </div>
                  ))}
                  {templateFiles.map((file, index) => (
                    <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 text-xs text-indigo-700">
                      <Paperclip className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="text-indigo-500">{formatFileSize(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setTemplateFiles(current => current.filter((_, fileIndex) => fileIndex !== index))
                          setTemplateAttachmentsTouched(true)
                        }}
                        className="text-red-600 hover:text-red-700"
                      >
                        Elimină
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {templateFileError && (
                <div className="flex items-start gap-2 text-xs text-red-600">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span className="whitespace-pre-line">{templateFileError}</span>
                </div>
              )}
              {templateFileError && (
                <div className="flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{templateFileError}</span>
                </div>
              )}
              {editingRequest?.attachment_missing_at && (
                <div className="flex items-center gap-2 text-xs text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Modelul existent este indisponibil. Alege un fișier nou pentru înlocuire.</span>
                </div>
              )}
            </form>
          </div>
        )}

        {!activityId && (outgoingDocs.length > 0 || isAdminOrConsultant) && (
          <div className="border-b border-slate-100 bg-emerald-50/30">
            <div className="px-4 sm:px-5 py-3 flex items-center gap-2">
              <FolderUp className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-900">Documente trimise clientului</h3>
              <span className="text-xs text-slate-500">({outgoingDocs.length})</span>
            </div>
            {outgoingDocs.length === 0 ? (
              isAdminOrConsultant && (
                <p className="px-4 sm:px-5 pb-4 text-xs text-slate-500">
                  Trimite documente către client cu butonul „Trimite documente”.
                </p>
              )
            ) : (
              <div className="divide-y divide-emerald-100/70">
                {outgoingDocs.map((doc: any) => (
                  <div key={doc.id} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white border border-emerald-200 flex items-center justify-center text-emerald-600 flex-shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 break-words">{doc.name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {(doc.attachments?.length ? doc.attachments : [{ original_name: doc.attachment_original_name || 'document' }]).map((attachment: any) => attachment.original_name).join(', ')} · {new Date(doc.created_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    {(doc.attachments?.length ? doc.attachments : [{ id: undefined }]).map((attachment: any, index: number) => (
                      <button
                        key={`${doc.id}-attachment-${index}`}
                        type="button"
                        onClick={() => downloadAttachmentModel(doc.id, attachment.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-emerald-700 text-xs font-semibold hover:bg-emerald-50 flex-shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" /> {doc.attachments?.length ? attachment.original_name || `Descarcă ${index + 1}` : 'Descarcă'}
                      </button>
                    ))}
                    {isAdminOrConsultant && (
                      <button
                        type="button"
                        onClick={() => setRequestToDelete(doc)}
                        className="p-1.5 text-slate-400 hover:text-red-500 flex-shrink-0"
                        title="Șterge documentul trimis"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {requests.length === 0 ? (
            <div className="p-8 sm:p-12 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-slate-400" />
              </div>
              <p className="font-semibold text-slate-900 mb-1">Nicio cerere încă</p>
              <p className="text-sm text-slate-500 max-w-xs mx-auto">
                {isClient ? 'Vei fi notificat când consultantul adaugă cereri noi.' : 'Creează prima cerere de document pentru client.'}
              </p>
            </div>
          ) : (
            displayRequests.map((req) => {
              const status = statusConfig[req.status] || statusConfig.pending
              const isOverdue = req.deadline_at && new Date(req.deadline_at) < new Date() && req.status === 'pending'

              return (
                <div
                  key={req.id}
                  onDragOver={e => handleReqDragOver(e, req.id)}
                  className={`group p-4 sm:p-5 transition-all cursor-pointer hover:bg-slate-50/80 ${
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
                        className="mt-2.5 -ml-1.5 p-0.5 rounded text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing flex-shrink-0"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                    )}
                    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${status.iconBg} flex items-center justify-center flex-shrink-0 ${status.text}`}>
                      {status.docIcon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="min-w-0 flex-1 font-semibold text-slate-900 text-sm sm:text-base break-words pr-2">{req.name}</h3>
                        <span className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold ${status.bg} ${status.text} ${status.border} border`}>
                          {status.label}
                        </span>
                      </div>

                      {(() => {
                        const rt = req.requirement_type as RequirementType | undefined
                        const badge = rt ? REQUIREMENT_BADGE[rt] : null
                        return rt && badge ? (
                          <span className={`inline-block mb-2 text-[11px] px-1.5 py-0.5 rounded border ${badge.bg} ${badge.text} ${badge.border}`}>
                            {REQUIREMENT_LABELS[rt]}
                          </span>
                        ) : null
                      })()}

                      {req.description && <p className="text-sm text-slate-600 mb-3 line-clamp-2">{req.description}</p>}

                      <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {new Date(req.created_at).toLocaleDateString('ro-RO')}
                        </span>

                        {req.deadline_at && (
                          <span className={`flex items-center gap-1.5 ${isOverdue ? 'text-red-600 font-medium' : 'text-amber-600'}`}>
                            <Clock className="w-3.5 h-3.5" />
                            Termen: {new Date(req.deadline_at).toLocaleDateString('ro-RO')}
                          </span>
                        )}

                        {(requestMeta.get(req.id)?.responseCount ?? 0) > 0 ? (
                          <span className="flex items-center gap-1.5 text-emerald-600">
                            <Upload className="w-3.5 h-3.5" />
                            {requestMeta.get(req.id)!.responseCount}{' '}
                            {requestMeta.get(req.id)!.responseCount === 1 ? 'răspuns' : 'răspunsuri'}
                          </span>
                        ) : null}


                        {(req.attachments?.length ? req.attachments : req.attachment_path ? [{
                          id: undefined,
                          storage_path: req.attachment_path,
                          original_name: req.attachment_original_name || null,
                          missing_at: req.attachment_missing_at,
                        }] : []).map((attachment: any, index: number) => attachment.missing_at || missingAttachments.has(req.id) ? (
                          <span key={`${req.id}-${index}`} className="flex items-center gap-1.5 text-amber-700">
                            <AlertCircle className="w-3.5 h-3.5" /> Model indisponibil
                          </span>
                        ) : (
                          <button
                            key={`${req.id}-${index}`}
                            onClick={(e) => { e.stopPropagation(); downloadAttachmentModel(req.id, attachment.id) }}
                            className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {attachment.original_name || `Model ${index + 1}`}
                          </button>
                        ))}
                        {(req.attachment_missing_at || missingAttachments.has(req.id)) && (
                          <span className={`flex items-center gap-1.5 ${isAdminOrConsultant ? 'text-amber-700' : 'text-slate-500'}`}>
                            <AlertCircle className="w-3.5 h-3.5" />
                            {isAdminOrConsultant ? 'Model indisponibil' : 'Model indisponibil momentan'}
                          </span>
                        )}
                      </div>

                      {/* ── Buton reminder client ── */}
                      {isAdminOrConsultant && clientEmail && (() => {
                        const reminderType = getReminderType(req.deadline_at)
                        if (!reminderType) return null
                        const badge = REMINDER_BADGE[reminderType]
                        const mailtoLink = generateMailtoLink(
                          {
                            requestName: req.name,
                            requestDescription: req.description,
                            deadlineAt: req.deadline_at,
                            clientEmail,
                            clientName: clientName ?? null,
                            projectTitle: projectTitle ?? '',
                            projectId,
                          },
                          reminderType
                        )
                        return (
                          <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                            <a
                              href={mailtoLink}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-opacity hover:opacity-75 ${badge.bg} ${badge.text} ${badge.border}`}
                              title="Deschide clientul de email cu mesajul pregătit automat"
                            >
                              <Mail className="w-3 h-3" />
                              Trimite reminder clientului
                              <span className="mx-0.5 opacity-50">·</span>
                              {REMINDER_LABELS[reminderType]}
                            </a>
                          </div>
                        )
                      })()}

                    </div>

                    {isAdminOrConsultant ? (
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openEditForm(req)}
                          className="p-2 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          title="Modifică cererea"
                          aria-label="Modifică cererea"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRequestToDelete(req)}
                          className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Șterge din proiect"
                          aria-label="Șterge din proiect"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-5 h-5 text-slate-300 hidden sm:block" />
                      </div>
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-300 hidden sm:block flex-shrink-0" />
                    )}
                  </div>

                  {isClient && (req.attachment_missing_at || missingAttachments.has(req.id)) && (
                    <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800">
                          Modelul pentru această cerere este momentan indisponibil. Echipa îl va atașa când este disponibil; așteaptă actualizarea cererii înainte de completare.
                        </p>
                      </div>
                    </div>
                  )}

                  {isClient && (req.status === 'pending' || req.status === 'rejected') && (
                    <div className="mt-4 pt-4 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                      {uploadingFor === req.id && showFilePreview && clientFiles.length > 0 ? (
                        // PREVIEW ȘI GESTIONARE FIȘIERE
                        <div className="space-y-3">
                          {/* Header cu statistici */}
                          <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                            <div className="flex items-center gap-3">
                              <Files className="w-5 h-5 text-indigo-600" />
                              <div>
                                <p className="text-sm font-bold text-indigo-900">
                                  {fileStats.total} {fileStats.total === 1 ? 'fișier' : 'fișiere'} selectat{fileStats.total !== 1 ? 'e' : ''}
                                </p>
                                <p className="text-xs text-indigo-600">
                                  {fileStats.valid} valid{fileStats.valid !== 1 ? 'e' : ''} • {formatFileSize(fileStats.totalSize)}
                                  {fileStats.invalid > 0 && ` • ${fileStats.invalid} erori`}
                                </p>
                              </div>
                            </div>

                            <button
                              onClick={clearAllFiles}
                              disabled={submitting}
                              className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white transition-all disabled:opacity-50"
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
                                      ? 'bg-red-50 border-red-200'
                                      : isSuccess
                                      ? 'bg-emerald-50 border-emerald-200'
                                      : isError
                                      ? 'bg-red-50 border-red-200'
                                      : isUploading
                                      ? 'bg-blue-50 border-blue-200'
                                      : 'bg-white border-slate-200'
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    {/* Icon */}
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                      hasError
                                        ? 'bg-red-100 text-red-600'
                                        : isSuccess
                                        ? 'bg-emerald-100 text-emerald-600'
                                        : isError
                                        ? 'bg-red-100 text-red-600'
                                        : isUploading
                                        ? 'bg-blue-100 text-blue-600'
                                        : 'bg-slate-100 text-slate-600'
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
                                        hasError || isError ? 'text-red-900' : isSuccess ? 'text-emerald-900' : 'text-slate-900'
                                      }`}>
                                        {pickedFile.name}
                                      </p>
                                      <p className="text-xs text-slate-500 mt-0.5">
                                        {formatFileSize(pickedFile.size)}
                                        {pickedFile.relativePath && ` • ${pickedFile.relativePath}`}
                                      </p>

                                      {/* Validation Error */}
                                      {hasError && (
                                        <p className="text-xs text-red-600 font-medium mt-1 flex items-center gap-1">
                                          <AlertCircle className="w-3 h-3" />
                                          {pickedFile.validationError?.message}
                                        </p>
                                      )}

                                      {/* Upload Error */}
                                      {isError && pickedFile.uploadError && (
                                        <p className="text-xs text-red-600 font-medium mt-1 flex items-center gap-1">
                                          <AlertCircle className="w-3 h-3" />
                                          {pickedFile.uploadError}
                                        </p>
                                      )}

                                      {/* Success Message */}
                                      {isSuccess && (
                                        <p className="text-xs text-emerald-600 font-medium mt-1 flex items-center gap-1">
                                          <CheckCircle2 className="w-3 h-3" />
                                          Încărcat cu succes
                                        </p>
                                      )}

                                      {/* Progress Bar */}
                                      {isUploading && (
                                        <div className="mt-2">
                                          <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                                            <div
                                              className="h-full bg-blue-500 rounded-full transition-all duration-300"
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
                                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-white transition-all flex-shrink-0"
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
                                <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 transition-all">
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
                                  <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 transition-all">
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
                              className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 whitespace-nowrap"
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
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                              <div className="flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-xs font-bold text-amber-900">
                                    {fileStats.invalid} {fileStats.invalid === 1 ? 'fișier are' : 'fișiere au'} erori de validare
                                  </p>
                                  <p className="text-xs text-amber-700 mt-1">
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
                            <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 transition-all">
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
                              <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 transition-all">
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
                            <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-300">
                              <FolderUp className="w-4 h-4" />
                              <span className="text-sm font-medium">Folder indisponibil pe mobil</span>
                            </div>
                          )}
                        </div>
                      )}

                      {req.status === 'rejected' && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                          <div className="flex items-start gap-2">
                            <MessageSquare className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-semibold text-red-800 mb-0.5">Motiv respingere:</p>
                              <p className="text-sm text-red-700">
                                {requestMeta.get(req.id)?.rejectionReason || 'Motivul respingerii nu este disponibil pentru acest istoric.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isClient && req.status === 'approved' && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2.5 rounded-xl">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-semibold">Document aprobat cu succes</span>
                      </div>
                    </div>
                  )}

                  {isClient && req.status === 'review' && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-4 py-2.5 rounded-xl">
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
                        className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5"
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
        </div>
      </div>

      {selectedRequest && (
        <DocumentModal
          request={selectedRequest}
          projectId={projectId}
          onClose={() => setSelectedRequest(null)}
          onUpdate={fetchRequests}
          clientEmail={clientEmail}
          clientName={clientName}
          projectTitle={projectTitle}
        />
      )}

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

      {showSendDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Trimite documente către client</h3>
              <button type="button" onClick={closeSendDoc} className="p-1 text-slate-400 hover:text-slate-600" disabled={sendSubmitting}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSendDocument}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Documente *</label>
                  {sendFiles.length === 0 ? (
                    <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors">
                      <Upload className="w-8 h-8 text-slate-400" />
                      <span className="text-sm text-slate-600 font-medium">Click pentru a încărca documente</span>
                      <span className="text-xs text-slate-400">PDF, DOC, DOCX, XLS, XLSX, imagini</span>
                      <input
                        type="file"
                        multiple
                        onClick={(e) => { e.currentTarget.value = '' }}
                        onChange={(e) => {
                          processSendFiles(e.currentTarget.files)
                          e.currentTarget.value = ''
                        }}
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                        <div className="flex items-center gap-3">
                          <Files className="w-5 h-5 text-emerald-600" />
                          <div>
                            <p className="text-sm font-bold text-emerald-900">
                              {sendFileStats.total} {sendFileStats.total === 1 ? 'document selectat' : 'documente selectate'}
                            </p>
                            <p className="text-xs text-emerald-600">
                              {sendFileStats.valid} {sendFileStats.valid === 1 ? 'document valid' : 'documente valide'} • {formatFileSize(sendFileStats.totalSize)}
                              {sendFileStats.invalid > 0 && ` • ${sendFileStats.invalid} erori`}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSendFiles([])}
                          disabled={sendSubmitting}
                          className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white transition-all disabled:opacity-50"
                          title="Anulează tot"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                        {sendFiles.map((pickedFile) => {
                          const hasError = !!pickedFile.validationError
                          const isUploading = pickedFile.uploadStatus === 'uploading'
                          const isSuccess = pickedFile.uploadStatus === 'success'
                          const isError = pickedFile.uploadStatus === 'error'
                          const normalizedName = normalizeFileName(pickedFile.name)
                          const hasSameNameInSelection = normalizedName !== '' && sendFiles.some(file => file.id !== pickedFile.id && normalizeFileName(file.name) === normalizedName)
                          const hasSameNameInOutgoing = normalizedName !== '' && outgoingDocs.some((doc: any) => normalizeFileName(doc.attachment_original_name || doc.name) === normalizedName)
                          const nameWarning = !hasError && !isError && !isSuccess
                            ? hasSameNameInOutgoing
                              ? 'Există deja un document trimis cu acest nume'
                              : hasSameNameInSelection
                              ? 'Ai selectat deja un document cu acest nume'
                              : ''
                            : ''

                          return (
                            <div
                              key={pickedFile.id}
                              className={`p-3 rounded-xl border transition-all ${
                                hasError || isError
                                  ? 'bg-red-50 border-red-200'
                                  : isSuccess
                                  ? 'bg-emerald-50 border-emerald-200'
                                  : isUploading
                                  ? 'bg-blue-50 border-blue-200'
                                  : nameWarning
                                  ? 'bg-amber-50 border-amber-200'
                                  : 'bg-white border-slate-200'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                  hasError || isError
                                    ? 'bg-red-100 text-red-600'
                                    : isSuccess
                                    ? 'bg-emerald-100 text-emerald-600'
                                    : isUploading
                                    ? 'bg-blue-100 text-blue-600'
                                    : nameWarning
                                    ? 'bg-amber-100 text-amber-600'
                                    : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {isUploading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                  ) : isSuccess ? (
                                    <CheckCircle2 className="w-5 h-5" />
                                  ) : (isError || hasError) ? (
                                    <AlertCircle className="w-5 h-5" />
                                  ) : nameWarning ? (
                                    <AlertCircle className="w-5 h-5" />
                                  ) : (
                                    getFileIcon(pickedFile)
                                  )}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-medium truncate ${
                                    hasError || isError ? 'text-red-900' : isSuccess ? 'text-emerald-900' : nameWarning ? 'text-amber-900' : 'text-slate-900'
                                  }`}>
                                    {pickedFile.name}
                                  </p>
                                  <p className="text-xs text-slate-500 mt-0.5">{formatFileSize(pickedFile.size)}</p>
                                  {hasError && (
                                    <p className="text-xs text-red-600 font-medium mt-1 flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3" />
                                      {pickedFile.validationError?.message}
                                    </p>
                                  )}
                                  {isError && pickedFile.uploadError && (
                                    <p className="text-xs text-red-600 font-medium mt-1 flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3" />
                                      {pickedFile.uploadError}
                                    </p>
                                  )}
                                  {nameWarning && (
                                    <p className="text-xs text-amber-700 font-medium mt-1 flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3" />
                                      {nameWarning}
                                    </p>
                                  )}
                                  {isSuccess && (
                                    <p className="text-xs text-emerald-600 font-medium mt-1 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3" />
                                      Trimis
                                    </p>
                                  )}
                                </div>

                                {!sendSubmitting && !isUploading && !isSuccess && (
                                  <button
                                    type="button"
                                    onClick={() => removeSendFile(pickedFile.id)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-white transition-all flex-shrink-0"
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

                      <label className="cursor-pointer block">
                        <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-slate-600 hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-600 transition-all">
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">Adaugă mai multe</span>
                        </div>
                        <input
                          type="file"
                          multiple
                          onClick={(e) => { e.currentTarget.value = '' }}
                          onChange={(e) => {
                            processSendFiles(e.currentTarget.files)
                            e.currentTarget.value = ''
                          }}
                          disabled={sendSubmitting}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500">Clientul va putea descărca aceste documente. Nu i se va cere să încarce nimic înapoi.</p>
              </div>
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button type="button" onClick={closeSendDoc} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-white" disabled={sendSubmitting}>
                  Anulează
                </button>
                <button type="submit" disabled={sendSubmitting || sendFileStats.valid === 0 || sendFileStats.uploading > 0} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {sendSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {sendSubmitting
                    ? sendFileStats.valid === 1 ? 'Se trimite...' : 'Se trimit...'
                    : sendFileStats.valid === 1 ? 'Trimite document (1)' : `Trimite documente${sendFileStats.valid > 0 ? ` (${sendFileStats.valid})` : ''}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
