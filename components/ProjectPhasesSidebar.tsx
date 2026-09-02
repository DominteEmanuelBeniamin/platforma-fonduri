'use client'

import { useEffect, useState } from 'react'
import * as Collapsible from '@radix-ui/react-collapsible'
import {
  ChevronDown,
  ChevronRight,
  Layers,
  FolderOpen,
  GripVertical,
  Plus,
  Loader2,
  X,
  Check,
  Trash2,
  Calendar,
} from 'lucide-react'

import TeamManager from '@/components/TeamManager'
import InlineDateEditor from '@/components/InlineDateEditor'
import { useToast } from '@/app/providers/ToastProvider'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectActivity {
  id: string
  name: string
  status: string
  order_index: number
  visibility?: 'draft' | 'published'
  client_notified_at?: string | null
  deadline_at?: string | null
  assigned_to?: string | null
  assigned_user?: { id: string; full_name: string | null; email: string } | null
}

export interface ProjectPhase {
  id: string
  name: string
  status: string
  order_index: number
  visibility?: 'draft' | 'published'
  client_notified_at?: string | null
  project_status_id: string
  project_status?: { id: string; name: string; color: string }
  activities?: ProjectActivity[]
}

interface DocumentRequestPreview {
  activity_id?: string | null
  deleted_at?: string | null
  visibility?: 'draft' | 'published'
}

// ─── Inline input ─────────────────────────────────────────────────────────────

