/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  FileText,
  Download,
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

              {request.files && request.files.length > 1 && (
                <button
                  onClick={downloadAllFiles}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descarcă tot
                </button>
              )}
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
              {request.files && request.files.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-slate-400" />
                    Răspunsuri client ({request.files.length})
                  </p>

                  {/* Latest Version - Always visible */}
                  <div className="space-y-3">
                    <button
                      onClick={() => downloadUploadedFileById(request.files![0].id)}
                      disabled={downloadingId === request.files[0].id}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-50/30 hover:from-emerald-100 hover:to-emerald-50 transition-all group text-left disabled:opacity-60 shadow-sm hover:shadow-md relative overflow-hidden"
                    >
                      {/* Accent line */}
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-400 to-emerald-600" />
                      
                      <div className="w-12 h-12 rounded-xl bg-white shadow-sm border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0 ml-2">
                        {downloadingId === request.files[0].id ? (
                          <Loader2 className="w-6 h-6 animate-spin" />
                        ) : (
                          <FileCheck className="w-6 h-6" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-bold text-emerald-900">
                            Versiune curentă v{request.files[0].version_number}
                          </p>
                          <span className="px-2 py-0.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wider shadow-sm">
                            Latest
                          </span>
                        </div>
                        <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                          <Calendar className="w-3 h-3" />
                          {new Date(request.files[0].created_at).toLocaleDateString('ro-RO', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-emerald-200">
                          <Download className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-xs font-semibold text-emerald-700">Download</span>
                        </div>
                        <Download className="w-5 h-5 text-emerald-400 sm:hidden" />
                      </div>
                    </button>

                    {/* Older Versions - Collapsible */}
                    {request.files.length > 1 && (
                      <div className="space-y-2">
                        <button
                          onClick={() => setShowAllVersions(!showAllVersions)}
                          className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-all text-left group"
                        >
                          <div className="flex items-center gap-2">
                            <History className="w-4 h-4 text-slate-400" />
                            <span className="text-xs font-semibold text-slate-600">
                              {showAllVersions ? 'Ascunde' : 'Vezi'} versiuni anterioare ({request.files.length - 1})
                            </span>
                          </div>
                          <div className={`transition-transform duration-300 ${showAllVersions ? 'rotate-180' : ''}`}>
                            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {/* Timeline cu versiuni - Collapsible */}
                        <div 
                          className={`overflow-hidden transition-all duration-300 ${
                            showAllVersions ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
                          }`}
                        >
                          <div className="pl-4 border-l-2 border-slate-200 ml-6 space-y-3 pt-2">
                            {request.files.slice(1).map((file, index) => {
                              const isLast = index === request.files!.length - 2
                              
                              return (
                                <div key={file.id} className="relative">
                                  {/* Timeline dot */}
                                  <div className="absolute -left-[25px] top-4 w-4 h-4 rounded-full bg-white border-2 border-slate-300 shadow-sm" />
                                  
                                  <button
                                    onClick={() => downloadUploadedFileById(file.id)}
                                    disabled={downloadingId === file.id}
                                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all group text-left disabled:opacity-60"
                                  >
                                    <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 flex-shrink-0">
                                      {downloadingId === file.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <FileCheck className="w-4 h-4" />
                                      )}
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-semibold text-slate-700">
                                        Versiune v{file.version_number}
                                      </p>
                                      <p className="text-[11px] text-slate-500 flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {new Date(file.created_at).toLocaleDateString('ro-RO', {
                                          day: 'numeric',
                                          month: 'short',
                                          hour: '2-digit',
                                          minute: '2-digit'
                                        })}
                                      </p>
                                    </div>
                                    
                                    <Download className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                                  </button>
                                  
                                  {/* Timeline line */}
                                  {!isLast && (
                                    <div className="absolute -left-[21px] top-[60px] bottom-[-12px] w-0.5 bg-slate-200" />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
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