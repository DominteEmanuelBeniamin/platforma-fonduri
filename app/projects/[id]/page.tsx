/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  AlertCircle,
  Pencil,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Play,
  Building2,
  Layers,
  FolderOpen,
  MessageSquare,
} from 'lucide-react'

import ProjectChatDrawer from '@/components/ProjectChatDrawer'
import TeamManager from '@/components/TeamManager'
import DocumentRequests from '@/components/DocumentRequests'
import { useAuth } from '@/app/providers/AuthProvider'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectActivity {
  id: string
  name: string
  status: string
  order_index: number
}

interface ProjectPhase {
  id: string
  name: string
  status: string
  order_index: number
  project_status_id: string
  project_status?: { id: string; name: string; color: string }
  activities?: ProjectActivity[]
}

// ─── Status config ────────────────────────────────────────────────────────────

const phaseStatusCfg: Record<string, { label: string; color: string; ring: string }> = {
  pending:     { label: 'În așteptare', color: 'text-slate-500',   ring: 'ring-slate-200' },
  in_progress: { label: 'În lucru',     color: 'text-blue-600',    ring: 'ring-blue-200' },
  completed:   { label: 'Finalizat',    color: 'text-emerald-600', ring: 'ring-emerald-200' },
  skipped:     { label: 'Omis',         color: 'text-slate-400',   ring: 'ring-slate-100' },
}

function ActivityStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
  if (status === 'in_progress') return <Play className="w-4 h-4 text-blue-500 flex-shrink-0" />
  return <Circle className="w-4 h-4 text-slate-300 flex-shrink-0" />
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = useMemo(() => {
    const id = (params as any)?.id
    return typeof id === 'string' && id.trim().length > 0 ? id : null
  }, [params])

  const { loading: authLoading, token, apiFetch, profile } = useAuth()

  const [project, setProject] = useState<any>(null)
  const [phases, setPhases] = useState<ProjectPhase[]>([])
  const [allDocRequests, setAllDocRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set())
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null)

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const [chatOpen, setChatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Citim lastSeen din localStorage
  const getLastSeen = useCallback(() => {
    if (typeof window === 'undefined' || !projectId) return null
    return localStorage.getItem(`chat_last_seen_${projectId}`)
  }, [projectId])

  const markAsRead = useCallback(() => {
    if (!projectId) return
    const now = new Date().toISOString()
    localStorage.setItem(`chat_last_seen_${projectId}`, now)
    setUnreadCount(0)
  }, [projectId])

  const handleOpenChat = () => {
    markAsRead()
    setChatOpen(true)
  }

  // Realtime listener pentru unread count (lightweight, fără fetch)
  useEffect(() => {
    if (!projectId || authLoading) return
    if (typeof window === 'undefined') return

    const { supabase } = require('@/lib/supabaseClient')
    const channel = supabase
      .channel(`unread-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'project_chat_messages',
          filter: `project_id=eq.${projectId}`,
        },
        (payload: any) => {
          const row = payload.new
          if (!row?.id || row?.deleted_at) return
          // dacă mesajul e de la altcineva și chat-ul e închis -> incrementăm
          if (row.created_by !== profile?.id && !chatOpen) {
            setUnreadCount((prev) => prev + 1)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId, authLoading, profile?.id, chatOpen])

  const isAdmin = profile?.role === 'admin'
  const isConsultant = profile?.role === 'consultant'
  const canEdit = isAdmin || isConsultant

  // ─── Fetch ────────────────────────────────────────────────────────────────

  const fetchAll = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [projRes, phasesRes, docsRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}`),
        apiFetch(`/api/projects/${projectId}/phases`),
        apiFetch(`/api/projects/${projectId}/document-requests`),
      ])

      if (!projRes.ok) { router.replace('/'); return }
      setProject((await projRes.json()).project)

      if (phasesRes.ok) {
        const ph: ProjectPhase[] = (await phasesRes.json()).phases || []
        setPhases(ph)
        // Auto-select: faza in_progress sau prima
        const active = ph.find(p => p.status === 'in_progress') || ph[0]
        if (active) {
          setExpandedPhases(new Set([active.id]))
          setActivePhaseId(active.id)
        }
      }

      if (docsRes.ok) {
        setAllDocRequests((await docsRes.json()).requests || [])
      }
    } finally {
      setLoading(false)
    }
  }

  // Refresh doar cererile (apelat de DocumentRequests prin onRefresh)
  const refreshDocs = async () => {
    if (!projectId) return
    try {
      const res = await apiFetch(`/api/projects/${projectId}/document-requests`)
      if (res.ok) setAllDocRequests((await res.json()).requests || [])
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    fetchAll()
  }, [authLoading, token, projectId])

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleSaveTitle = async () => {
    if (!editTitle.trim() || editTitle === project?.title) { setIsEditingTitle(false); return }
    setSaving(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH', body: JSON.stringify({ title: editTitle.trim() })
      })
      const data = await res.json().catch(() => null)
      if (res.ok) { setProject(data.project); setIsEditingTitle(false) }
      else alert(data?.error || 'Eroare')
    } finally { setSaving(false) }
  }

  const updatePhaseStatus = async (phaseId: string, status: string) => {
    await apiFetch(`/api/projects/${projectId}/phases/${phaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    })
    fetchAll()
  }

  const updateActivityStatus = async (phaseId: string, activityId: string, status: string) => {
    await apiFetch(`/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    })
    fetchAll()
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const activePhase = phases.find(p => p.id === activePhaseId) || null

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Se încarcă...</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Proiect negăsit</h2>
          <button onClick={() => router.push('/')}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Înapoi
          </button>
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors flex-shrink-0">
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium hidden sm:block">Proiecte</span>
          </button>
          <span className="text-slate-300 hidden sm:block">/</span>

          {/* Editable title */}
          {isEditingTitle ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false) }}
                autoFocus disabled={saving}
                className="flex-1 text-sm font-semibold text-slate-900 bg-transparent border-b border-indigo-500 focus:outline-none py-0.5 min-w-0"
              />
              <button onClick={handleSaveTitle} disabled={saving}
                className="p-1 rounded bg-emerald-100 text-emerald-600 flex-shrink-0">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setIsEditingTitle(false)}
                className="p-1 rounded bg-slate-100 text-slate-500 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h1 className="text-sm font-semibold text-slate-900 truncate">{project.title}</h1>
              {isAdmin && (
                <button onClick={() => { setEditTitle(project.title); setIsEditingTitle(true) }}
                  className="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 flex-shrink-0">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Meta pills */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleOpenChat}
              className="relative inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 px-2.5 py-1 rounded-full hover:bg-slate-50"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold shadow">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              <Building2 className="w-3.5 h-3.5" />
              {project.profiles?.full_name || 'Client'}
            </span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              project.status === 'implementare' ? 'bg-blue-100 text-blue-700' :
              project.status === 'monitorizare' ? 'bg-emerald-100 text-emerald-700' :
              'bg-amber-100 text-amber-700'
            }`}>
              {project.status === 'implementare' ? 'Implementare' :
               project.status === 'monitorizare' ? 'Monitorizare' : 'Contractare'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 overflow-hidden max-w-screen-2xl w-full mx-auto">

        {/* ══ SIDEBAR: Faze ══ */}
        <aside className="hidden md:flex flex-col w-64 lg:w-72 flex-shrink-0 bg-white border-r border-slate-200 overflow-y-auto">
          <div className="p-4 border-b border-slate-100 flex-shrink-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-3.5 h-3.5" /> Faze proiect
            </p>
          </div>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {phases.length === 0 && (
              <div className="p-6 text-center">
                <FolderOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Nicio fază importată</p>
              </div>
            )}

            {phases.map(phase => {
              const isActive = phase.id === activePhaseId
              const isExpanded = expandedPhases.has(phase.id)
              const color = phase.project_status?.color || '#6B7280'
              const pCfg = phaseStatusCfg[phase.status] || phaseStatusCfg.pending

              return (
                <div key={phase.id}>
                  <button
                    onClick={() => {
                      setActivePhaseId(phase.id)
                      const s = new Set(expandedPhases)
                      isExpanded ? s.delete(phase.id) : s.add(phase.id)
                      setExpandedPhases(s)
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all ${
                      isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className={`flex-1 text-sm font-medium truncate ${isActive ? 'text-indigo-900' : 'text-slate-700'}`}>
                      {phase.name}
                    </span>
                    <span className={`text-[10px] font-medium hidden lg:block flex-shrink-0 ${pCfg.color}`}>
                      {pCfg.label}
                    </span>
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    }
                  </button>

                  {/* Activities sub-list */}
                  {isExpanded && phase.activities && phase.activities.length > 0 && (
                    <div className="ml-5 mt-0.5 mb-1 pl-3 border-l-2 border-slate-100 space-y-0.5">
                      {phase.activities.map(act => (
                        <div key={act.id}
                          className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-slate-50">
                          <ActivityStatusIcon status={act.status} />
                          <span className="text-xs text-slate-600 truncate flex-1">{act.name}</span>
                          {canEdit && (
                            <select
                              value={act.status}
                              onChange={e => updateActivityStatus(phase.id, act.id, e.target.value)}
                              onClick={e => e.stopPropagation()}
                              className="text-[10px] border-0 bg-transparent text-slate-400 focus:outline-none cursor-pointer"
                            >
                              <option value="pending">Pending</option>
                              <option value="in_progress">În lucru</option>
                              <option value="completed">Done</option>
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          {/* Team manager jos sidebar */}
          <div className="border-t border-slate-100 flex-shrink-0">
            <TeamManager projectId={projectId!} />
          </div>
        </aside>

        {/* ══ MAIN: Cereri documente pe faza activă ══ */}
        <main className="flex-1 overflow-y-auto">
          {phases.length === 0 ? (
            // Niciun template importat
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                <Layers className="w-8 h-8 text-slate-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Niciun template importat</h2>
              <p className="text-sm text-slate-500 max-w-xs">
                Importați un template de proiect pentru a vedea fazele și cererile de documente organizate pe activități.
              </p>
            </div>
          ) : (
            <div className="p-4 sm:p-6 space-y-4 max-w-4xl">

              {/* Phase header + status */}
              {activePhase && (
                <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: activePhase.project_status?.color || '#6B7280' }}
                    />
                    <h2 className="text-xl font-bold text-slate-900">{activePhase.name}</h2>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ring-1 ${
                      (phaseStatusCfg[activePhase.status] || phaseStatusCfg.pending).ring
                    } ${(phaseStatusCfg[activePhase.status] || phaseStatusCfg.pending).color}`}>
                      {(phaseStatusCfg[activePhase.status] || phaseStatusCfg.pending).label}
                    </span>
                  </div>
                  {canEdit && (
                    <select
                      value={activePhase.status}
                      onChange={e => updatePhaseStatus(activePhase.id, e.target.value)}
                      className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="pending">În așteptare</option>
                      <option value="in_progress">În lucru</option>
                      <option value="completed">Finalizat</option>
                      <option value="skipped">Omis</option>
                    </select>
                  )}
                </div>
              )}

              {/* Un DocumentRequests per activitate din faza activă */}
              {activePhase?.activities?.map(activity => (
                <DocumentRequests
                  key={activity.id}
                  projectId={projectId!}
                  activityId={activity.id}
                  activityName={activity.name}
                  externalRequests={allDocRequests}
                  onRefresh={refreshDocs}
                />
              ))}

              {/* DocumentRequests pentru cereri fără activitate (generale) */}
              <DocumentRequests
                key="__general__"
                projectId={projectId!}
                activityId={null}
                activityName="Cereri generale"
                externalRequests={allDocRequests}
                onRefresh={refreshDocs}
              />
            </div>
          )}
        </main>
      </div>
      {projectId && (
        <ProjectChatDrawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          title="Chat proiect"
          projectId={projectId}
          markAsRead={markAsRead}
        />
      )}



    </div>
  )
}