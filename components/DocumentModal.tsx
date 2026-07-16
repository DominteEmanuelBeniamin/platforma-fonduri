/* eslint-disable @typescript-eslint/no-explicit-any */
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
  Trash2
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { downloadFilesArchive } from '@/app/api/_utils/download-files-archive'
import { isPreviewableFile, buildPreviewPageUrl, openInNewTab } from '@/lib/file-preview'
import { Mail } from 'lucide-react'
import {
  getReminderType,
  generateMailtoLink,
  REMINDER_LABELS,
} from '@/lib/document-reminder'

interface DocumentRequest {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'review' | 'approved' | 'rejected'
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
  created_by: string | null
  created_at: string
  assigned_to: string | null
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

type ToastType = 'success' | 'error' | 'info'

const MODEL_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp'])
const MODEL_MAX_SIZE = 25 * 1024 * 1024

function getFileExtension(filename: string) {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

function validateModelFile(file: File) {
  if (file.size > MODEL_MAX_SIZE) return 'Fișierul depășește 25 MB'
  if (!MODEL_EXTENSIONS.has(getFileExtension(file.name))) return 'Tip de fișier nepermis'
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
}: {
  request: DocumentRequest
  projectId: string
  onClose: () => void
  onUpdate: () => void
  clientEmail?: string | null
  clientName?: string | null
  projectTitle?: string
}) {
  const { apiFetch, profile } = useAuth()
  const [notes, setNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [showRejectConfirm, setShowRejectConfirm] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)
  const [attachmentMissing, setAttachmentMissing] = useState(!!request.attachment_missing_at)
  const [localAttachmentPath, setLocalAttachmentPath] = useState<string | null>(request.attachment_path)
  const [attachmentActionLoading, setAttachmentActionLoading] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)

  // Deadline edit state
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [deadlineValue, setDeadlineValue] = useState(
    request.deadline_at ? request.deadline_at.slice(0, 10) : ''
  )
  const [savingDeadline, setSavingDeadline] = useState(false)
  const [localDeadline, setLocalDeadline] = useState<string | null>(request.deadline_at)

  const isAdminOrConsultant = profile?.role === 'admin' || profile?.role === 'consultant'
  const requestAttachments = request.attachments?.length
    ? request.attachments
    : localAttachmentPath
    ? [{ id: '', storage_path: localAttachmentPath, original_name: null, missing_at: request.attachment_missing_at }]
    : []

  useEffect(() => {
    setLocalAttachmentPath(request.attachment_path)
    setAttachmentMissing(!!request.attachment_missing_at)
  }, [request.id, request.attachment_path, request.attachment_missing_at])

