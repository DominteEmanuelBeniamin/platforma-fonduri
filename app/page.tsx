/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from './providers/AuthProvider'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'

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
  const [myActivities, setMyActivities] = useState<any[]>([])

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
    apiFetch('/api/my-activities')
      .then(r => r.json())
      .then(d => setMyActivities(d.activities ?? []))
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, currentUser?.role])

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

      {/* 3. ACTIVITĂȚILE MELE — doar pentru consultanți */}
      {isConsultant && myActivities.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Activitățile mele</h2>
            <span className="text-xs text-slate-400">{myActivities.length} active</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myActivities.map((act: any) => {
              const deadline = act.deadline_at ? new Date(act.deadline_at) : null
              deadline?.setHours(0, 0, 0, 0)
              const isOverdue = deadline && deadline < today
              const isSoon = deadline && !isOverdue && (deadline.getTime() - today.getTime()) <= 3 * 24 * 60 * 60 * 1000

              return (
                <Link key={act.id} href={`/projects/${act.project_id}`}>
                  <div className="group bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-200 hover:shadow-md transition-all cursor-pointer">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-xs font-medium text-indigo-600 truncate">{act.project_title}</p>
                      {act.pending_docs > 0 && (
                        <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                          {act.pending_docs}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-800 leading-snug mb-3">{act.name}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 truncate">{act.phase_name}</span>
                      {deadline ? (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          isOverdue ? 'bg-red-50 text-red-600' :
                          isSoon    ? 'bg-amber-50 text-amber-600' :
                                      'bg-slate-100 text-slate-500'
                        }`}>
                          {isOverdue ? '⚠ ' : ''}{deadline.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. LISTA PROIECTE */}
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