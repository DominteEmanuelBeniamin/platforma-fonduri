/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  FileText,
  Download,
  FolderDown,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  User,
  X,
  FileCheck,
  MessageSquare,
  AlertCircle,
  Loader2,
  Eye,
  Package,
  History
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'

interface DocumentRequest {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'review' | 'approved' | 'rejected'
  attachment_path: string | null
  deadline_at: string | null
  created_by: string | null
  created_at: string
  creator?: { full_name: string | null; email: string | null }
  files?: {
    id: string
    storage_path: string
    version_number: number
    comments: string | null
    created_at: string
    uploaded_by: string | null
  }[]
}

type ToastType = 'success' | 'error' | 'info'

export default function DocumentModal({
  request,
  onClose,
  onUpdate
}: {
  request: DocumentRequest
  onClose: () => void
  onUpdate: () => void
}) {
  const { apiFetch } = useAuth()
  const [notes, setNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [showRejectConfirm, setShowRejectConfirm] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  // Status configuration
  const statusConfig = useMemo(() => {
    const configs = {
      pending: {
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        border: 'border-amber-200',
        icon: Clock,
        label: 'Așteaptă răspuns',
        dotColor: 'bg-amber-500'
      },
      review: {
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        border: 'border-blue-200',
        icon: Eye,
        label: 'În verificare',
        dotColor: 'bg-blue-500'
      },
      approved: {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        border: 'border-emerald-200',
        icon: CheckCircle2,
        label: 'Aprobat',
        dotColor: 'bg-emerald-500'
      },
      rejected: {
        bg: 'bg-red-50',
        text: 'text-red-700',
        border: 'border-red-200',
        icon: XCircle,
        label: 'Respins',
        dotColor: 'bg-red-500'
      }
    }
    return configs[request.status] || configs.pending
  }, [request.status])

  // Check if deadline is overdue
  const isOverdue = useMemo(() => {
    if (!request.deadline_at) return false
    return new Date(request.deadline_at) < new Date() && request.status === 'pending'
  }, [request.deadline_at, request.status])

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
      if (e.key === 'Enter' && e.ctrlKey && request.status === 'review') {
        handleApprove()
      }
    }
    
    window.addEventListener('keydown', handleKeyboard)
    
    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', handleKeyboard)
    }
  }, [request.status])

  const forceDownload = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

    const getFileName = (storagePath: string) => {
    try {
      const parts = storagePath.split('/').filter(Boolean)
      return parts[parts.length - 1] || storagePath
    } catch {
      return storagePath
    }
  }

  // Group uploaded files by version_number (folder uploads can create multiple files for the same version)
  type DocFile = NonNullable<DocumentRequest['files']>[number]

  const groupedVersions = useMemo(() => {
    const files: DocFile[] = (request.files ?? []) as DocFile[]

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


  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const versionWrapRef = useRef<HTMLDivElement | null>(null)
  const downloadWrapRef = useRef<HTMLDivElement | null>(null)


  useEffect(() => {
    // reset when request changes / files refresh
    const next = groupedVersions[0]?.version ?? null
    setSelectedVersion(next)
    setVersionDropdownOpen(false)
    setDownloadMenuOpen(false)
  }, [request.id, groupedVersions])

  useEffect(() => {
    if (!versionDropdownOpen && !downloadMenuOpen) return
  
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
  
      const inVersion = !!(target && versionWrapRef.current?.contains(target))
      const inDownload = !!(target && downloadWrapRef.current?.contains(target))
  
      // click în interior => NU închide
      if (inVersion || inDownload) return
  
      // click în afară => închide
      setVersionDropdownOpen(false)
      setDownloadMenuOpen(false)
    }
  
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [versionDropdownOpen, downloadMenuOpen])
  
  const downloadAllFilesForVersion = async (version: number) => {
    const group = groupedVersions.find(v => v.version === version)
    if (!group || group.files.length === 0) return

    const opId = `all-v${version}`
    setDownloadingId(opId)
    setDownloadMenuOpen(false)

    try {
      showToast(`Se descarcă ${group.files.length} fișiere...`, 'info')

      //TODO: ar trebui un endpoint pentru descarcare ca zip, nu reliable cu multe fisiere
      for (const file of group.files) {
        const res = await apiFetch(`/api/files/${file.id}/signed-download`, {
          method: 'POST',
          body: JSON.stringify({ expiresIn: 60 * 5 })
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || res.statusText)

        forceDownload(data.url)
        await new Promise(resolve => setTimeout(resolve, 350))
      }

      showToast('Descărcare începută', 'success')
    } catch (error: any) {
      showToast('Eroare la descărcare: ' + error.message, 'error')
    } finally {
      setDownloadingId(null)
    }
  }


  // State pentru expandare răspunsuri
  const [showAllVersions, setShowAllVersions] = useState(false)
  const [hoveredImageUrl, setHoveredImageUrl] = useState<string | null>(null)
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false)

  const downloadAttachmentModel = async () => {
    setDownloadingId('attachment')
    try {
      const res = await apiFetch(`/api/document-requests/${request.id}/attachment/signed-download`, {
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

  // Download all files at once
  const downloadAllFiles = async () => {
    if (!request.files || request.files.length === 0) return
    
    showToast(`Se descarcă ${request.files.length} fișiere...`, 'info')
    
    for (const file of request.files) {
      await downloadUploadedFileById(file.id)
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  // Get image preview URL for hover
  const handleImagePreview = async (fileId: string, fileName: string) => {
    // Check if it's an image file
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)
    if (!isImage) return

    setImagePreviewLoading(true)
    try {
      const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
        method: 'POST',
        body: JSON.stringify({ expiresIn: 60 * 5 })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return
      
      setHoveredImageUrl(data.url)
    } catch (error) {
      // Silently fail for preview
    } finally {
      setImagePreviewLoading(false)
    }
  }

  const clearImagePreview = () => {
    setHoveredImageUrl(null)
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
        {/* Header cu Status Badge */}
        <div className="relative bg-gradient-to-r from-slate-50 to-white px-6 py-5 border-b border-slate-200">
          {/* Close button */}
          <button 
            onClick={onClose} 
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors z-10"
            aria-label="Închide"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Status Badge - TOP RIGHT sub close button */}
          <div className="absolute top-16 right-4">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${statusConfig.bg} ${statusConfig.border} ${statusConfig.text}`}>
              <span className={`w-2 h-2 rounded-full ${statusConfig.dotColor} animate-pulse`} />
              <StatusIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-bold uppercase tracking-wide">{statusConfig.label}</span>
            </div>
          </div>

          {/* Title și Description */}
          <div className="pr-32">
            <h2 className="text-2xl font-bold text-slate-900 mb-2 leading-tight">
              {request.name}
            </h2>
            {request.description && (
              <p className="text-slate-600 text-sm leading-relaxed">
                {request.description}
              </p>
            )}
          </div>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
          {/* Info Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-slate-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Creat de</p>
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {request.creator?.full_name || request.creator?.email || 'Necunoscut'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-slate-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Data creării</p>
                <p className="text-sm font-semibold text-slate-900">
                  {new Date(request.created_at).toLocaleDateString('ro-RO', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  })}
                </p>
              </div>
            </div>

            {request.deadline_at && (
              <div className={`flex items-center gap-3 p-4 rounded-xl border ${
                isOverdue 
                  ? 'border-red-200 bg-red-50'
                  : 'border-amber-200 bg-amber-50/50'
              } sm:col-span-2`}>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isOverdue ? 'bg-red-100' : 'bg-amber-100'
                }`}>
                  <Clock className={`w-5 h-5 ${isOverdue ? 'text-red-600' : 'text-amber-600'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${
                    isOverdue ? 'text-red-600' : 'text-amber-600'
                  }`}>
                    {isOverdue ? '⚠️ Termen depășit' : 'Termen limită'}
                  </p>
                  <p className={`text-sm font-bold ${isOverdue ? 'text-red-900' : 'text-amber-900'}`}>
                    {new Date(request.deadline_at).toLocaleDateString('ro-RO', { 
                      day: 'numeric', 
                      month: 'long',
                      year: 'numeric'
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Files Section - REDESIGNED */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  Documente
                </h3>
              </div>

              {/* {request.files && request.files.length > 1 && (
                <button
                  onClick={downloadAllFiles}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descarcă tot
                </button>
              )} */}
            </div>

            <div className="space-y-3">
              {/* Model/Template - Dacă există */}
              {request.attachment_path && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-slate-400" />
                    Model
                  </p>
                  <button
                    onClick={downloadAttachmentModel}
                    disabled={downloadingId === 'attachment'}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-indigo-50/30 hover:from-indigo-100 hover:to-indigo-50 transition-all group text-left disabled:opacity-60 shadow-sm hover:shadow-md"
                  >
                    <div className="w-12 h-12 rounded-xl bg-white shadow-sm border border-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
                      {downloadingId === 'attachment' ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <FileText className="w-6 h-6" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-indigo-900 mb-0.5">Document template</p>
                      <p className="text-xs text-indigo-600">Model de completat pentru client</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-indigo-200">
                        <Download className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="text-xs font-semibold text-indigo-700">Download</span>
                      </div>
                      <Download className="w-5 h-5 text-indigo-400 sm:hidden" />
                    </div>
                  </button>
                </div>
              )}

              {/* Răspunsuri - Elegant grouping */}
              {request.files && request.files.length > 0 && groupedVersions.length > 0 && (
                <div onClick={e => e.stopPropagation()}>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-slate-400" />
                    Răspunsuri client ({groupedVersions.length})
                  </p>

                  {(() => {
                    const group = groupedVersions.find(v => v.version === selectedVersion) || groupedVersions[0]
                    if (!group) return null
                    const opAllId = `all-v${group.version}`

                    return (
                      <div className="space-y-3">
                        {/* Version selector */}
                        <div className="relative" ref={versionWrapRef}>
                          <button
                            onClick={() => {
                              setVersionDropdownOpen(v => !v)
                              setDownloadMenuOpen(false)
                            }}
                            className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-50/30 hover:from-emerald-100 hover:to-emerald-50 transition-all text-left shadow-sm hover:shadow-md"
                          >
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="w-12 h-12 rounded-xl bg-white shadow-sm border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                                <FileCheck className="w-6 h-6" />
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="text-sm font-bold text-emerald-900">Răspuns v{group.version}</p>
                                  {group === groupedVersions[0] && (
                                    <span className="px-2 py-0.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wider shadow-sm">
                                      Latest
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 bg-white text-[10px] font-bold rounded-full uppercase tracking-wider border border-emerald-200 text-emerald-700">
                                    {group.files.length} fiș.
                                  </span>
                                </div>

                                {group.createdAt && (
                                  <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(group.createdAt).toLocaleDateString('ro-RO', {
                                      day: 'numeric',
                                      month: 'short',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className={`transition-transform duration-200 ${versionDropdownOpen ? 'rotate-180' : ''}`}>
                              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </button>

                          {versionDropdownOpen && (
                            <div className="absolute z-50 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                              {groupedVersions.map(v => (
                                <button
                                  key={v.version}
                                  onClick={() => {
                                    setSelectedVersion(v.version)
                                    setVersionDropdownOpen(false)
                                    setDownloadMenuOpen(false)
                                  }}
                                  className={`w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 ${
                                    v.version === group.version ? 'bg-slate-50' : ''
                                  }`}
                                >
                                  <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                                    Răspuns v{v.version}

                                    {v === groupedVersions[0] && (
                                      <span className="px-2 py-0.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                                        Latest
                                      </span>
                                    )}
                                  </p>

                                    {v.createdAt && (
                                      <p className="text-xs text-slate-500">
                                        {new Date(v.createdAt).toLocaleDateString('ro-RO', {
                                          day: 'numeric',
                                          month: 'short',
                                          year: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit'
                                        })}
                                      </p>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-xs font-bold text-slate-600">{v.files.length} fiș.</span>
                                    {v.version === group.version && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          {/* Split Download Button */}
                          <div className="relative flex-1" ref={downloadWrapRef} >
                            <div className="flex w-full rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm hover:shadow transition-shadow">
                              {/* Primary action: Download all */}
                              <button
                                onClick={() => downloadAllFilesForVersion(group.version)}
                                disabled={downloadingId === opAllId}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 hover:bg-slate-50 transition-colors disabled:opacity-60"
                              >
                                {downloadingId === opAllId ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <FolderDown className="w-4 h-4" />
                                )}
                                <span className="text-sm font-semibold">Download</span>
                                <span className="text-xs text-slate-500">({group.files.length})</span>
                              </button>

                              {/* Divider */}
                              <div className="w-px bg-slate-200" />

                              {/* Dropdown toggle */}
                              <button
                                onClick={() => {
                                  setDownloadMenuOpen(v => !v)
                                  setVersionDropdownOpen(false)
                                }}
                                className="px-3 py-3 hover:bg-slate-50 transition-colors flex items-center justify-center"
                                aria-label="Alege fișier"
                              >
                                <div className={`transition-transform duration-200 ${downloadMenuOpen ? 'rotate-180' : ''}`}>
                                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </button>
                            </div>

                            {/* Wide dropdown menu */}
                            {downloadMenuOpen && (
                              <div className="absolute z-50 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-80 overflow-y-auto">
                                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Fișiere ({group.files.length})
                                  </p>
                                </div>

                                {group.files.map(file => {
                                  const fileName = getFileName(file.storage_path)
                                  return (
                                    <div
                                      key={file.id}
                                      className="px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
                                    >
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-900 truncate">{fileName}</p>
                                        <p className="text-xs text-slate-500">
                                          {new Date(file.created_at).toLocaleDateString('ro-RO', {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                          })}
                                        </p>
                                      </div>

                                      <button
                                        onClick={() => downloadUploadedFileById(file.id)}
                                        disabled={downloadingId === file.id}
                                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-60 flex-shrink-0"
                                      >
                                        {downloadingId === file.id ? (
                                          <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                                        ) : (
                                          <Download className="w-4 h-4 text-slate-500" />
                                        )}
                                        <span className="text-sm font-semibold">Download</span>
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Empty state */}
              {!request.attachment_path && (!request.files || request.files.length === 0) && (
                <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                  <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-200 flex items-center justify-center mx-auto mb-3">
                    <Package className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-900 font-semibold mb-1">Niciun document încărcat</p>
                  <p className="text-xs text-slate-500">Clientul nu a încărcat încă fișiere</p>
                </div>
              )}
            </div>
          </div>

          {/* Comments from previous rejection */}
          {request.status === 'rejected' && request.files?.length && request.files[request.files.length - 1]?.comments && (
            <div className="p-4 bg-red-50 border-2 border-red-200 rounded-xl">
              <div className="flex items-start gap-3">
                <MessageSquare className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-red-800 uppercase tracking-wide mb-1">Motiv respingere anterioară</p>
                  <p className="text-sm text-red-700 leading-relaxed">
                    {request.files[request.files.length - 1].comments}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Feedback textarea - doar pentru review */}
          {request.status === 'review' && (
            <div>
              <label className="block text-sm font-bold text-slate-900 mb-2 uppercase tracking-wide">
                Feedback pentru client
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Scrie notițe sau observații (opțional pentru aprobare, obligatoriu pentru respingere)..."
                rows={4}
                className="w-full p-4 rounded-xl border-2 border-slate-200 bg-slate-50 text-sm focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none resize-none transition-all"
              />
              <p className="text-xs text-slate-500 mt-2">
                💡 <strong>Tip:</strong> Ctrl + Enter pentru aprobare rapidă
              </p>
            </div>
          )}
        </div>

        {/* Footer - Actions */}
        <div className="p-6 border-t border-slate-200 bg-slate-50/50">
          {request.status === 'review' ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setShowRejectConfirm(true)}
                disabled={actionLoading}
                className="flex-1 py-3 rounded-xl text-sm font-bold border-2 border-red-200 text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Se procesează...
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" />
                    Respinge
                  </>
                )}
              </button>

              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Se procesează...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Aprobă document
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center py-2">
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl ${statusConfig.bg} ${statusConfig.border} border-2`}>
                <StatusIcon className={`w-5 h-5 ${statusConfig.text}`} />
                <span className={`font-bold text-sm ${statusConfig.text}`}>
                  {statusConfig.label}
                </span>
              </div>
            </div>
          )}
        </div>
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