  const handleSaveDeadline = async () => {
    setSavingDeadline(true)
    try {
      const res = await apiFetch(`/api/document-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to: request.assigned_to ?? null,
          deadline_at: deadlineValue || null,
        }),
      })
      if (res.ok) {
        setLocalDeadline(deadlineValue || null)
        setEditingDeadline(false)
        onUpdate()
      } else {
        const d = await res.json().catch(() => null)
        alert(d?.error || 'Eroare la salvare')
      }
    } finally {
      setSavingDeadline(false)
    }
  }

  // Status configuration
  const statusConfig = useMemo(() => {
    const configs = {
      pending: {
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        icon: Clock,
        label: 'Așteaptă răspuns',
      },
      review: {
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        icon: Eye,
        label: 'În verificare',
      },
      approved: {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        icon: CheckCircle2,
        label: 'Aprobat',
      },
      rejected: {
        bg: 'bg-red-50',
        text: 'text-red-700',
        icon: XCircle,
        label: 'Respins',
      }
    }
    return configs[request.status] || configs.pending
  }, [request.status])

  // Check if deadline is overdue
  const isOverdue = useMemo(() => {
    if (!localDeadline) return false
    return new Date(localDeadline) < new Date() && request.status === 'pending'
  }, [localDeadline, request.status])

  // Toast system
  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    setMounted(true)
    document.body.style.overflow = 'hidden'
    
    // Keyboard shortcuts
    const handleKeyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && e.ctrlKey && isAdminOrConsultant && request.status === 'review') {
        handleApprove()
      }
    }

    window.addEventListener('keydown', handleKeyboard)

    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', handleKeyboard)
    }
  }, [request.status, isAdminOrConsultant])

  const forceDownload = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

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
    } catch (error: any) {
      showToast('Eroare la descărcare: ' + error.message, 'error')
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
        throw new Error(data?.error || res.statusText)
      }
      
      forceDownload(data.url)
      showToast('Descărcare începută', 'success')
    } catch (error: any) {
      showToast('Eroare la descărcare: ' + error.message, 'error')
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
    } catch (error: any) {
      showToast('Eroare la actualizarea modelului: ' + error.message, 'error')
    } finally {
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      setAttachmentActionLoading(false)
    }
  }

  const handleRemoveModel = async () => {
    if (!isAdminOrConsultant || attachmentActionLoading) return
    if (!confirm('Elimini modelul din această cerere? Clientul nu va mai vedea că există un model atașat.')) return

    setAttachmentActionLoading(true)
    try {
      await patchAttachmentPath(null)
      setLocalAttachmentPath(null)
      setAttachmentMissing(false)
      onUpdate()
      showToast('Modelul a fost eliminat din cerere.', 'success')
    } catch (error: any) {
      showToast('Eroare la eliminarea modelului: ' + error.message, 'error')
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
      if (!res.ok) throw new Error(data?.error || res.statusText)
      
      forceDownload(data.url)
      showToast('Descărcare începută', 'success')
    } catch (error: any) {
      showToast('Eroare la descărcare: ' + error.message, 'error')
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
    if (!res.ok) throw new Error(data?.error || 'Review failed')
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
    } catch (e: any) {
      showToast('Eroare: ' + e.message, 'error')
    } finally {
      setActionLoading(false)
    }
  }

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
      setShowRejectConfirm(false)
      setTimeout(() => {
        onUpdate()
        onClose()
      }, 500)
    } catch (e: any) {
      showToast('Eroare: ' + e.message, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  if (!mounted) return null

  const StatusIcon = statusConfig.icon

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
      {/* Toast Notification */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-[1000000] animate-in slide-in-from-top-2 fade-in duration-300"
          style={{ maxWidth: '400px' }}
        >
          <div className={`rounded-xl shadow-2xl border p-4 flex items-start gap-3 ${
            toast.type === 'success' ? 'bg-emerald-50 border-emerald-200' :
            toast.type === 'error' ? 'bg-red-50 border-red-200' :
            'bg-blue-50 border-blue-200'
          }`}>
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />}
            {toast.type === 'error' && <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />}
            {toast.type === 'info' && <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />}
            <p className={`text-sm font-medium ${
              toast.type === 'success' ? 'text-emerald-900' :
              toast.type === 'error' ? 'text-red-900' :
              'text-blue-900'
            }`}>
              {toast.message}
            </p>
          </div>
        </div>
      )}

      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header: titlu + status + descriere */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-bold text-slate-900 leading-tight">
                  {request.name}
                </h2>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  {statusConfig.label}
                </span>
              </div>
              {request.description && (
                <p className="text-sm text-slate-500 leading-relaxed mt-1.5 whitespace-pre-line break-words max-h-28 overflow-y-auto">
                  {request.description}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-2">
                Cerut de {request.creator?.full_name || request.creator?.email || 'echipă'} · {new Date(request.created_at).toLocaleDateString('ro-RO', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                })}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 -m-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
              aria-label="Închide"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5 bg-white">
          {/* Termen limită — un singur rând, editabil pentru admin/consultant */}
          <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
            localDeadline
              ? isOverdue ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
              : 'bg-slate-50 text-slate-500'
          }`}>
            <Clock className={`w-4 h-4 flex-shrink-0 ${
              localDeadline
                ? isOverdue ? 'text-red-500' : 'text-amber-500'
                : 'text-slate-400'
            }`} />
            {editingDeadline ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="date"
                  value={deadlineValue}
                  onChange={e => setDeadlineValue(e.target.value)}
                  autoFocus
                  disabled={savingDeadline}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveDeadline()
                    if (e.key === 'Escape') setEditingDeadline(false)
                  }}
                  className="text-sm px-2 py-1 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-slate-800 disabled:opacity-50"
                />
                <button
                  onClick={handleSaveDeadline}
                  disabled={savingDeadline}
                  className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 disabled:opacity-50 flex-shrink-0"
                >
                  {savingDeadline
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle2 className="w-3.5 h-3.5" />
                  }
                </button>
                <button
                  onClick={() => setEditingDeadline(false)}
                  className="p-1.5 rounded-lg bg-slate-200 text-slate-500 hover:bg-slate-300 flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <span className="flex-1">
                  {localDeadline ? (
                    <>
                      {isOverdue ? 'Termen depășit: ' : 'Termen limită: '}
                      <strong>
                        {new Date(localDeadline).toLocaleDateString('ro-RO', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </strong>
                    </>
                  ) : (
                    'Fără termen limită'
                  )}
                </span>
                {isAdminOrConsultant && (
                  <button
                    onClick={() => {
                      setDeadlineValue(localDeadline ? localDeadline.slice(0, 10) : '')
                      setEditingDeadline(true)
                    }}
                    className="text-xs font-semibold text-indigo-600 hover:underline flex-shrink-0"
                  >
                    {localDeadline ? 'Modifică' : 'Adaugă termen'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Documente: model + răspunsuri client */}
          <div>
            <div className="space-y-5">
              {/* Modelele de completat - dacă există */}
              {requestAttachments.length > 0 && !attachmentMissing && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-2">
                    {requestAttachments.length > 1 ? `Modele de completat (${requestAttachments.length})` : 'Modelul de completat'}
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
                          className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-slate-200 px-4 py-3"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                              {isDownloading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <FileText className="w-5 h-5" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{fileName}</p>
                              <p className="text-xs text-slate-500">Se descarcă, se completează și se trimite înapoi</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {isPreviewableFile({ fileName }) && (
                              <button
                                onClick={() => openAttachmentModel(attachment.id || undefined, fileName)}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Deschide
                              </button>
                            )}
                            <button
                              onClick={() => downloadAttachmentModel(attachment.id || undefined)}
                              disabled={isDownloading}
                              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Descarcă
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {attachmentMissing && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-amber-900 mb-1">
                        {isAdminOrConsultant ? 'Model indisponibil' : 'Model indisponibil momentan'}
                      </p>
                      <p className="text-sm text-amber-800 leading-relaxed">
                        {isAdminOrConsultant
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
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 disabled:opacity-50"
                          >
                            {attachmentActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Reîncarcă model
                          </button>
                          <button
                            type="button"
                            onClick={handleRemoveModel}
                            disabled={attachmentActionLoading}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-amber-300 text-amber-900 text-xs font-bold hover:bg-amber-100 disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Elimină modelul
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!localAttachmentPath && !attachmentMissing && isAdminOrConsultant && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">Fără model atașat</p>
                      <p className="text-xs text-slate-500">Poți atașa un model pentru client.</p>
                    </div>
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
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {attachmentActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      Atașează model
                    </button>
                  </div>
                </div>
              )}

              {/* Fișierele trimise de client */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Fișierele trimise de client</h3>

                {groupedVersions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                    <p className="text-sm text-slate-500">Clientul nu a trimis încă niciun fișier.</p>
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
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {v === groupedVersions[0] ? `Varianta ${v.version} (recentă)` : `Varianta ${v.version}`}
                            </button>
                          ))}
                        </div>
                      )}

                      {group.createdAt && (
                        <p className="text-xs text-slate-400">
                          Trimis pe {new Date(group.createdAt).toLocaleDateString('ro-RO', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      )}

                      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                        {group.files.map(file => {
                          const fileName = file.original_name?.trim() || file.storage_path.split('/').filter(Boolean).pop() || 'fisier'
                          return (
                            <div key={file.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                                  <FileCheck className="w-5 h-5" />
                                </div>
                                <p className="flex-1 min-w-0 text-sm font-semibold text-slate-900 truncate">
                                  {fileName}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {isPreviewableFile({ fileName }) && (
                                  <button
                                    onClick={() => openUploadedFileById(file.id, fileName)}
                                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    Deschide
                                  </button>
                                )}
                                <button
                                  onClick={() => downloadUploadedFileById(file.id)}
                                  disabled={downloadingId === file.id}
                                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                                >
                                  {downloadingId === file.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5" />
                                  )}
                                  Descarcă
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
                          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-50"
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

            </div>
          </div>

          {/* Motivul respingerii anterioare */}
          {request.status === 'rejected' && (
            <div className="rounded-xl bg-red-50 px-4 py-3">
              <p className="text-xs font-semibold text-red-800 mb-1">Motivul respingerii</p>
              <p className="text-sm text-red-700 leading-relaxed">
                {latestRejectionReason || 'Motivul respingerii nu este disponibil pentru acest istoric.'}
              </p>
            </div>
          )}

          {/* Mesaj pentru client - doar la verificare, doar pentru echipă */}
          {isAdminOrConsultant && request.status === 'review' && (
            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-2">
                Mesaj pentru client
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Opțional la aprobare, obligatoriu la respingere"
                rows={3}
                className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none resize-none transition-colors"
              />
            </div>
          )}
        </div>

        {/* Footer - doar când există acțiuni de făcut */}
        {isAdminOrConsultant && request.status === 'review' && (
          <div className="px-5 sm:px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={actionLoading}
              className="flex-1 py-3 rounded-xl text-sm font-bold border border-red-200 text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              Respinge
            </button>

            <button
              onClick={handleApprove}
              disabled={actionLoading}
              className="flex-[2] py-3 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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

        {isAdminOrConsultant && request.status === 'pending' && (
          <div className="px-5 sm:px-6 py-4 border-t border-slate-100">
            {clientEmail ? (() => {
              const reminderType = getReminderType(localDeadline) ?? '1_week'
              const mailtoLink = generateMailtoLink(
                {
                  requestName: request.name,
                  requestDescription: request.description,
                  deadlineAt: localDeadline,
                  clientEmail,
                  clientName: clientName ?? null,
                  projectTitle: projectTitle ?? '',
                  projectId,
                },
                reminderType
              )
              return (
                <a
                  href={mailtoLink}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  Trimite reminder clientului
                  <span className="text-slate-400 font-normal">· {REMINDER_LABELS[reminderType]}</span>
                </a>
              )
            })() : (
              <div className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-50 text-sm text-slate-400">
                <Mail className="w-4 h-4" />
                Reminder indisponibil — fără email client
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reject Confirmation Dialog */}
      {showRejectConfirm && (
        <div className="absolute inset-0 flex items-center justify-center p-4 z-10">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowRejectConfirm(false)} />
          
          <div className="relative bg-white rounded-xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Confirmă respingerea</h3>
                <p className="text-sm text-slate-600">
                  Ești sigur că vrei să respingi acest document? Clientul va trebui să reîncarce fișierele.
                </p>
              </div>
            </div>

            {!notes.trim() && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                <p className="text-xs text-amber-800 font-medium">
                  ⚠️ Te rog scrie un motiv în câmpul de feedback pentru ca clientul să știe ce să corecteze.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectConfirm(false)}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium transition-colors"
              >
                Anulează
              </button>
              <button
                onClick={handleReject}
                disabled={!notes.trim() || actionLoading}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {actionLoading ? 'Se procesează...' : 'Confirmă respingere'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return createPortal(modalContent, document.body)
}
