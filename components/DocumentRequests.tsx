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
  RefreshCw,
  FileSpreadsheet,
  FileCheck,
  FileClock,
  FileX,
  FileQuestion,
  FolderUp,
  Files
} from 'lucide-react'
import DocumentModal from './DocumentModal'
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

type PickedFile = {
  file: File
  name: string
  size: number
  type: string
  relativePath: string | null
}

function fileMetaFromFileList(fileList: FileList): PickedFile[] {
  return Array.from(fileList).map((f) => ({
    file: f,
    name: f.name,
    size: f.size,
    type: f.type || 'application/octet-stream',
    relativePath: (f as any).webkitRelativePath || null,
  }))
}

export default function DocumentRequests({ projectId }: { projectId: string }) {
  const { loading: authLoading, token, profile, apiFetch } = useAuth()

  const [requests, setRequests] = useState<DocumentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  
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
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [deadline, setDeadline] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Client upload state
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [clientFiles, setClientFiles] = useState<PickedFile[]>([])

  const canUploadFolder =
    typeof window !== 'undefined' &&
    'webkitdirectory' in HTMLInputElement.prototype &&
    !window.matchMedia?.('(pointer: coarse)').matches &&
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

  const isAdminOrConsultant = profile?.role === 'admin' || profile?.role === 'consultant'
  const isClient = profile?.role === 'client'

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
    if (!projectId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/document-requests`, { method: 'GET' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || res.statusText)
      setRequests(data?.requests || [])
    } catch (e: any) {
      console.error('Eroare la încărcare cereri:', e.message)
      setRequests([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!token) return
    fetchRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, projectId])

  const handleTemplateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setTemplateFile(e.target.files[0])
  }

  const handleClientFilesPick = (files: FileList | null, requestId: string) => {
    if (!files || files.length === 0) return
    setClientFiles(fileMetaFromFileList(files))
    setUploadingFor(requestId)
  }

  // Upload helper (init -> PUT -> complete)
  const uploadFilesToRequest = async (requestId: string, picked: PickedFile[]) => {
    const initRes = await apiFetch(`/api/document-requests/${requestId}/uploads/init`, {
      method: 'POST',
      body: JSON.stringify({
        files: picked.map((p) => ({
          name: p.name,
          size: p.size,
          type: p.type,
          relativePath: p.relativePath,
        })),
      }),
    })
    const init = await initRes.json().catch(() => ({}))
    if (!initRes.ok) throw new Error(init?.error || 'Init upload failed')

    await Promise.all(
      init.uploads.map(async (u: any) => {
        const p = picked[u.clientFileId]
        const res = await fetch(u.signedUploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${u.token}`,
            'Content-Type': p.type,
          },
          body: p.file,
        })
        if (!res.ok) throw new Error(`Upload failed: ${p.name}`)
      })
    )

    const completeRes = await apiFetch(`/api/document-requests/${requestId}/uploads/complete`, {
      method: 'POST',
      body: JSON.stringify({
        batchId: init.batchId,
        versionNumber: init.versionNumber,
        uploaded: init.uploads.map((u: any) => ({
          storagePath: u.storagePath,
          originalName: picked[u.clientFileId].name,
          relativePath: picked[u.clientFileId].relativePath,
        })),
      }),
    })
    const complete = await completeRes.json().catch(() => ({}))
    if (!completeRes.ok) throw new Error(complete?.error || 'Complete upload failed')
  }

  const handleClientUpload = async (requestId: string) => {
    if (!clientFiles.length) return
    setSubmitting(true)
    try {
      await uploadFilesToRequest(requestId, clientFiles)
      setClientFiles([])
      setUploadingFor(null)
      await fetchRequests()
      alert('Document(e) încărcat(e) cu succes!')
    } catch (e: any) {
      alert('Eroare la încărcare: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const downloadUploadedFileById = async (fileId: string) => {
    const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
      method: 'POST',
      body: JSON.stringify({ expiresIn: 60 * 5 }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return alert('Eroare la descărcare: ' + (data?.error || res.statusText))
    forceDownload(data.url)
  }

  const downloadAttachmentModel = async (requestId: string) => {
    const res = await apiFetch(`/api/document-requests/${requestId}/attachment/signed-download`, {
      method: 'POST',
      body: JSON.stringify({ expiresIn: 60 * 5 }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return alert('Eroare la descărcare: ' + (data?.error || res.statusText))
    forceDownload(data.url)
  }

  // Create request (admin/consultant) via API, with optional template upload
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)

    try {
      let attachment_path: string | null = null

      if (templateFile) {
        // 1) init template upload
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

        // 2) PUT to storage
        const putRes = await fetch(init.signedUploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${init.token}`,
            'Content-Type': templateFile.type || 'application/octet-stream',
          },
          body: templateFile,
        })
        if (!putRes.ok) throw new Error('Attachment upload failed')
        attachment_path = init.storagePath
      }

      // 3) create request row
      const res = await apiFetch(`/api/projects/${projectId}/document-requests`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          deadline_at: deadline || null,
          attachment_path,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Create request failed')

      setName('')
      setDescription('')
      setTemplateFile(null)
      setDeadline('')
      setShowForm(false)
      await fetchRequests()
    } catch (e: any) {
      alert('Eroare: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

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
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900 truncate">
                  {isClient ? 'Documente de completat' : 'Cereri documente'}
                </h2>
                <p className="text-xs text-slate-500 truncate hidden sm:block">
                  {isClient ? 'Descarcă, completează și încarcă' : `${requests.length} cereri în total`}
                </p>
              </div>
            </div>

            {isAdminOrConsultant && (
              <button
                onClick={() => setShowForm(!showForm)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                  showForm ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-900/10'
                }`}
              >
                {showForm ? (<><X className="w-4 h-4" /><span className="hidden sm:inline">Anulează</span></>) : (<><Plus className="w-4 h-4" /><span className="hidden sm:inline">Cerere nouă</span></>)}
              </button>
            )}
          </div>
        </div>

        {showForm && isAdminOrConsultant && (
          <div className="p-4 sm:p-5 bg-slate-50/80 border-b border-slate-200">
            <form onSubmit={handleSubmit} className="space-y-4">
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

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <label className="flex-1 cursor-pointer">
                  <div className={`px-4 py-3 border-2 border-dashed rounded-xl text-center transition-all ${
                    templateFile ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}>
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <Paperclip className={`w-4 h-4 ${templateFile ? 'text-indigo-600' : 'text-slate-400'}`} />
                      <span className={templateFile ? 'text-indigo-700 font-medium' : 'text-slate-500'}>
                        {templateFile ? templateFile.name : 'Atașează model (opțional)'}
                      </span>
                    </div>
                  </div>
                  <input type="file" onChange={handleTemplateFileChange} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
                </label>

                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
                >
                  {submitting ? 'Se trimite...' : 'Trimite cerere'}
                </button>
              </div>
            </form>
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
            requests.map((req) => {
              const status = statusConfig[req.status] || statusConfig.pending
              const isOverdue = req.deadline_at && new Date(req.deadline_at) < new Date() && req.status === 'pending'

              return (
                <div
                  key={req.id}
                  className={`p-4 sm:p-5 transition-all ${isAdminOrConsultant ? 'cursor-pointer hover:bg-slate-50/80' : ''}`}
                  onClick={() => isAdminOrConsultant && setSelectedRequest(req)}
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${status.iconBg} flex items-center justify-center flex-shrink-0 ${status.text}`}>
                      {status.docIcon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900 text-sm sm:text-base truncate pr-2">{req.name}</h3>
                        <span className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold ${status.bg} ${status.text} ${status.border} border`}>
                          {status.label}
                        </span>
                      </div>

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

                        {req.files?.length ? (
                          <span className="flex items-center gap-1.5 text-emerald-600">
                            <Upload className="w-3.5 h-3.5" />
                            {req.files.length} {req.files.length === 1 ? 'răspuns' : 'răspunsuri'}
                          </span>
                        ) : null}

                        {req.attachment_path && (
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadAttachmentModel(req.id) }}
                            className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Model
                          </button>
                        )}
                      </div>
                    </div>

                    {isAdminOrConsultant && (
                      <ChevronRight className="w-5 h-5 text-slate-300 flex-shrink-0 hidden sm:block" />
                    )}
                  </div>

                  {isClient && (req.status === 'pending' || req.status === 'rejected') && (
                    <div className="mt-4 pt-4 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                      {uploadingFor === req.id ? (
                        <div className="flex flex-col gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                          <div className="flex items-center gap-2">
                            <Paperclip className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                            <span className="flex-1 text-sm text-indigo-700 truncate font-medium">
                              {clientFiles.length === 1 ? clientFiles[0].name : `${clientFiles.length} fișiere selectate`}
                            </span>

                            <button
                              onClick={() => handleClientUpload(req.id)}
                              disabled={submitting}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
                            >
                              {submitting ? 'Se încarcă...' : 'Încarcă'}
                            </button>

                            <button
                              onClick={() => { setClientFiles([]); setUploadingFor(null) }}
                              className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white transition-all"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="cursor-pointer block">
                              <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-indigo-200 rounded-xl text-indigo-700 hover:bg-white transition-all">
                                <Files className="w-4 h-4" />
                                <span className="text-xs font-semibold">Schimbă fișiere</span>
                              </div>
                              <input type="file" multiple onChange={(e) => {
                                  handleClientFilesPick(e.currentTarget.files, req.id)
                                  e.currentTarget.value = '' // permite re-select
                                }} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
                            </label>

                            {canUploadFolder ? (
                              <label className="cursor-pointer block">
                                <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-indigo-200 rounded-xl text-indigo-700 hover:bg-white transition-all">
                                  <FolderUp className="w-4 h-4" />
                                  <span className="text-xs font-semibold">Schimbă folder</span>
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
                                    handleClientFilesPick(e.currentTarget.files, req.id)
                                    e.currentTarget.value = '' // permite re-select
                                  }}                                  
                                  className="hidden"
                                />
                              </label>
                            ) : (
                              <div className="px-4 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 flex items-center justify-center text-xs font-semibold">
                                Folder upload indisponibil
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="cursor-pointer block">
                            <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 transition-all">
                              <Upload className="w-4 h-4" />
                              <span className="text-sm font-medium">{req.status === 'rejected' ? 'Reîncarcă fișiere' : 'Încarcă fișiere'}</span>
                            </div>
                            <input type="file" multiple onChange={(e) => handleClientFilesPick(e.currentTarget.files, req.id)} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
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
                                onChange={(e) => handleClientFilesPick(e.currentTarget.files, req.id)}
                                className="hidden"
                              />
                            </label>
                          ) : (
                            <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-300">
                              <FolderUp className="w-4 h-4" />
                              <span className="text-sm font-medium">Folder indisponibil</span>
                            </div>
                          )}
                        </div>
                      )}

                      {req.status === 'rejected' && req.files?.length && req.files[req.files.length - 1]?.comments && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                          <div className="flex items-start gap-2">
                            <MessageSquare className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-semibold text-red-800 mb-0.5">Motiv respingere:</p>
                              <p className="text-sm text-red-700">{req.files[req.files.length - 1].comments}</p>
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
{/* 
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
          onClose={() => setSelectedRequest(null)}
          onUpdate={fetchRequests}
        />
      )}
    </>
  )
}