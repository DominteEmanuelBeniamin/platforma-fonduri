/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { 
  FileText, 
  Download, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Calendar,
  User,
  X,
  Eye,
  RefreshCw,
  FileCheck
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

interface DocumentModalProps {
  request: DocumentRequest
  onClose: () => void
  onUpdate: () => void
}

export default function DocumentModal({ request, onClose, onUpdate }: DocumentModalProps) {
  const [notes, setNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [])

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

  const handleApprove = async () => {
    setActionLoading(true)
    try {
      if (notes.trim() && request.files && request.files.length > 0) {
        const lastFile = request.files[request.files.length - 1]
        await supabase
          .from('files')
          .update({ comments: notes.trim() })
          .eq('id', lastFile.id)
      }

      await supabase
        .from('document_requirements')
        .update({ status: 'approved' })
        .eq('id', request.id)

      setNotes('')
      onUpdate()
      onClose()
    } catch (error: any) {
      alert('Eroare: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!notes.trim()) {
      alert('Te rog scrie motivul respingerii în notițe.')
      return
    }
    setActionLoading(true)
    try {
      if (request.files && request.files.length > 0) {
        const lastFile = request.files[request.files.length - 1]
        await supabase
          .from('files')
          .update({ comments: notes.trim() })
          .eq('id', lastFile.id)
      }

      await supabase
        .from('document_requirements')
        .update({ status: 'rejected' })
        .eq('id', request.id)

      setNotes('')
      onUpdate()
      onClose()
    } catch (error: any) {
      alert('Eroare: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  if (!mounted) return null

  const modalContent = (
    <div 
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ 
        zIndex: 999999,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)'
      }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      
      <div className="relative bg-white w-full max-w-lg max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* --- HEADER COMPLET CURAT --- */}
        <div className="relative bg-white px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          
          {/* Titlu și descriere (FĂRĂ ICONIȚĂ) */}
          <div className="flex-1 min-w-0 pr-8">
            <h2 className="text-xl font-bold text-slate-900 truncate leading-tight">{request.name}</h2>
            {request.description && (
              <p className="text-slate-500 text-sm mt-1 line-clamp-2">{request.description}</p>
            )}
          </div>

          {/* Buton X simplu, negru */}
          <button
            onClick={onClose}
            className="flex-shrink-0 p-2 -mr-2 text-slate-400 hover:text-black transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-white">
          
          {/* Info Cards */}
          <div className="grid gap-3">
            <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50">
              <User className="w-5 h-5 text-slate-400" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Creat de</p>
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {request.creator?.full_name || request.creator?.email || 'Necunoscut'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50">
              <Calendar className="w-5 h-5 text-slate-400" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Data</p>
                <p className="text-sm font-semibold text-slate-900">
                  {new Date(request.created_at).toLocaleDateString('ro-RO')}
                </p>
              </div>
            </div>

            {request.deadline_at && (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                <Clock className="w-5 h-5 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-xs text-amber-600 font-medium uppercase tracking-wide">Termen limită</p>
                  <p className="text-sm font-bold text-amber-900">
                    {new Date(request.deadline_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' })}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Documente */}
          <div>
            <div className="flex items-center gap-2 mb-3">
               <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Fișiere atașate</span>
               <div className="h-px flex-1 bg-slate-100"></div>
            </div>

            <div className="space-y-2">
              {request.attachment_path && (
                <button
                  onClick={() => downloadFile(request.attachment_path!)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all group text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-slate-700 group-hover:text-indigo-700">Model document</span>
                  <Download className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                </button>
              )}
              
              {request.files && request.files.map((f) => (
                <button
                  key={f.id}
                  onClick={() => downloadFile(f.storage_path)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/30 transition-all group text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                    <FileCheck className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 group-hover:text-emerald-700 truncate">Răspuns (v{f.version_number})</p>
                    <p className="text-[10px] text-slate-400">{new Date(f.created_at).toLocaleDateString('ro-RO')}</p>
                  </div>
                  <Download className="w-4 h-4 text-slate-400 group-hover:text-emerald-600" />
                </button>
              ))}
            </div>
          </div>

          {/* Feedback Input */}
          {request.status === 'review' && (
            <div>
               <div className="flex items-center gap-2 mb-2">
                 <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Feedback</span>
                 <div className="h-px flex-1 bg-slate-100"></div>
               </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Scrie notițe..."
                rows={3}
                className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:border-indigo-500 focus:bg-white outline-none resize-none transition-all"
              />
            </div>
          )}
        </div>

        {/* --- FOOTER --- */}
        <div className="p-5 border-t border-slate-100 bg-white">
          {request.status === 'review' ? (
            <div className="flex gap-3">
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-red-100 text-red-600 hover:bg-red-50 transition-colors"
              >
                Respinge
              </button>

              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#10b981' }} 
              >
                Aprobă
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-1">
               {request.status === 'approved' && (
                 <span className="flex items-center gap-2 font-bold text-sm text-emerald-600">
                   <CheckCircle2 className="w-5 h-5" /> Document aprobat
                 </span>
               )}
               {request.status === 'rejected' && (
                 <span className="flex items-center gap-2 font-bold text-sm text-red-600">
                   <XCircle className="w-5 h-5" /> Respins
                 </span>
               )}
               {request.status === 'pending' && (
                 <span className="flex items-center gap-2 font-bold text-sm text-amber-600">
                   <Clock className="w-5 h-5" /> În așteptare
                 </span>
               )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}