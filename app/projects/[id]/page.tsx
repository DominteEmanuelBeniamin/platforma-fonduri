/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  AlertCircle,
  Pencil,
  Check,
  X,
  Loader2,
  Layers,
  Building2,
  MessageSquare,
  FolderOpen,
  Search,
  Plus,
} from 'lucide-react'

import ProjectChatDrawer from '@/components/ProjectChatDrawer'
import ProjectPhasesSidebar from '@/components/ProjectPhasesSidebar'
import type { ProjectPhase } from '@/components/ProjectPhasesSidebar'
import DocumentRequests from '@/components/DocumentRequests'
import ProjectDocumentsView from '@/components/ProjectDocumentsView'
import PhaseAccordionSection from '@/components/PhaseAccordionSection'
import ActivityFold from '@/components/ActivityFold'
import ActionNeededPanel from '@/components/ActionNeededPanel'
import PublishStatusControl from '@/components/PublishStatusControl'
import UnifiedSearchDialog from '@/components/UnifiedSearchDialog'
import { buildSearchIndex, type SearchResult } from '@/lib/projectSearch'
import { useAuth } from '@/app/providers/AuthProvider'

// Secțiunea distinctă „Cereri generale" (documente fără fază/activitate)
const GENERAL_ID = '__general__'

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProjectDetailsContent() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const targetPhaseId = searchParams.get('phase')
  const targetActivityId = searchParams.get('activity')
  const projectId = useMemo(() => {
    const id = (params as any)?.id
    return typeof id === 'string' && id.trim().length > 0 ? id : null
  }, [params])

  const { loading: authLoading, token, apiFetch, profile } = useAuth()

  const [project, setProject] = useState<any>(null)
  const [phases, setPhases] = useState<ProjectPhase[]>([])
  const [allDocRequests, setAllDocRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [projectMembers, setProjectMembers] = useState<{ id: string; full_name: string | null; email: string }[]>([])

  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set())
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(new Set())
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null)
  const [highlightActivityId, setHighlightActivityId] = useState<string | null>(null)

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const [chatOpen, setChatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const [activeView, setActiveView] = useState<'phases' | 'documents'>('phases')
  const [landingView, setLandingView] = useState<'action-needed' | 'browse'>('browse')
  const [landingViewInitialized, setLandingViewInitialized] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [autoOpenRequestId, setAutoOpenRequestId] = useState<string | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const [showAddActivity, setShowAddActivity] = useState<Record<string, boolean>>({})
  const [newActivityName, setNewActivityName] = useState<Record<string, string>>({})
  const [addingActivity, setAddingActivity] = useState<Record<string, boolean>>({})

  // ─── Machetă UI #53 (status „În pregătire”/„Public”) ────────────────────────
  // Stare locală, nesalvată — doar ca să se vadă aspectul. Fazele/activitățile/
  // cererile noi pornesc „În pregătire”, ca în specificația reală din #53.
  // Se înlocuiește cu date reale din API când se implementează logica.
  const [mockVisibility, setMockVisibility] = useState<Record<string, 'draft' | 'public'>>({})
  const getMockStatus = (id: string): 'draft' | 'public' => mockVisibility[id] ?? 'draft'
  const toggleMockStatus = (id: string) => {
    setMockVisibility(prev => ({ ...prev, [id]: getMockStatus(id) === 'draft' ? 'public' : 'draft' }))
  }

  const documentEntriesCount = useMemo(() => {
    return allDocRequests.reduce((total, req) => {
      const requestAttachmentCount = req.attachment_path && !req.attachment_missing_at ? 1 : 0
      const uploadedFilesCount = (req.files ?? []).filter((file: any) => !file.deleted_at).length
      return total + requestAttachmentCount + uploadedFilesCount
    }, 0)
  }, [allDocRequests])

  const handleOpenChat = () => {
    setChatOpen(true)
  }

  const isAdmin = profile?.role === 'admin'
  const isConsultant = profile?.role === 'consultant'
  const isClient = profile?.role === 'client'
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
        const isFirstLoad = phases.length === 0
        setPhases(ph)

        // Nu resetăm fazele deja pliate/depliate la fiecare refresh — doar
        // curățăm id-urile fazelor șterse între timp din setul de expandate.
        setExpandedPhases(prev => {
          const validIds = new Set(ph.map(p => p.id))
          validIds.add(GENERAL_ID)
          const next = new Set([...prev].filter(id => validIds.has(id)))
          return next.size === prev.size ? prev : next
        })

        if (targetPhaseId === GENERAL_ID) {
          setActivePhaseId(GENERAL_ID)
          if (isFirstLoad) {
            setExpandedPhases(prev => new Set(prev).add(GENERAL_ID))
          }
        } else {
          const fromUrl = targetPhaseId ? ph.find(p => p.id === targetPhaseId) : null
          const active = fromUrl || ph.find(p => p.status === 'in_progress') || ph[0]
          if (active) {
            setActivePhaseId(active.id)
            // Doar la primul load semănăm faza activă ca implicit deplasată —
            // refresh-urile ulterioare nu trebuie să repliaze fazele utilizatorului.
            if (isFirstLoad) {
              setExpandedPhases(prev => new Set(prev).add(active.id))
            }
          }
        }
      }

      if (docsRes.ok) {
        setAllDocRequests((await docsRes.json()).requests || [])
      }
    } finally {
      setLoading(false)
    }
  }

  const refreshDocs = async () => {
    if (!projectId) return
    try {
      const res = await apiFetch(`/api/projects/${projectId}/document-requests`)
      if (res.ok) setAllDocRequests((await res.json()).requests || [])
    } catch (e) { console.error(e) }
  }

  // Refresh silențios după reordonare — fără spinner și fără resetarea fazei active
  const refreshPhases = async () => {
    if (!projectId) return
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases`)
      if (res.ok) setPhases((await res.json()).phases || [])
    } catch (e) { console.error(e) }
  }

  const fetchProjectMembers = async () => {
    if (!projectId) return
    try {
      const r = await apiFetch(`/api/projects/${projectId}/members`)
      const d = await r.json()
      setProjectMembers(
        (d.members ?? []).map((m: any) => ({
          id: m.profiles?.id ?? m.consultant_id,
          full_name: m.profiles?.full_name ?? null,
          email: m.profiles?.email ?? '',
        }))
      )
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    fetchAll()
  }, [authLoading, token, projectId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = target && ['INPUT', 'TEXTAREA'].includes(target.tagName)
      if (e.key === '/' && !isTyping && !searchOpen) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen])

  useEffect(() => {
    if (authLoading || !token || !projectId) return
    fetchProjectMembers()
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

  const handleAssignActivity = async (phaseId: string, activityId: string, assignedTo: string | null) => {
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigned_to: assignedTo }) }
      )
      if (res.ok) fetchAll()
      else { const d = await res.json().catch(() => null); alert(d?.error || 'Eroare la atribuire') }
    } catch (e: any) { alert('Eroare: ' + e.message) }
  }

  const handleAddActivity = async (phaseId: string) => {
    const name = (newActivityName[phaseId] || '').trim()
    if (!name) return
    setAddingActivity(prev => ({ ...prev, [phaseId]: true }))
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phaseId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        setShowAddActivity(prev => ({ ...prev, [phaseId]: false }))
        setNewActivityName(prev => ({ ...prev, [phaseId]: '' }))
        fetchAll()
      } else {
        const d = await res.json().catch(() => null)
        alert(d?.error || 'Eroare la adăugare')
      }
    } catch (e: any) {
      alert('Eroare: ' + e.message)
    } finally {
      setAddingActivity(prev => ({ ...prev, [phaseId]: false }))
    }
  }

  const handleAssignGeneralConsultant = async (assignedTo: string | null) => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ general_consultant_id: assignedTo }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data?.project) setProject(data.project)
      } else {
        const d = await res.json().catch(() => null)
        alert(d?.error || 'Eroare la atribuire')
      }
    } catch (e: any) { alert('Eroare: ' + e.message) }
  }

  // Doar fazele din `expandedPhases` sunt afișate în lista principală —
  // selectarea unei faze (mai jos) înlocuiește tot setul, exclusiv. Chevron-ul
  // individual doar adaugă/scoate o faza din set, fără să atingă restul —
  // folosit ca să închizi o faza vizibilă (ex. în modul „Toate fazele”).
  const handleToggleExpand = (phaseId: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })
  }

  // Selectarea unei faze din sidebar o marchează ca țintă, o depliază și
  // închide restul — accordion exclusiv.
  const scrollToPhaseSection = (id: string) => {
    setTimeout(() => {
      document.getElementById(`phase-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
  }

  const handleSelectPhase = (phaseId: string) => {
    setActiveView('phases')
    setLandingView('browse')
    setActivePhaseId(phaseId)
    setExpandedPhases(new Set([phaseId]))
    setMobileSidebarOpen(false)
    scrollToPhaseSection(phaseId)
  }

  const handleSelectGeneral = () => {
    setActiveView('phases')
    setLandingView('browse')
    setActivePhaseId(GENERAL_ID)
    setExpandedPhases(new Set([GENERAL_ID]))
    setMobileSidebarOpen(false)
    scrollToPhaseSection(GENERAL_ID)
  }

  const allPhasesExpanded =
    phases.length > 0 &&
    phases.every(p => expandedPhases.has(p.id)) &&
    expandedPhases.has(GENERAL_ID)

  const handleToggleAllPhases = () => {
    if (allPhasesExpanded) {
      setExpandedPhases(new Set())
    } else {
      setExpandedPhases(new Set([...phases.map(p => p.id), GENERAL_ID]))
    }
  }

  const handleToggleActivity = (activityId: string) => {
    setExpandedActivityIds(prev => {
      const s = new Set(prev)
      if (s.has(activityId)) s.delete(activityId)
      else s.add(activityId)
      return s
    })
  }

  // ─── Deep-link: scroll + highlight activitatea țintă din URL ────────────────
  useEffect(() => {
    if (loading || !targetActivityId || activePhaseId !== targetPhaseId) return
    setExpandedActivityIds(prev => new Set(prev).add(targetActivityId))
    const timer = setTimeout(() => {
      const el = document.getElementById(`activity-${targetActivityId}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightActivityId(targetActivityId)
      setTimeout(() => setHighlightActivityId(null), 2500)
    }, 250)
    return () => clearTimeout(timer)
  }, [loading, targetActivityId, targetPhaseId, activePhaseId])

  // Sari direct la o activitate (din panoul "Ce e de făcut"), fără reload.
  // Cu requestId, deschide direct fișa cererii — zero click-uri suplimentare
  // pentru client între "ce am de făcut" și zona de încărcare.
  const jumpToActivity = (phaseId: string | null, activityId: string | null, requestId?: string) => {
    setActiveView('phases')
    setLandingView('browse')
    if (activityId && phaseId) {
      // Document legat de o activitate dintr-o fază
      setActivePhaseId(phaseId)
      setExpandedPhases(new Set([phaseId]))
      setExpandedActivityIds(prev => new Set(prev).add(activityId))
    } else {
      // Cerere generală → secțiunea distinctă
      setActivePhaseId(GENERAL_ID)
      setExpandedPhases(new Set([GENERAL_ID]))
    }
    if (requestId) {
      setAutoOpenRequestId(requestId)
      setTimeout(() => setAutoOpenRequestId(null), 2500)
    }
    setTimeout(() => {
      const anchor = activityId ? `activity-${activityId}` : 'general-requests'
      const el = document.getElementById(anchor)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (activityId) {
        setHighlightActivityId(activityId)
        setTimeout(() => setHighlightActivityId(null), 2500)
      }
    }, 120)
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const phaseNameById = useMemo(
    () => new Map(phases.map(p => [p.id, p.name])),
    [phases]
  )

  // Documente pe care clientul trebuie să le încarce (de la nivel proiect)
  // Pentru client: cereri pe care el trebuie să le încarce (pending/rejected).
  // Pentru consultant/admin: cereri deja încărcate de client, care așteaptă
  // aprobarea lor (review) — asta e munca lor efectivă, nu "ce mai lipsește
  // de la client", care doar informează fără să fie acționabil pentru ei.
  const pendingUploads = useMemo(() => {
    return allDocRequests
      .filter((r: any) => {
        if (r.is_outgoing || r.deleted_at) return false
        return isClient ? (r.status === 'pending' || r.status === 'rejected') : r.status === 'review'
      })
      .map((r: any) => {
        const phaseId = r.activity?.phase_id ?? null
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          deadline_at: r.deadline_at ?? null,
          activity_id: r.activity?.id ?? r.activity_id ?? null,
          activity_name: r.activity?.name ?? null,
          phase_id: phaseId,
          phase_name: phaseId ? phaseNameById.get(phaseId) ?? null : null,
        }
      })
  }, [allDocRequests, phaseNameById, isClient])

  // Alegem vederea implicită o singură dată, după primul load reușit — dacă
  // există un deep-link explicit, îl respectăm; altfel arătăm "Ce ai de făcut"
  // doar dacă chiar are ce conține. Nu recalculăm ulterior, ca să nu forțăm
  // utilizatorul înapoi dacă a comutat manual.
  useEffect(() => {
    if (loading || landingViewInitialized) return
    const hasDeepLink = !!targetPhaseId
    setLandingView(hasDeepLink || pendingUploads.length === 0 ? 'browse' : 'action-needed')
    setLandingViewInitialized(true)
  }, [loading, landingViewInitialized, pendingUploads.length, targetPhaseId])

  const searchIndex = useMemo(() => buildSearchIndex(phases, allDocRequests), [phases, allDocRequests])

  const handleSearchSelect = (result: SearchResult) => {
    if (result.type === 'phase') {
      setActiveView('phases')
      setLandingView('browse')
      setExpandedPhases(new Set([result.id]))
      setTimeout(() => {
        document.getElementById(`phase-${result.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 120)
      return
    }
    if (result.type === 'activity') {
      jumpToActivity(result.phaseId, result.activityId)
      return
    }
    // document_request — deschide și fișa cererii, odată ce faza/activitatea e vizibilă
    jumpToActivity(result.phaseId, result.activityId, result.id)
  }

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
    <div className="project-scope h-screen flex flex-col overflow-hidden bg-[var(--p-bg)] text-[var(--p-ink)] w-screen ml-[calc(50%-50vw)] mr-[calc(50%-50vw)]">

      {/* ── Top bar ── */}
      <header className="bg-[var(--p-surface)] border-b border-[var(--p-border)] sticky top-0 z-20">
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-sm text-[var(--p-ink-soft)] hover:text-[var(--p-ink)] transition-colors flex-shrink-0">
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium hidden sm:block">Proiecte</span>
          </button>
          <span className="text-[var(--p-border-strong)] hidden sm:block">/</span>

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
              <h1 className="font-display text-base font-semibold text-[var(--p-ink)] truncate">{project.title}</h1>
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
              onClick={() => setMobileSidebarOpen(true)}
              title="Faze proiect"
              aria-label="Deschide fazele proiectului"
              className="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-full text-[var(--p-ink-soft)] bg-[var(--p-surface)] border border-[var(--p-border-strong)] hover:bg-[var(--p-surface-2)]"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setSearchOpen(true)}
              title="Caută în proiect"
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[var(--p-ink-soft)] bg-[var(--p-surface)] border border-[var(--p-border-strong)] hover:bg-[var(--p-surface-2)]"
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={handleOpenChat}
              className="relative inline-flex items-center gap-1.5 text-xs font-medium text-[var(--p-ink-soft)] bg-[var(--p-surface)] border border-[var(--p-border-strong)] px-2.5 py-1 rounded-full hover:bg-[var(--p-surface-2)]"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold shadow">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            <span className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--p-ink-soft)] bg-[var(--p-surface-2)] px-2.5 py-1 rounded-full">
              <Building2 className="w-3.5 h-3.5" />
              {project.profiles?.full_name || 'Client'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden w-full">

        {/* ══ SIDEBAR — ascuns în view documente ══ */}
        {activeView === 'phases' && (
          <ProjectPhasesSidebar
            phases={phases}
            activePhaseId={activePhaseId}
            expandedPhases={expandedPhases}
            canEdit={canEdit}
            projectId={projectId!}
            isGeneralActive={activePhaseId === GENERAL_ID}
            onSelectPhase={handleSelectPhase}
            onSelectGeneral={handleSelectGeneral}
            onToggleExpand={handleToggleExpand}
            onRefresh={fetchAll}
            onReorderRefresh={refreshPhases}
            onTeamChange={fetchProjectMembers}
            apiFetch={apiFetch}
            isAdmin={isAdmin}
            getMockStatus={getMockStatus}
            mobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* ══ MAIN ══ */}
        <main className="flex-1 min-h-0 overflow-y-auto min-w-0">

          {/* ── Tab switcher ── */}
          <div className="sticky top-0 z-10 bg-[var(--p-surface)] border-b border-[var(--p-border)] px-4 sm:px-6">
            <div className="flex gap-1 -mb-px">
              <button
                onClick={() => setActiveView('phases')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeView === 'phases'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Layers className="w-4 h-4" />
                Faze & Activități
              </button>
              <button
                onClick={() => setActiveView('documents')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeView === 'documents'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <FolderOpen className="w-4 h-4" />
                Documente
                {documentEntriesCount > 0 && (
                  <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-medium">
                    {documentEntriesCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* ── Content ── */}
          {activeView === 'documents' ? (
            <ProjectDocumentsView
              projectId={projectId!}
              requests={allDocRequests}
              phases={phases}
            />
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 sm:px-6 pt-4">
                <button
                  onClick={() => setLandingView('action-needed')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    landingView === 'action-needed'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Ce ai de făcut
                  {pendingUploads.length > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      landingView === 'action-needed' ? 'bg-white/20' : 'bg-white'
                    }`}>
                      {pendingUploads.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setLandingView('browse')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    landingView === 'browse'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Fazele proiectului
                </button>
              </div>

              {landingView === 'action-needed' ? (
                <ActionNeededPanel items={pendingUploads} isClient={isClient} onJump={jumpToActivity} />
              ) : phases.length === 0 ? (
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
            <div className="p-4 sm:p-8 space-y-5 max-w-5xl mx-auto">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Faze &amp; Activități</h2>
                <button
                  onClick={handleToggleAllPhases}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex-shrink-0"
                >
                  {allPhasesExpanded ? 'Restrânge toate fazele' : 'Extinde toate fazele'}
                </button>
              </div>

              {phases.filter(phase => expandedPhases.has(phase.id)).map(phase => (
                <PhaseAccordionSection
                  key={phase.id}
                  id={phase.id}
                  title={phase.name}
                  subtitle={`${phase.activities?.length ?? 0} activit${phase.activities?.length === 1 ? 'ate' : 'ăți'}`}
                  color={phase.project_status?.color}
                  headerRight={
                    <PublishStatusControl
                      status={getMockStatus(phase.id)}
                      canPublish={canEdit}
                      onToggle={() => toggleMockStatus(phase.id)}
                    />
                  }
                  open={expandedPhases.has(phase.id)}
                  onOpenChange={() => handleToggleExpand(phase.id)}
                >
                  {(phase.activities?.length ?? 0) === 0 && !canEdit ? (
                    <p className="text-sm text-[var(--p-ink-faint)]">Nicio activitate în această fază.</p>
                  ) : (
                    <>
                    {phase.activities?.map(activity => (
                      <ActivityFold
                        key={activity.id}
                        activity={activity}
                        requestCount={allDocRequests.filter((r: any) => !r.is_outgoing && r.activity_id === activity.id).length}
                        open={expandedActivityIds.has(activity.id)}
                        onOpenChange={() => handleToggleActivity(activity.id)}
                        highlighted={highlightActivityId === activity.id}
                        isAdmin={isAdmin}
                        projectMembers={projectMembers}
                        onAssign={assignedTo => handleAssignActivity(phase.id, activity.id, assignedTo)}
                        mockStatus={getMockStatus(activity.id)}
                        canPublish={canEdit}
                        onTogglePublish={() => toggleMockStatus(activity.id)}
                      >
                        <DocumentRequests
                          projectId={projectId!}
                          activityId={activity.id}
                          activityName={activity.name}
                          externalRequests={allDocRequests}
                          onRefresh={refreshDocs}
                          activityAssignedTo={activity.assigned_to ?? null}
                          activityAssignedUser={activity.assigned_user ?? null}
                          projectMembers={projectMembers}
                          onAssignActivity={isAdmin ? (assignedTo: string | null) => handleAssignActivity(phase.id, activity.id, assignedTo) : undefined}
                          clientEmail={project?.profiles?.email ?? null}
                          clientName={project?.profiles?.full_name ?? null}
                          projectTitle={project?.title}
                          autoOpenRequestId={autoOpenRequestId}
                          getMockStatus={getMockStatus}
                          toggleMockStatus={toggleMockStatus}
                        />
                      </ActivityFold>
                    ))}
                    {canEdit && (
                      showAddActivity[phase.id] ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={newActivityName[phase.id] || ''}
                            onChange={e => setNewActivityName(prev => ({ ...prev, [phase.id]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleAddActivity(phase.id)
                              if (e.key === 'Escape') setShowAddActivity(prev => ({ ...prev, [phase.id]: false }))
                            }}
                            placeholder="Nume activitate..."
                            disabled={!!addingActivity[phase.id]}
                            className="flex-1 text-sm px-3 py-2 rounded-lg border border-[var(--p-border-strong)] bg-[var(--p-surface)] text-[var(--p-ink)] outline-none focus:ring-2 focus:ring-[var(--p-accent)]/20 focus:border-[var(--p-accent)]"
                          />
                          <button
                            onClick={() => handleAddActivity(phase.id)}
                            disabled={!!addingActivity[phase.id] || !(newActivityName[phase.id] || '').trim()}
                            className="p-2 rounded-lg bg-[var(--p-success-soft)] text-[var(--p-success)] hover:opacity-80 disabled:opacity-40 flex-shrink-0"
                          >
                            {addingActivity[phase.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: false }))}
                            className="p-2 rounded-lg bg-[var(--p-surface-2)] text-[var(--p-ink-soft)] hover:opacity-80 flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: true }))}
                          className="flex items-center gap-1.5 text-sm font-medium text-[var(--p-accent)] hover:opacity-80 transition-opacity"
                        >
                          <Plus className="w-4 h-4" />
                          Adaugă activitate
                        </button>
                      )
                    )}
                    </>
                  )}
                </PhaseAccordionSection>
              ))}

              {/* ── Secțiune distinctă: Cereri generale (fără fază/activitate) ── */}
              {expandedPhases.has(GENERAL_ID) && (
                <PhaseAccordionSection
                  id={GENERAL_ID}
                  title="Cereri generale"
                  subtitle="Documente care nu țin de o anumită fază a proiectului."
                  icon={<FolderOpen className="w-4 h-4 text-indigo-500 flex-shrink-0" />}
                  open={expandedPhases.has(GENERAL_ID)}
                  onOpenChange={() => handleToggleExpand(GENERAL_ID)}
                >
                  <div id="general-requests" className="scroll-mt-24">
                    <DocumentRequests
                      key="__general__"
                      projectId={projectId!}
                      activityId={null}
                      activityName="Cereri generale"
                      externalRequests={allDocRequests}
                      onRefresh={refreshDocs}
                      activityAssignedTo={project?.general_consultant_id ?? null}
                      activityAssignedUser={project?.general_consultant ?? null}
                      projectMembers={projectMembers}
                      onAssignActivity={isAdmin ? (assignedTo: string | null) => handleAssignGeneralConsultant(assignedTo) : undefined}
                      clientEmail={project?.profiles?.email ?? null}
                      clientName={project?.profiles?.full_name ?? null}
                      projectTitle={project?.title}
                      autoOpenRequestId={autoOpenRequestId}
                      getMockStatus={getMockStatus}
                      toggleMockStatus={toggleMockStatus}
                    />
                  </div>
                </PhaseAccordionSection>
              )}
            </div>
          )}
            </>
          )}
        </main>
      </div>

      {projectId && (
        <ProjectChatDrawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          title="Chat proiect"
          projectId={projectId}
          onUnreadCountChange={setUnreadCount}
        />
      )}

      <UnifiedSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        index={searchIndex}
        onSelect={handleSearchSelect}
      />

    </div>
  )
}

export default function ProjectDetailsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-slate-50">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      }
    >
      <ProjectDetailsContent />
    </Suspense>
  )
}