function InlineInput({
  placeholder,
  onConfirm,
  onCancel,
  loading,
}: {
  placeholder: string
  onConfirm: (value: string) => void
  onCancel: () => void
  loading: boolean
}) {
  const [value, setValue] = useState('')

  return (
    <div className="flex items-center gap-1 mt-1">
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        disabled={loading}
        className="flex-1 text-xs px-2 py-1.5 border border-[var(--p-accent)]/40 rounded-md focus:outline-none focus:ring-1 focus:ring-[var(--p-accent)] bg-[var(--p-surface)] text-[var(--p-ink)] placeholder:text-[var(--p-ink-faint)]"
      />
      <button
        onClick={() => value.trim() && onConfirm(value.trim())}
        disabled={loading || !value.trim()}
        className="p-1 rounded bg-[var(--p-success-soft)] text-[var(--p-success)] hover:opacity-80 disabled:opacity-40"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
      </button>
      <button
        onClick={onCancel}
        className="p-1 rounded bg-[var(--p-surface-2)] text-[var(--p-ink-soft)] hover:opacity-80"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectPhasesSidebarProps {
  phases: ProjectPhase[]
  activePhaseId: string | null
  expandedPhases: Set<string>
  canEdit: boolean
  isAdmin: boolean
  projectId: string
  documentRequests: DocumentRequestPreview[]
  isGeneralActive: boolean
  onSelectPhase: (phaseId: string) => void
  onSelectGeneral: () => void
  onToggleExpand: (phaseId: string) => void
  onRefresh: () => Promise<void> | void
  onReorderRefresh?: () => Promise<void> | void
  onTeamChange?: () => void
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>
  /** Pe mobil, sidebar-ul devine un drawer — controlat din pagina părinte. */
  mobileOpen: boolean
  onMobileClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectPhasesSidebar({
  phases,
  activePhaseId,
  expandedPhases,
  canEdit,
  isAdmin,
  projectId,
  documentRequests,
  isGeneralActive,
  onSelectPhase,
  onSelectGeneral,
  onToggleExpand,
  onRefresh,
  onReorderRefresh,
  onTeamChange,
  apiFetch,
  mobileOpen,
  onMobileClose,
}: ProjectPhasesSidebarProps) {
  const { showToast, confirm } = useToast()
  const [showAddPhase, setShowAddPhase] = useState(false)
  const [addingPhase, setAddingPhase] = useState(false)
  const [showAddActivity, setShowAddActivity] = useState<Record<string, boolean>>({})
  const [addingActivity, setAddingActivity] = useState<Record<string, boolean>>({})

  const [deletingPhase, setDeletingPhase] = useState<string | null>(null)
  const [deletingActivity, setDeletingActivity] = useState<string | null>(null)

  // deadline edit state: activityId → true/false (popup deschis)
  const [editingDeadline, setEditingDeadline] = useState<string | null>(null)
  const [savingDeadline, setSavingDeadline] = useState<string | null>(null)

  // Drawer pe mobil: Escape + blocare scroll pe fundal cât timp e deschis
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose()
    }
    window.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [mobileOpen, onMobileClose])

  // drag & drop reorder state — override temporar peste ordinea din props până la refresh
  const [draggedPhaseId, setDraggedPhaseId] = useState<string | null>(null)
  const [phaseOrder, setPhaseOrder] = useState<string[] | null>(null)
  const [draggedActivity, setDraggedActivity] = useState<{ phaseId: string; actId: string } | null>(null)
  const [activityOrder, setActivityOrder] = useState<string[] | null>(null)

  const displayPhases = phaseOrder
    ? phaseOrder
        .map(id => phases.find(p => p.id === id))
        .filter((p): p is ProjectPhase => !!p)
    : phases

  const displayActivities = (phase: ProjectPhase) =>
    draggedActivity?.phaseId === phase.id && activityOrder
      ? activityOrder
          .map(id => phase.activities?.find(a => a.id === id))
          .filter((a): a is ProjectActivity => !!a)
      : phase.activities

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleAddPhase = async (name: string) => {
    setAddingPhase(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) { setShowAddPhase(false); onRefresh() }
      else { showToast('Nu am putut salva faza. Reîncearcă.', 'error') }
    } finally { setAddingPhase(false) }
  }

  const handleAddActivity = async (phaseId: string, name: string) => {
    setAddingActivity(prev => ({ ...prev, [phaseId]: true }))
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phaseId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) { setShowAddActivity(prev => ({ ...prev, [phaseId]: false })); onRefresh() }
      else { showToast('Nu am putut salva activitatea. Reîncearcă.', 'error') }
    } finally { setAddingActivity(prev => ({ ...prev, [phaseId]: false })) }
  }

  const requestWarning = (moved: number, demoted: number) => {
    const parts: string[] = []
    if (moved > 0) {
      parts.push(moved === 1
        ? 'Cererea de documente asociată va fi mutată la „Cereri generale”, împreună cu fișierele sale.'
        : `Cele ${moved} cereri de documente asociate vor fi mutate la „Cereri generale”, împreună cu fișierele lor.`)
    }
    if (demoted > 0) {
      parts.push(demoted === 1
        ? 'Dintre acestea, o cerere marcată ca publicată va reveni la starea „În pregătire” și va rămâne invizibilă clientului.'
        : `Dintre acestea, ${demoted} cereri marcate ca publicate vor reveni la starea „În pregătire” și vor rămâne invizibile clientului.`)
    }
    return parts.join(' ')
  }
  const deletionImpactForActivity = (phase: ProjectPhase, activity: ProjectActivity) => {
    const requests = documentRequests.filter(request => request.activity_id === activity.id && !request.deleted_at)
    return {
      moved: requests.length,
      demoted: requests.filter(request =>
        request.visibility === 'published'
        && (phase.visibility !== 'published' || activity.visibility !== 'published')
      ).length,
    }
  }
  const deletionImpactForPhase = (phase: ProjectPhase) => {
    const activityVisibility = new Map((phase.activities ?? []).map(activity => [activity.id, activity.visibility]))
    const requests = documentRequests.filter(request =>
      request.activity_id && activityVisibility.has(request.activity_id) && !request.deleted_at
    )
    return {
      moved: requests.length,
      demoted: requests.filter(request =>
        request.visibility === 'published'
        && (phase.visibility !== 'published' || activityVisibility.get(request.activity_id!) !== 'published')
      ).length,
    }
  }

  const handleDeletePhase = async (phaseId: string) => {
    setDeletingPhase(phaseId)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phaseId}`, {
        method: 'DELETE',
      })
      if (res.ok) await onRefresh()
      else { showToast('Nu am putut șterge faza. Reîncearcă.', 'error') }
    } finally { setDeletingPhase(null) }
  }

  const handleDeleteActivity = async (phaseId: string, activityId: string) => {
    setDeletingActivity(activityId)
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}`,
        { method: 'DELETE' }
      )
      if (res.ok) await onRefresh()
      else { showToast('Nu am putut șterge activitatea. Reîncearcă.', 'error') }
    } finally { setDeletingActivity(null) }
  }

  const askToDeletePhase = async (phase: ProjectPhase) => {
    if (deletingPhase === phase.id) return
    const impact = deletionImpactForPhase(phase)
    const activityCount = phase.activities?.length ?? 0
    const activityLabel = activityCount === 1
      ? 'activitatea asociată'
      : `cele ${activityCount} activități asociate`
    const deletionDescription = activityCount === 0
      ? `Faza „${phase.name}” va fi ștearsă definitiv.`
      : `Faza „${phase.name}” și ${activityLabel} vor fi șterse definitiv.`
    const confirmed = await confirm({
      title: `Ștergi faza „${phase.name}”?`,
      description: [deletionDescription, requestWarning(impact.moved, impact.demoted)].filter(Boolean).join(' '),
      confirmText: 'Șterge faza',
    })
    if (confirmed) await handleDeletePhase(phase.id)
  }

  const askToDeleteActivity = async (phase: ProjectPhase, activity: ProjectActivity) => {
    if (deletingActivity === activity.id) return
    const impact = deletionImpactForActivity(phase, activity)
    const description = [
      `Activitatea „${activity.name}” va fi ștearsă definitiv.`,
      requestWarning(impact.moved, impact.demoted),
    ].filter(Boolean).join(' ')
    const confirmed = await confirm({
      title: `Ștergi activitatea „${activity.name}”?`,
      description,
      confirmText: 'Șterge activitatea',
    })
    if (confirmed) await handleDeleteActivity(phase.id, activity.id)
  }

  const handleSaveDeadline = async (phaseId: string, activityId: string, dateValue: string) => {
    setSavingDeadline(activityId)
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deadline_at: dateValue || null }),
        }
      )
      if (res.ok) { setEditingDeadline(null); onRefresh() }
      else { showToast('Nu am putut salva modificarea. Reîncearcă.', 'error') }
    } catch {
      showToast('Nu am putut salva modificarea. Reîncearcă.', 'error')
    } finally { setSavingDeadline(null) }
  }

  // ─── Drag & drop reorder ────────────────────────────────────────────────────

  const handlePhaseDragStart = (e: React.DragEvent, phaseId: string) => {
    setDraggedPhaseId(phaseId)
    setPhaseOrder(phases.map(p => p.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handlePhaseDragOver = (e: React.DragEvent, targetId: string) => {
    if (!draggedPhaseId || !phaseOrder) return
    e.preventDefault()
    if (draggedPhaseId === targetId) return
    const from = phaseOrder.indexOf(draggedPhaseId)
    const to = phaseOrder.indexOf(targetId)
    if (from === -1 || to === -1 || from === to) return
    const next = [...phaseOrder]
    next.splice(from, 1)
    next.splice(to, 0, draggedPhaseId)
    setPhaseOrder(next)
  }

  const handlePhaseDragEnd = async () => {
    const order = phaseOrder
    setDraggedPhaseId(null)
    if (!order) return
    const unchanged = order.length === phases.length && phases.every((p, i) => p.id === order[i])
    if (unchanged) { setPhaseOrder(null); return }
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: order.map((id, i) => ({ id, order_index: i + 1 })) }),
      })
      if (res.ok) await onReorderRefresh?.()
      else { showToast('Nu am putut salva ordinea. Reîncearcă.', 'error') }
    } finally { setPhaseOrder(null) }
  }

  const handleActivityDragStart = (e: React.DragEvent, phase: ProjectPhase, actId: string) => {
    setDraggedActivity({ phaseId: phase.id, actId })
    setActivityOrder((phase.activities || []).map(a => a.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleActivityDragOver = (e: React.DragEvent, phaseId: string, targetActId: string) => {
    // fără mutare între faze — doar în cadrul fazei de origine
    if (!draggedActivity || draggedActivity.phaseId !== phaseId || !activityOrder) return
    e.preventDefault()
    if (draggedActivity.actId === targetActId) return
    const from = activityOrder.indexOf(draggedActivity.actId)
    const to = activityOrder.indexOf(targetActId)
    if (from === -1 || to === -1 || from === to) return
    const next = [...activityOrder]
    next.splice(from, 1)
    next.splice(to, 0, draggedActivity.actId)
    setActivityOrder(next)
  }

  const handleActivityDragEnd = async () => {
    const drag = draggedActivity
    const order = activityOrder
    setDraggedActivity(null)
    if (!drag || !order) { setActivityOrder(null); return }
    const original = (phases.find(p => p.id === drag.phaseId)?.activities || []).map(a => a.id)
    const unchanged = order.length === original.length && original.every((id, i) => id === order[i])
    if (unchanged) { setActivityOrder(null); return }
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${drag.phaseId}/activities/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: order.map((id, i) => ({ id, order_index: i + 1 })) }),
      })
      if (res.ok) await onReorderRefresh?.()
      else { showToast('Nu am putut salva ordinea. Reîncearcă.', 'error') }
    } finally { setActivityOrder(null) }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop — doar pe mobil, cât timp drawer-ul e deschis */}
      {mobileOpen && (
        <div
          onClick={onMobileClose}
          className="md:hidden fixed inset-0 bg-slate-900/50 z-[999998]"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-[999999] w-80 max-w-[85vw] shadow-2xl
        md:sticky md:top-14 md:inset-auto md:self-start md:z-auto md:w-64 lg:w-72 md:shadow-none md:translate-x-0
        flex flex-col flex-shrink-0 min-h-0 bg-[var(--p-surface)] md:border-r border-[var(--p-border)]
        transition-transform duration-300 ease-out overflow-hidden md:overflow-visible
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >

      {/* Header */}
      <div className="h-12 px-4 border-b border-[var(--p-border)] flex-shrink-0 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[var(--p-ink-faint)] uppercase tracking-wider flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" /> Faze proiect
        </p>
        <button
          onClick={onMobileClose}
          aria-label="Închide"
          className="md:hidden p-1 rounded text-[var(--p-ink-faint)] hover:text-[var(--p-ink)] hover:bg-[var(--p-surface-2)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Phases list */}
      <nav className="flex-1 min-h-0 p-2 space-y-0.5 overflow-y-auto md:flex-none md:overflow-visible">
        {phases.length === 0 && !showAddPhase && (
          <div className="p-6 text-center">
            <FolderOpen className="w-8 h-8 text-[var(--p-ink-faint)] mx-auto mb-2" />
            <p className="text-xs text-[var(--p-ink-faint)]">Nicio fază adăugată</p>
          </div>
        )}

        {displayPhases.map(phase => {
          const isActive = phase.id === activePhaseId
          const isExpanded = expandedPhases.has(phase.id)

          return (
            <div key={phase.id}>
              <Collapsible.Root open={isExpanded} onOpenChange={() => onToggleExpand(phase.id)}>
                <div
                    onClick={() => onSelectPhase(phase.id)}
                    onDragOver={e => handlePhaseDragOver(e, phase.id)}
                    className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                      isActive ? 'bg-[var(--p-accent-soft)]' : 'hover:bg-[var(--p-surface-2)]'
                    } ${draggedPhaseId === phase.id ? 'opacity-50' : ''}`}
                  >
                    {canEdit && (
                      <span
                        draggable
                        onDragStart={e => handlePhaseDragStart(e, phase.id)}
                        onDragEnd={handlePhaseDragEnd}
                        onClick={e => e.stopPropagation()}
                        title="Trage pentru a reordona"
                        className="-ml-1.5 p-0.5 rounded text-[var(--p-ink-faint)] hover:text-[var(--p-ink-soft)] opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing flex-shrink-0"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                    )}
                    <span
                      title={canEdit ? (phase.visibility === 'published' ? 'Public — vizibil pentru client' : 'În pregătire — invizibil pentru client') : undefined}
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: phase.visibility === 'published' ? 'var(--p-success)' : 'var(--p-warning)' }}
                    />
                    <span className={`flex-1 text-sm font-medium truncate ${isActive ? 'text-[var(--p-accent-ink)]' : 'text-[var(--p-ink)]'}`}>
                      {phase.name}
                    </span>
                    <Collapsible.Trigger asChild>
                      <button
                        onClick={e => e.stopPropagation()}
                        aria-label={isExpanded ? 'Restrânge faza' : 'Extinde faza'}
                        className="p-0.5 rounded hover:bg-[var(--p-surface-2)] flex-shrink-0"
                      >
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 text-[var(--p-ink-faint)]" />
                          : <ChevronRight className="w-3.5 h-3.5 text-[var(--p-ink-faint)]" />
                        }
                      </button>
                    </Collapsible.Trigger>
                    {isAdmin && (
                      <button
                        onClick={e => { e.stopPropagation(); void askToDeletePhase(phase) }}
                        disabled={deletingPhase === phase.id}
                        aria-label={`Șterge faza ${phase.name}`}
                        className="p-1 rounded text-[var(--p-ink-faint)] hover:text-[var(--p-danger)] hover:bg-[var(--p-danger-soft)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 disabled:opacity-60"
                      >
                        {deletingPhase === phase.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                </div>

              {/* Activities sub-list */}
              <Collapsible.Content>
                <div className="ml-5 mt-0.5 mb-1 pl-3 border-l-2 border-[var(--p-border)] space-y-0.5">
                  {displayActivities(phase)?.map(act => {
                    const isEditingThisDeadline = editingDeadline === act.id
                    const currentDeadline = act.deadline_at
                      ? act.deadline_at.slice(0, 10)
                      : ''
                    const deadlineLabel = act.deadline_at
                      ? new Date(act.deadline_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })
                      : null
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)
                    const deadlineDate = act.deadline_at ? new Date(act.deadline_at) : null
                    deadlineDate?.setHours(0, 0, 0, 0)
                    const isOverdue = deadlineDate && deadlineDate < today

                    return (
                      <div
                        key={act.id}
                        onDragOver={e => handleActivityDragOver(e, phase.id, act.id)}
                        className={`group/act flex flex-col gap-0.5 py-1.5 px-2 rounded-md hover:bg-[var(--p-surface-2)] ${
                          draggedActivity?.actId === act.id ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {canEdit && (
                            <span
                              draggable
                              onDragStart={e => handleActivityDragStart(e, phase, act.id)}
                              onDragEnd={handleActivityDragEnd}
                              onClick={e => e.stopPropagation()}
                              title="Trage pentru a reordona"
                              className="-ml-1 p-0.5 rounded text-[var(--p-ink-faint)] hover:text-[var(--p-ink-soft)] opacity-0 group-hover/act:opacity-100 transition-opacity cursor-grab active:cursor-grabbing flex-shrink-0"
                            >
                              <GripVertical className="w-3 h-3" />
                            </span>
                          )}
                          <span className="text-xs text-[var(--p-ink-soft)] truncate flex-1">{act.name}</span>

                          {/* Buton calendar — pentru admin/consultant */}
                          {canEdit && (
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                setEditingDeadline(isEditingThisDeadline ? null : act.id)
                              }}
                              title={act.deadline_at ? 'Modifică termen limită' : 'Setează termen limită'}
                              className={`p-0.5 rounded transition-all flex-shrink-0 ${
                                act.deadline_at
                                  ? isOverdue
                                    ? 'text-[var(--p-danger)] hover:opacity-80'
                                    : 'text-[var(--p-warning)] hover:opacity-80'
                                  : 'text-[var(--p-ink-faint)] hover:text-[var(--p-accent)] opacity-0 group-hover/act:opacity-100'
                              }`}
                            >
                              <Calendar className="w-3 h-3" />
                            </button>
                          )}

                          {isAdmin && (
                            <button
                              onClick={e => { e.stopPropagation(); void askToDeleteActivity(phase, act) }}
                              disabled={deletingActivity === act.id}
                              aria-label={`Șterge activitatea ${act.name}`}
                              className="p-0.5 rounded text-[var(--p-ink-faint)] hover:text-[var(--p-danger)] hover:bg-[var(--p-danger-soft)] opacity-0 group-hover/act:opacity-100 transition-opacity flex-shrink-0 disabled:opacity-60"
                            >
                              {deletingActivity === act.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Trash2 className="w-3 h-3" />}
                            </button>
                          )}
                        </div>

                        {/* Deadline label — afișat când există */}
                        {deadlineLabel && !isEditingThisDeadline && (
                          <span
                            className={`text-[10px] font-medium ml-0 ${
                              isOverdue ? 'text-[var(--p-danger)]' : 'text-[var(--p-warning)]'
                            }`}
                          >
                            {isOverdue ? '⚠ ' : ''}{deadlineLabel}
                          </span>
                        )}

                        {/* Date picker inline */}
                        {isEditingThisDeadline && canEdit && (
                          <div className="mt-0.5">
                            <InlineDateEditor
                              size="sm"
                              value={currentDeadline}
                              // O activitate publicată nu poate rămâne fără
                              // termen (#70); serverul respinge oricum.
                              allowClear={act.visibility !== 'published'}
                              saving={savingDeadline === act.id}
                              onSave={value => handleSaveDeadline(phase.id, act.id, value)}
                              onCancel={() => setEditingDeadline(null)}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Add activity */}
                  {canEdit && (
                    showAddActivity[phase.id] ? (
                      <div className="px-2">
                        <InlineInput
                          placeholder="Nume activitate..."
                          onConfirm={name => handleAddActivity(phase.id, name)}
                          onCancel={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: false }))}
                          loading={!!addingActivity[phase.id]}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: true }))}
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] text-[var(--p-ink-faint)] hover:text-[var(--p-accent)] hover:bg-[var(--p-accent-soft)] rounded-md transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Adaugă activitate
                      </button>
                    )
                  )}
                </div>
              </Collapsible.Content>
              </Collapsible.Root>
            </div>
          )
        })}

        {/* Add phase */}
        {canEdit && (
          <div className="pt-1">
            {showAddPhase ? (
              <div className="px-2">
                <InlineInput
                  placeholder="Nume fază..."
                  onConfirm={handleAddPhase}
                  onCancel={() => setShowAddPhase(false)}
                  loading={addingPhase}
                />
              </div>
            ) : (
              <button
                onClick={() => setShowAddPhase(true)}
                className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-[var(--p-ink-faint)] hover:text-[var(--p-accent)] hover:bg-[var(--p-accent-soft)] rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Adaugă fază
              </button>
            )}
          </div>
        )}

        {/* Cereri generale — secțiune distinctă, separată de faze */}
        <div className="pt-2 mt-2 border-t border-[var(--p-border)]">
          <div
            onClick={onSelectGeneral}
            className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
              isGeneralActive ? 'bg-[var(--p-accent-soft)]' : 'hover:bg-[var(--p-surface-2)]'
            }`}
          >
            <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isGeneralActive ? 'text-[var(--p-accent)]' : 'text-[var(--p-ink-faint)]'}`} />
            <span className={`flex-1 text-sm font-medium truncate ${isGeneralActive ? 'text-[var(--p-accent-ink)]' : 'text-[var(--p-ink)]'}`}>
              Cereri generale
            </span>
          </div>
        </div>
      </nav>

      {/* Team manager */}
      {isAdmin && (
        <div className="flex-shrink-0 border-t border-[var(--p-border)]">
          <TeamManager projectId={projectId} onTeamChange={onTeamChange} />
        </div>
      )}
      </aside>
    </>
  )
}
