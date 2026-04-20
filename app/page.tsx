/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from './providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { Mail, FileText, Clock, AlertTriangle, Check } from 'lucide-react'
import {
  getReminderType,
  generateMailtoLink,
  REMINDER_LABELS,
  REMINDER_BADGE,
} from '@/lib/document-reminder'

export default function Dashboard() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch } = useAuth()

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<any>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [myDocRequests, setMyDocRequests] = useState<any[]>([])
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string; border: string }> = {
    contractare: { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-600', border: 'border-amber-200', label: 'În Contractare' },
    implementare: { bg: 'bg-indigo-100', text: 'text-indigo-800', dot: 'bg-indigo-600', border: 'border-indigo-200', label: 'În Implementare' },
    monitorizare: { bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-600', border: 'border-blue-200', label: 'Monitorizare' },
    approved: { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-600', border: 'border-emerald-200', label: 'Aprobat' },
    pending: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500', border: 'border-slate-200', label: 'În așteptare' },
  }

  const fetchMyProjects = async () => {
    const res = await apiFetch('/api/projects')
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error || 'Failed to load projects')
    setProjects(json.projects ?? [])
  }

  const fetchCurrentUser = async () => {
    const res = await apiFetch('/api/me')
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error || 'Failed to load current user')
    setCurrentUser(json.profile)
  }

  // Delete project - cu modal de confirmare și API
  const handleDeleteProject = async () => {
    if (!projectToDelete) return
    
    setDeleteLoading(true)
    try {
      const res = await apiFetch(`/api/projects/${projectToDelete.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed to delete project')
      
      setProjects(prev => prev.filter(p => p.id !== projectToDelete.id))
      setShowDeleteModal(false)
      setProjectToDelete(null)
    } catch (error: any) {
      console.error('Eroare la ștergere:', error)
      alert('Nu s-a putut șterge proiectul: ' + error.message)
    } finally {
      setDeleteLoading(false)
    }
  }

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null)
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [openMenuId])

  // Auth-driven bootstrapping
  useEffect(() => {
    if (authLoading) return

    if (!token) {
      router.push('/login')
      return
    }

    setLoading(true)
    Promise.all([fetchMyProjects(), fetchCurrentUser()])
      .finally(() => setLoading(false))
  }, [authLoading, token, router])

  useEffect(() => {
    if (authLoading || !token || currentUser?.role !== 'consultant') return
    apiFetch('/api/my-document-requests')
      .then(r => r.json())
      .then(d => setMyDocRequests(d.requests ?? []))
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, currentUser?.role])

  const toggleReminder = async (reqId: string) => {
    if (togglingId === reqId) return
    setTogglingId(reqId)
    try {
      const res = await apiFetch(`/api/document-requests/${reqId}/reminder`, { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        setMyDocRequests(prev =>
          prev.map(r => r.id === reqId ? { ...r, reminder_sent_at: json.reminder_sent_at } : r)
        )
      }
    } finally {
      setTogglingId(null)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    )
  }

  const isAdmin = currentUser?.role === 'admin'
  const isConsultant = currentUser?.role === 'consultant'
  const firstName = currentUser?.full_name?.split(' ')[0] || 'Utilizator'
  const currentDate = new Date().toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' })
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const stats = {
    total: projects.length,
    contractare: projects.filter(p => p.status === 'contractare').length,
    implementare: projects.filter(p => p.status === 'implementare').length
  }

  return (
    <div className="flex flex-col gap-10 fade-in-up">
      {/* 1. HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/60">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{currentDate}</p>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">Salut, {firstName}!</h1>
          <p className="text-slate-500 mt-1">Iată situația proiectelor tale.</p>
        </div>

        <div className="flex items-center gap-4">
          {isAdmin && (
            <Link href="/projects/new">
              <button className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all">
                <span>+</span> Proiect nou
              </button>
            </Link>
          )}
        </div>
      </div>

      {/* 2. STATS BAR */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
            <span className="font-bold text-lg">#</span>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase">Total</p>
            <p className="text-xl font-bold text-slate-900">{stats.total}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
            <span className="font-bold text-lg">C</span>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase">Contractare</p>
            <p className="text-xl font-bold text-slate-900">{stats.contractare}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <span className="font-bold text-lg">I</span>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase">Implementare</p>
            <p className="text-xl font-bold text-slate-900">{stats.implementare}</p>
          </div>
        </div>
      </div>

      {/* 3. CERERI DE DOCUMENTE — doar pentru consultanți */}
      {isConsultant && (() => {
        const PREVIEW = 4
        const overdueCount = myDocRequests.filter((r: any) => {
          const d = r.deadline_at ? new Date(r.deadline_at) : null
          d?.setHours(0,0,0,0)
          return d && d < today
        }).length
        const preview = myDocRequests.slice(0, PREVIEW)
        const remaining = myDocRequests.length - PREVIEW

        return (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-indigo-500" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Cereri de documente</h2>
                  {myDocRequests.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {overdueCount > 0 && (
                        <span className="text-red-500 font-semibold">{overdueCount} expirate · </span>
                      )}
                      {myDocRequests.length} în total
                    </p>
                  )}
                </div>
              </div>
              {myDocRequests.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    overdueCount > 0 ? 'bg-red-50 text-red-500' : 'bg-indigo-50 text-indigo-500'
                  }`}>
                    {myDocRequests.length}
                  </span>
                  <Link href="/my-requests">
                    <span className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold transition-colors">
                      Vezi toate →
                    </span>
                  </Link>
                </div>
              )}
            </div>

            {/* Empty state */}
            {myDocRequests.length === 0 ? (
              <div className="px-6 py-12 flex flex-col items-center justify-center text-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-1">
                  <FileText className="w-5 h-5 text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-500">Nicio cerere activă</p>
                <p className="text-xs text-slate-400">Nu ai cereri de documente în așteptare.</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-50">
                  {preview.map((req: any) => {
                    const reminderType = getReminderType(req.deadline_at) ?? '1_week'
                    const badge = REMINDER_BADGE[reminderType]
                    const mailtoLink = req.client_email
                      ? generateMailtoLink(
                          {
                            requestName: req.name,
                            requestDescription: req.description,
                            deadlineAt: req.deadline_at,
                            clientEmail: req.client_email,
                            clientName: req.client_name,
                            projectTitle: req.project_title ?? '',
                            projectId: req.project_id,
                          },
                          reminderType
                        )
                      : null

                    const deadline = req.deadline_at ? new Date(req.deadline_at) : null
                    deadline?.setHours(0, 0, 0, 0)
                    const isOverdue = deadline && deadline < today
                    const isSoon =
                      deadline &&
                      !isOverdue &&
                      deadline.getTime() - today.getTime() <= 3 * 24 * 60 * 60 * 1000

                    const accentColor = isOverdue
                      ? 'bg-red-400'
                      : reminderType === 'same_day'
                      ? 'bg-orange-400'
                      : reminderType === '1_day'
                      ? 'bg-orange-300'
                      : reminderType === '3_days'
                      ? 'bg-amber-300'
                      : 'bg-slate-200'

                    const rowBg = isOverdue ? 'bg-red-50/40 hover:bg-red-50/60' : 'hover:bg-slate-50/60'

                    return (
                      <div
                        key={req.id}
                        className={`group relative flex items-center gap-3 pl-4 pr-5 py-3.5 transition-colors ${rowBg}`}
                      >
                        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentColor}`} />
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isOverdue ? 'bg-red-100' : 'bg-slate-100'
                        }`}>
                          {isOverdue
                            ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                            : <FileText className="w-3.5 h-3.5 text-slate-400" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold truncate leading-snug ${isOverdue ? 'text-red-700' : 'text-slate-800'}`}>
                            {req.name}
                          </p>
                          <Link href={`/projects/${req.project_id}`}>
                            <p className="text-[11px] text-indigo-400 hover:text-indigo-600 hover:underline truncate mt-0.5">
                              {req.project_title}
                            </p>
                          </Link>
                        </div>
                        {deadline ? (
                          <div className={`hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0 ${
                            isOverdue
                              ? 'bg-red-100 text-red-600'
                              : isSoon
                              ? 'bg-amber-50 text-amber-600'
                              : 'bg-slate-100 text-slate-500'
                          }`}>
                            <Clock className="w-2.5 h-2.5" />
                            {deadline.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
                          </div>
                        ) : (
                          <span className="hidden sm:block text-[11px] text-slate-300 flex-shrink-0">—</span>
                        )}
                        <span className={`hidden md:inline-flex flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          req.status === 'review'
                            ? 'bg-blue-50 text-blue-500'
                            : 'bg-amber-50 text-amber-600'
                        }`}>
                          {req.status === 'review' ? 'Verificare' : 'Așteaptă'}
                        </span>
                        {mailtoLink ? (
                          <a
                            href={mailtoLink}
                            title={REMINDER_LABELS[reminderType]}
                            className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:shadow-sm active:scale-95 ${badge.bg} ${badge.text} ${badge.border} border`}
                          >
                            <Mail className="w-3 h-3" />
                            <span className="hidden sm:inline">Reminder</span>
                          </a>
                        ) : (
                          <div
                            title="Fără email client"
                            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-200 text-xs font-medium text-slate-300 cursor-not-allowed"
                          >
                            <Mail className="w-3 h-3" />
                            <span className="hidden sm:inline">Reminder</span>
                          </div>
                        )}
                        <button
                          onClick={() => toggleReminder(req.id)}
                          disabled={togglingId === req.id}
                          title={req.reminder_sent_at
                            ? `Trimis pe ${new Date(req.reminder_sent_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })} — apasă pentru a anula`
                            : 'Marchează ca trimis'}
                          className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 ${
                            req.reminder_sent_at
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100'
                              : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-500'
                          } ${togglingId === req.id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                            req.reminder_sent_at
                              ? 'bg-emerald-500 border-emerald-500'
                              : 'border-slate-300'
                          }`}>
                            {req.reminder_sent_at && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                          </div>
                          <span className="hidden sm:inline">
                            {req.reminder_sent_at ? 'Trimis' : 'Trimis?'}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
                {remaining > 0 && (
                  <Link href="/my-requests">
                    <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-center gap-1.5 text-xs font-semibold text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50/50 transition-colors cursor-pointer">
                      <span>+{remaining} mai multe cereri</span>
                      <span>→</span>
                    </div>
                  </Link>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* 5. LISTA PROIECTE */}
      {projects.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-900">Niciun proiect activ</h3>
          <p className="text-slate-500 mb-6">Lista este goală momentan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-10">
          {projects.map((project, idx) => {
            const status = statusConfig[project.status] || statusConfig.pending

            return (
              <div
                key={project.id}
                className="group bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-xl hover:shadow-indigo-900/5 hover:-translate-y-1 transition-all duration-300 h-full flex flex-col"
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className="flex items-start justify-between p-6 pb-0">
                  <div className="w-12 h-12 bg-gradient-to-br from-slate-50 to-indigo-50/50 border border-slate-100 rounded-xl flex items-center justify-center text-indigo-900/80 shadow-sm">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
                    </svg>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className={`px-3 py-1 rounded-full border text-[11px] font-bold uppercase flex items-center gap-1.5 ${status.bg} ${status.border} ${status.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                      {status.label}
                    </div>

                    {isAdmin && (
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setOpenMenuId(openMenuId === project.id ? null : project.id)
                          }}
                          className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="5" r="1.5" />
                            <circle cx="12" cy="12" r="1.5" />
                            <circle cx="12" cy="19" r="1.5" />
                          </svg>
                        </button>

                        {openMenuId === project.id && (
                          <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-20">
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setOpenMenuId(null)
                                setProjectToDelete(project)
                                setShowDeleteModal(true)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              Șterge proiectul
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <Link href={`/projects/${project.id}`} className="flex-1 p-6 pt-5">
                  <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">
                    {project.title}
                  </h3>
                  <p className="text-sm text-slate-500">{project.profiles?.full_name || 'Fără client'}</p>
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Confirmare Ștergere */}
      <ConfirmDeleteModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false)
          setProjectToDelete(null)
        }}
        onConfirm={handleDeleteProject}
        title={`Șterge "${projectToDelete?.title || 'proiectul'}"`}
        description="Toate datele asociate vor fi șterse permanent. Această acțiune nu poate fi anulată."
        confirmText="Șterge proiectul"
        confirmWord="sterge"
        loading={deleteLoading}
      />
    </div>
  )
}