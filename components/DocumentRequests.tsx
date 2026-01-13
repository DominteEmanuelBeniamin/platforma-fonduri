/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { 
  FileText, 
  Plus, 
  Download, 
  Upload, 
  CheckCircle, 
  XCircle, 
  Clock,
  AlertCircle,
  Calendar,
  User,
  X as XIcon,
  Paperclip
} from 'lucide-react'

interface DocumentRequest {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'review' | 'approved' | 'rejected'
  attachment_path: string | null
  deadline_at: string | null
  created_by: string | null
  created_at: string
  creator?: {
    full_name: string | null
    email: string | null
  }
  files?: {
    id: string
    storage_path: string
    version_number: number
    comments: string | null
    created_at: string
    uploaded_by: string | null
  }[]
}

export default function DocumentRequests({ projectId }: { projectId: string }) {
  const [requests, setRequests] = useState<DocumentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  
  // Modal state
  const [selectedRequest, setSelectedRequest] = useState<DocumentRequest | null>(null)
  const [notes, setNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  
  // Form state pentru cerere nouă (admin/consultant)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [deadline, setDeadline] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Upload state pentru client
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [clientFile, setClientFile] = useState<File | null>(null)

  // Current user
  const [currentUser, setCurrentUser] = useState<any>(null)

  // Fetch current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()
        setCurrentUser(profile)
      }
    }
    getUser()
  }, [])

  // Fetch document requests
  const fetchRequests = async () => {
    setLoading(true)
    
    const { data, error } = await supabase
      .from('document_requirements')
      .select(`
        *,
        creator:created_by(full_name, email),
        files(id, storage_path, version_number, comments, created_at, uploaded_by)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Eroare la încărcare cereri:', error)
    } else {
      setRequests(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (projectId) fetchRequests()
  }, [projectId])

  // Handle file selection pentru cerere nouă
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  // Handle file selection pentru răspuns client
  const handleClientFileChange = (e: React.ChangeEvent<HTMLInputElement>, requestId: string) => {
    if (e.target.files && e.target.files[0]) {
      setClientFile(e.target.files[0])
      setUploadingFor(requestId)
    }
  }

  // Create new document request (Admin/Consultant)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setSubmitting(true)

    try {
      let attachmentPath = null

      if (file) {
        const fileName = `${Date.now()}_${file.name}`
        const filePath = `${projectId}/cereri/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('project-files')
          .upload(filePath, file)

        if (uploadError) throw uploadError
        attachmentPath = filePath
      }

      const { error: insertError } = await supabase
        .from('document_requirements')
        .insert({
          project_id: projectId,
          name: name.trim(),
          description: description.trim() || null,
          attachment_path: attachmentPath,
          deadline_at: deadline || null,
          created_by: currentUser?.id,
          status: 'pending'
        })

      if (insertError) throw insertError

      setName('')
      setDescription('')
      setFile(null)
      setDeadline('')
      setShowForm(false)
      fetchRequests()

    } catch (error: any) {
      alert('Eroare: ' + error.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Upload răspuns client
  const handleClientUpload = async (requestId: string) => {
    if (!clientFile) return

    setSubmitting(true)

    try {
      const existingFiles = requests.find(r => r.id === requestId)?.files || []
      const newVersion = existingFiles.length + 1

      const fileName = `${Date.now()}_${clientFile.name}`
      const filePath = `${projectId}/raspunsuri/${requestId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(filePath, clientFile)

      if (uploadError) throw uploadError

      const { error: insertError } = await supabase
        .from('files')
        .insert({
          requirement_id: requestId,
          storage_path: filePath,
          version_number: newVersion,
          uploaded_by: currentUser?.id
        })

      if (insertError) throw insertError

      const { error: updateError } = await supabase
        .from('document_requirements')
        .update({ status: 'review' })
        .eq('id', requestId)

      if (updateError) throw updateError

      setClientFile(null)
      setUploadingFor(null)
      fetchRequests()

      alert('Document încărcat cu succes!')

    } catch (error: any) {
      alert('Eroare la încărcare: ' + error.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Download file
  const downloadFile = async (path: string, fileName?: string) => {
    const { data, error } = await supabase.storage
      .from('project-files')
      .download(path)

    if (error) {
      alert('Eroare la descărcare: ' + error.message)
      return
    }

    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || path.split('/').pop() || 'document'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Approve request
  const handleApprove = async () => {
    if (!selectedRequest) return
    setActionLoading(true)

    try {
      if (notes.trim() && selectedRequest.files && selectedRequest.files.length > 0) {
        const lastFile = selectedRequest.files[selectedRequest.files.length - 1]
        await supabase
          .from('files')
          .update({ comments: notes.trim() })
          .eq('id', lastFile.id)
      }

      await supabase
        .from('document_requirements')
        .update({ status: 'approved' })
        .eq('id', selectedRequest.id)

      setSelectedRequest(null)
      setNotes('')
      fetchRequests()
    } catch (error: any) {
      alert('Eroare: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  // Reject request
  const handleReject = async () => {
    if (!selectedRequest) return
    if (!notes.trim()) {
      alert('Te rog scrie motivul respingerii în notițe.')
      return
    }
    setActionLoading(true)

    try {
      if (selectedRequest.files && selectedRequest.files.length > 0) {
        const lastFile = selectedRequest.files[selectedRequest.files.length - 1]
        await supabase
          .from('files')
          .update({ comments: notes.trim() })
          .eq('id', lastFile.id)
      }

      await supabase
        .from('document_requirements')
        .update({ status: 'rejected' })
        .eq('id', selectedRequest.id)

      setSelectedRequest(null)
      setNotes('')
      fetchRequests()
    } catch (error: any) {
      alert('Eroare: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  // Status badge component
  const StatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, { bg: string; text: string; border: string; icon: JSX.Element; label: string }> = {
      pending: {
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        border: 'border-amber-200',
        icon: <Clock className="w-3 h-3" />,
        label: 'Așteaptă'
      },
      review: {
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        border: 'border-blue-200',
        icon: <AlertCircle className="w-3 h-3" />,
        label: 'În verificare'
      },
      approved: {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        border: 'border-emerald-200',
        icon: <CheckCircle className="w-3 h-3" />,
        label: 'Aprobat'
      },
      rejected: {
        bg: 'bg-red-50',
        text: 'text-red-700',
        border: 'border-red-200',
        icon: <XCircle className="w-3 h-3" />,
        label: 'Respins'
      }
    }
    
    const style = config[status] || config.pending
    
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${style.bg} ${style.text} ${style.border}`}>
        {style.icon}
        {style.label}
      </span>
    )
  }

  // Verificări rol
  const isAdminOrConsultant = currentUser?.role === 'admin' || currentUser?.role === 'consultant'
  const isClient = currentUser?.role === 'client'

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-slate-500 font-medium">Se încarcă...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                <FileText className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {isClient ? 'Documente de completat' : 'Cereri documente'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isClient 
                    ? 'Descarcă, completează și încarcă documentele cerute' 
                    : 'Trimite cereri de documente către client'}
                </p>
              </div>
            </div>
            
            {isAdminOrConsultant && (
              <button
                onClick={() => setShowForm(!showForm)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
              >
                {showForm ? (
                  <>
                    <XIcon className="w-4 h-4" />
                    Anulează
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Cerere nouă
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Form pentru cerere nouă */}
        {showForm && isAdminOrConsultant && (
          <div className="p-6 bg-slate-50/50 border-b border-slate-100">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Titlu document</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Certificat Fiscal"
                    required
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Termen limită</label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">Instrucțiuni pentru client</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detalii despre document..."
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none resize-none transition-all"
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex-1 cursor-pointer">
                  <div className="px-4 py-3 border-2 border-dashed border-slate-200 rounded-lg text-center hover:border-slate-300 hover:bg-slate-50/50 transition-all">
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                      <Paperclip className="w-4 h-4" />
                      <span>{file ? file.name : 'Atașează document (opțional)'}</span>
                    </div>
                  </div>
                  <input type="file" onChange={handleFileChange} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
                </label>
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="px-6 py-3 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {submitting ? 'Se trimite...' : 'Trimite cerere'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Lista de cereri */}
        <div className="divide-y divide-slate-100">
          {requests.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-slate-300" />
              </div>
              <p className="font-semibold text-slate-900 mb-1">Nicio cerere</p>
              <p className="text-sm text-slate-500">
                {isClient ? 'Vei fi notificat când apar cereri noi' : 'Creează prima cerere pentru client'}
              </p>
            </div>
          ) : (
            requests.map((req) => (
              <div
                key={req.id}
                onClick={() => isAdminOrConsultant && setSelectedRequest(req)}
                className={`p-5 hover:bg-slate-50/50 transition-all ${isAdminOrConsultant ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-slate-900">{req.name}</h3>
                      <StatusBadge status={req.status} />
                    </div>
                    {req.description && (
                      <p className="text-sm text-slate-600 mb-3">{req.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(req.created_at).toLocaleDateString('ro-RO')}
                      </span>
                      {req.deadline_at && (
                        <span className="flex items-center gap-1.5 text-amber-600">
                          <Clock className="w-3.5 h-3.5" />
                          Termen: {new Date(req.deadline_at).toLocaleDateString('ro-RO')}
                        </span>
                      )}
                      {req.files && req.files.length > 0 && (
                        <span className="flex items-center gap-1.5 text-emerald-600">
                          <Upload className="w-3.5 h-3.5" />
                          {req.files.length} răspuns(uri)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick download button */}
                  {req.attachment_path && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        downloadFile(req.attachment_path!)
                      }}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                      title="Descarcă document"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Client upload zone */}
                {isClient && (req.status === 'pending' || req.status === 'rejected') && (
                  <div className="mt-4 pt-4 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                    {uploadingFor === req.id ? (
                      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <Paperclip className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <span className="flex-1 text-sm text-slate-600 truncate">{clientFile?.name}</span>
                        <button
                          onClick={() => handleClientUpload(req.id)}
                          disabled={submitting}
                          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-all"
                        >
                          {submitting ? 'Se încarcă...' : 'Confirmă'}
                        </button>
                        <button 
                          onClick={() => { setClientFile(null); setUploadingFor(null) }}
                          className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-all"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="cursor-pointer block">
                        <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-lg text-slate-500 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 transition-all">
                          <Upload className="w-4 h-4" />
                          <span className="text-sm font-medium">
                            {req.status === 'rejected' ? 'Reîncarcă documentul' : 'Încarcă răspuns'}
                          </span>
                        </div>
                        <input type="file" onChange={(e) => handleClientFileChange(e, req.id)} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
                      </label>
                    )}
                    
                    {req.status === 'rejected' && req.files && req.files.length > 0 && req.files[req.files.length - 1]?.comments && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                        <p className="text-xs font-medium text-red-900 mb-1">Motiv respingere:</p>
                        <p className="text-sm text-red-700">{req.files[req.files.length - 1].comments}</p>
                      </div>
                    )}
                  </div>
                )}

                {isClient && req.status === 'approved' && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-emerald-600">
                      <CheckCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">Document aprobat</span>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* MODAL */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => { setSelectedRequest(null); setNotes('') }}
          />
          
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 flex items-start justify-between">
              <div className="flex-1 pr-4">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-lg font-semibold text-slate-900">{selectedRequest.name}</h2>
                  <StatusBadge status={selectedRequest.status} />
                </div>
                {selectedRequest.description && (
                  <p className="text-sm text-slate-600">{selectedRequest.description}</p>
                )}
              </div>
              <button
                onClick={() => { setSelectedRequest(null); setNotes('') }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Creat de</p>
                    <p className="text-sm font-medium text-slate-900">
                      {selectedRequest.creator?.full_name || selectedRequest.creator?.email || 'Necunoscut'}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Data</p>
                    <p className="text-sm font-medium text-slate-900">
                      {new Date(selectedRequest.created_at).toLocaleDateString('ro-RO')}
                    </p>
                  </div>
                </div>
                {selectedRequest.deadline_at && (
                  <div className="flex items-start gap-3 col-span-2">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Termen limită</p>
                      <p className="text-sm font-medium text-amber-600">
                        {new Date(selectedRequest.deadline_at).toLocaleDateString('ro-RO')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Documents */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Documente</h3>
                <div className="space-y-2">
                  {selectedRequest.attachment_path && (
                    <button
                      onClick={() => downloadFile(selectedRequest.attachment_path!)}
                      className="w-full flex items-center gap-3 p-4 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-all text-left group"
                    >
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
                        <Download className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900">Document atașat</p>
                        <p className="text-xs text-slate-500">Click pentru descărcare</p>
                      </div>
                    </button>
                  )}
                  
                  {selectedRequest.files && selectedRequest.files.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => downloadFile(f.storage_path)}
                      className="w-full flex items-center gap-3 p-4 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-all text-left group"
                    >
                      <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                        <FileText className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900">Răspuns client (v{f.version_number})</p>
                        <p className="text-xs text-slate-500">{new Date(f.created_at).toLocaleDateString('ro-RO')}</p>
                      </div>
                    </button>
                  ))}

                  {!selectedRequest.attachment_path && (!selectedRequest.files || selectedRequest.files.length === 0) && (
                    <div className="text-center py-8 border-2 border-dashed border-slate-100 rounded-lg">
                      <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">Niciun document</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              {selectedRequest.status === 'review' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Notițe</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Scrie notițe sau motivul respingerii..."
                    rows={4}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:ring-2 focus:ring-slate-400/10 outline-none resize-none transition-all"
                  />
                </div>
              )}

              {/* Previous comments */}
              {selectedRequest.files && selectedRequest.files.length > 0 && selectedRequest.files[selectedRequest.files.length - 1]?.comments && (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                  <p className="text-xs font-medium text-slate-500 mb-2">Comentariu anterior</p>
                  <p className="text-sm text-slate-700">{selectedRequest.files[selectedRequest.files.length - 1].comments}</p>
                </div>
              )}
            </div>

            {/* Modal Footer - Actions */}
            {selectedRequest.status === 'review' && (
              <div className="p-6 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
                <button
                  onClick={handleReject}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-red-600 bg-red-50 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-all"
                >
                  <XCircle className="w-4 h-4" />
                  {actionLoading ? 'Se procesează...' : 'Respinge'}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-all"
                >
                  <CheckCircle className="w-4 h-4" />
                  {actionLoading ? 'Se procesează...' : 'Aprobă'}
                </button>
              </div>
            )}

            {selectedRequest.status === 'approved' && (
              <div className="p-6 border-t border-slate-100 bg-emerald-50/50">
                <div className="flex items-center justify-center gap-2 text-emerald-600">
                  <CheckCircle className="w-5 h-5" />
                  <p className="text-sm font-medium">Document aprobat</p>
                </div>
              </div>
            )}

            {selectedRequest.status === 'rejected' && (
              <div className="p-6 border-t border-slate-100 bg-red-50/50">
                <div className="flex items-center justify-center gap-2 text-red-600">
                  <XCircle className="w-5 h-5" />
                  <p className="text-sm font-medium">Document respins - așteaptă reîncărcare</p>
                </div>
              </div>
            )}

            {selectedRequest.status === 'pending' && (
              <div className="p-6 border-t border-slate-100 bg-slate-50/50">
                <div className="flex items-center justify-center gap-2 text-slate-500">
                  <Clock className="w-5 h-5" />
                  <p className="text-sm font-medium">Așteaptă răspuns de la client</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}