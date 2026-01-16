/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
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
  RefreshCw
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

  // Status configuration
  const statusConfig: Record<string, { 
    bg: string
    text: string
    border: string
    icon: JSX.Element
    label: string
    iconBg: string
  }> = {
    pending: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      border: 'border-amber-200',
      icon: <Clock className="w-4 h-4" />,
      label: 'Așteaptă',
      iconBg: 'bg-amber-100'
    },
    review: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-200',
      icon: <Eye className="w-4 h-4" />,
      label: 'În verificare',
      iconBg: 'bg-blue-100'
    },
    approved: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      icon: <CheckCircle2 className="w-4 h-4" />,
      label: 'Aprobat',
      iconBg: 'bg-emerald-100'
    },
    rejected: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      border: 'border-red-200',
      icon: <XCircle className="w-4 h-4" />,
      label: 'Respins',
      iconBg: 'bg-red-100'
    }
  }

  // Verificări rol
  const isAdminOrConsultant = currentUser?.role === 'admin' || currentUser?.role === 'consultant'
  const isClient = currentUser?.role === 'client'

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
        {/* Header */}
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
                  {isClient 
                    ? 'Descarcă, completează și încarcă' 
                    : `${requests.length} cereri în total`}
                </p>
              </div>
            </div>
            
            {isAdminOrConsultant && (
              <button
                onClick={() => setShowForm(!showForm)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                  showForm 
                    ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' 
                    : 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-900/10'
                }`}
              >
                {showForm ? (
                  <>
                    <X className="w-4 h-4" />
                    <span className="hidden sm:inline">Anulează</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Cerere nouă</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Form pentru cerere nouă */}
        {showForm && isAdminOrConsultant && (
          <div className="p-4 sm:p-5 bg-slate-50/80 border-b border-slate-200">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
                    Titlu document
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Certificat Fiscal"
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
                    Termen limită
                  </label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
                  Instrucțiuni
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detalii pentru client despre ce trebuie să conțină documentul..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none resize-none transition-all bg-white"
                />
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <label className="flex-1 cursor-pointer">
                  <div className={`px-4 py-3 border-2 border-dashed rounded-xl text-center transition-all ${
                    file 
                      ? 'border-indigo-300 bg-indigo-50' 
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}>
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <Paperclip className={`w-4 h-4 ${file ? 'text-indigo-600' : 'text-slate-400'}`} />
                      <span className={file ? 'text-indigo-700 font-medium' : 'text-slate-500'}>
                        {file ? file.name : 'Atașează model (opțional)'}
                      </span>
                    </div>
                  </div>
                  <input type="file" onChange={handleFileChange} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
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

        {/* Lista de cereri */}
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
                  {/* Main Content Row */}
                  <div className="flex items-start gap-3 sm:gap-4">
                    {/* Status Icon */}
                    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${status.iconBg} flex items-center justify-center flex-shrink-0 ${status.text}`}>
                      {status.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Title Row */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900 text-sm sm:text-base truncate pr-2">
                          {req.name}
                        </h3>
                        <span className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold ${status.bg} ${status.text} ${status.border} border`}>
                          {status.label}
                        </span>
                      </div>
                      
                      {/* Description */}
                      {req.description && (
                        <p className="text-sm text-slate-600 mb-3 line-clamp-2">{req.description}</p>
                      )}
                      
                      {/* Meta Row - CU SPAȚIERE MĂRITĂ */}
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
                        
                        {req.files && req.files.length > 0 && (
                          <span className="flex items-center gap-1.5 text-emerald-600">
                            <Upload className="w-3.5 h-3.5" />
                            {req.files.length} {req.files.length === 1 ? 'răspuns' : 'răspunsuri'}
                          </span>
                        )}

                        {req.attachment_path && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              downloadFile(req.attachment_path!)
                            }}
                            className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Model
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Arrow for clickable items */}
                    {isAdminOrConsultant && (
                      <ChevronRight className="w-5 h-5 text-slate-300 flex-shrink-0 hidden sm:block" />
                    )}
                  </div>

                  {/* Client Upload Zone */}
                  {isClient && (req.status === 'pending' || req.status === 'rejected') && (
                    <div className="mt-4 pt-4 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                      {uploadingFor === req.id ? (
                        <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                          <Paperclip className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                          <span className="flex-1 text-sm text-indigo-700 truncate font-medium">{clientFile?.name}</span>
                          <button
                            onClick={() => handleClientUpload(req.id)}
                            disabled={submitting}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
                          >
                            {submitting ? 'Se încarcă...' : 'Încarcă'}
                          </button>
                          <button 
                            onClick={() => { setClientFile(null); setUploadingFor(null) }}
                            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white transition-all"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <label className="cursor-pointer block">
                          <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 transition-all">
                            <Upload className="w-4 h-4" />
                            <span className="text-sm font-medium">
                              {req.status === 'rejected' ? 'Reîncarcă documentul' : 'Încarcă răspuns'}
                            </span>
                          </div>
                          <input type="file" onChange={(e) => handleClientFileChange(e, req.id)} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
                        </label>
                      )}
                      
                      {/* Rejection reason */}
                      {req.status === 'rejected' && req.files && req.files.length > 0 && req.files[req.files.length - 1]?.comments && (
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

                  {/* Approved State for Client */}
                  {isClient && req.status === 'approved' && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2.5 rounded-xl">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-semibold">Document aprobat cu succes</span>
                      </div>
                    </div>
                  )}

                  {/* Review State for Client */}
                  {isClient && req.status === 'review' && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-4 py-2.5 rounded-xl">
                        <Eye className="w-4 h-4" />
                        <span className="text-sm font-medium">Documentul este în curs de verificare</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* MODAL pentru Admin/Consultant */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          {/* Overlay */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => { setSelectedRequest(null); setNotes('') }}
          />
          
          {/* Modal Content */}
          <div className="relative bg-white w-full sm:rounded-2xl sm:max-w-xl max-h-[90vh] overflow-hidden shadow-2xl rounded-t-3xl">
            {/* Drag Handle for mobile */}
            <div className="sm:hidden w-12 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-2" />
            
            {/* Header */}
            <div className="p-5 border-b border-slate-100">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {(() => {
                      const status = statusConfig[selectedRequest.status]
                      return (
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${status.bg} ${status.text} ${status.border} border flex items-center gap-1.5`}>
                          {status.icon}
                          {status.label}
                        </span>
                      )
                    })()}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">{selectedRequest.name}</h2>
                  {selectedRequest.description && (
                    <p className="text-sm text-slate-600 mt-1">{selectedRequest.description}</p>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedRequest(null); setNotes('') }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all flex-shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-5 space-y-5 max-h-[50vh] overflow-y-auto">
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-slate-500 mb-1">
                    <User className="w-4 h-4" />
                    <span className="text-xs font-medium">Creat de</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {selectedRequest.creator?.full_name || selectedRequest.creator?.email || 'Necunoscut'}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-slate-500 mb-1">
                    <Calendar className="w-4 h-4" />
                    <span className="text-xs font-medium">Data</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {new Date(selectedRequest.created_at).toLocaleDateString('ro-RO')}
                  </p>
                </div>
                {selectedRequest.deadline_at && (
                  <div className="p-3 bg-amber-50 rounded-xl col-span-2">
                    <div className="flex items-center gap-2 text-amber-600 mb-1">
                      <Clock className="w-4 h-4" />
                      <span className="text-xs font-medium">Termen limită</span>
                    </div>
                    <p className="text-sm font-semibold text-amber-700">
                      {new Date(selectedRequest.deadline_at).toLocaleDateString('ro-RO', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long'
                      })}
                    </p>
                  </div>
                )}
              </div>

              {/* Documents */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Documente</h3>
                <div className="space-y-2">
                  {selectedRequest.attachment_path && (
                    <button
                      onClick={() => downloadFile(selectedRequest.attachment_path!)}
                      className="w-full flex items-center gap-3 p-3 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-all text-left group"
                    >
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
                        <Download className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Model atașat</p>
                        <p className="text-xs text-slate-500">Click pentru descărcare</p>
                      </div>
                    </button>
                  )}
                  
                  {selectedRequest.files && selectedRequest.files.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => downloadFile(f.storage_path)}
                      className="w-full flex items-center gap-3 p-3 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-all text-left group"
                    >
                      <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                        <FileText className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Răspuns client (v{f.version_number})</p>
                        <p className="text-xs text-slate-500">{new Date(f.created_at).toLocaleDateString('ro-RO')}</p>
                      </div>
                    </button>
                  ))}

                  {!selectedRequest.attachment_path && (!selectedRequest.files || selectedRequest.files.length === 0) && (
                    <div className="text-center py-6 border-2 border-dashed border-slate-100 rounded-xl bg-slate-50/50">
                      <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">Niciun document încă</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes Field */}
              {selectedRequest.status === 'review' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Notițe / Feedback
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Scrie notițe pentru client (obligatoriu pentru respingere)..."
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none resize-none transition-all"
                  />
                </div>
              )}

              {/* Previous comments */}
              {selectedRequest.files && selectedRequest.files.length > 0 && selectedRequest.files[selectedRequest.files.length - 1]?.comments && (
                <div className="p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <MessageSquare className="w-4 h-4" />
                    <span className="text-xs font-semibold">Comentariu anterior</span>
                  </div>
                  <p className="text-sm text-slate-700">{selectedRequest.files[selectedRequest.files.length - 1].comments}</p>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-5 border-t border-slate-100 bg-slate-50/50">
              {selectedRequest.status === 'review' && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleReject}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-red-600 bg-red-50 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-100 disabled:opacity-50 transition-all"
                  >
                    <XCircle className="w-4 h-4" />
                    {actionLoading ? 'Se procesează...' : 'Respinge'}
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-lg shadow-emerald-600/20"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {actionLoading ? 'Se procesează...' : 'Aprobă'}
                  </button>
                </div>
              )}

              {selectedRequest.status === 'approved' && (
                <div className="flex items-center justify-center gap-2 text-emerald-600 py-2">
                  <CheckCircle2 className="w-5 h-5" />
                  <p className="font-semibold">Document aprobat</p>
                </div>
              )}

              {selectedRequest.status === 'rejected' && (
                <div className="flex items-center justify-center gap-2 text-red-600 py-2">
                  <RefreshCw className="w-5 h-5" />
                  <p className="font-semibold">Așteaptă reîncărcare de la client</p>
                </div>
              )}

              {selectedRequest.status === 'pending' && (
                <div className="flex items-center justify-center gap-2 text-amber-600 py-2">
                  <Clock className="w-5 h-5" />
                  <p className="font-semibold">Așteaptă răspuns de la client</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}