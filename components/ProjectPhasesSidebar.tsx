'use client'

import { useEffect, useState } from 'react'
import * as Collapsible from '@radix-ui/react-collapsible'
import { bandFor, bandVar, TONE } from '@/lib/signage'
import { ToneIcon } from '@/components/ui/ToneIcon'
import { countLabel } from '@/lib/count-label'
import {
  ChevronRight,
  Layers,
  FolderOpen,
  GripVertical,
  Plus,
  X,
  Trash2,
  Calendar,
  Copy,
  Pencil,
  Check,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

import InlineDateEditor from '@/components/InlineDateEditor'
import InlineInput from '@/components/InlineInput'
import RowActionsMenu from '@/components/RowActionsMenu'
import { useToast } from '@/app/providers/ToastProvider'
import { serverMessage } from '@/lib/api-error'
import { activityDuplicatedMessage, phaseDuplicatedMessage } from '@/lib/duplication-summary'
import {
  activityDeletionConfirm,
  activityDeletionImpact,
  phaseDeletionConfirm,
  phaseDeletionImpact,
} from '@/lib/deletion-impact'
import type { ProjectPermissions } from '@/lib/project-permissions'
import { isActivityFinal, isPhaseFinal } from '@/lib/completion'

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
  assigned_user?: { id: string; full_name: string | null; email: string; is_active?: boolean | null } | null
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectPhasesSidebarProps {
  phases: ProjectPhase[]
  activePhaseId: string | null
  expandedPhases: Set<string>
  canEdit: boolean
  /** Proiectul e încheiat: se vede ca pentru echipă, dar nu se mai modifică (8 octombrie 2026). */
  readOnly?: boolean
  permissions: ProjectPermissions
  projectId: string
  documentRequests: DocumentRequestPreview[]
  isGeneralActive: boolean
  onSelectPhase: (phaseId: string) => void
  /** Clic pe o activitate: pagina sare la ea și o evidențiază. */
  onSelectActivity?: (phaseId: string, activityId: string) => void
  onSelectGeneral: () => void
  /** Ce arde în fiecare fază (cheia e id-ul fazei sau `generalId`): termen depășit sau respins, de verificat. */
  phaseSignals?: Map<string, { danger: number; review: number }>
  /** Cheia rândului „Cereri generale” în `phaseSignals`. */
  generalId?: string
  onToggleExpand: (phaseId: string) => void
  onRefresh: () => Promise<void> | void
  onReorderRefresh?: () => Promise<void> | void
  /** Faze + cereri, fără spinner — după duplicare, unde apar și cereri noi. */
  onDuplicateRefresh?: () => Promise<void> | void
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>
  /** Pe mobil, sidebar-ul devine un drawer — controlat din pagina părinte. */
  mobileOpen: boolean
  onMobileClose: () => void
  /**
   * Pe calculator panoul se poate strânge într-o fâșie îngustă, ca în monday:
   * tabelul proiectului are nevoie de lățime, iar numele fazelor sunt deja
   * titlurile grupurilor lui. Pe telefon nu contează — acolo e sertar.
   */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** „Toate fazele”: tabelul revine la tot proiectul după ce s-a ales o fază. */
  onShowAll?: () => void
  /** Tabelul arată acum toate fazele — „Toate fazele” e alegerea curentă. */
  showingAll?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Starea fazei în panoul de faze: semnul și numărul, în culoarea semnalului.
 * Culoarea fazei rămâne pe pastila ei; aici se vede doar ce arde. Cuvântul e în
 * tooltip și pentru cititoare, ca rândul să rămână scurt.
 */
function PhaseSignals({ signal }: { signal?: { danger: number; review: number } }) {
  if (!signal) return null
  const items = [
    signal.danger > 0 && { tone: 'danger' as const, n: signal.danger, label: countLabel(signal.danger, 'cerere cu termen depășit sau respinsă', 'cereri cu termen depășit sau respinse') },
    signal.review > 0 && { tone: 'review' as const, n: signal.review, label: countLabel(signal.review, 'document de verificat', 'documente de verificat') },
  ].filter(Boolean) as { tone: 'danger' | 'review'; n: number; label: string }[]
  return (
    <span className="flex shrink-0 items-center gap-1">
      {items.map(item => (
        <span
          key={item.tone}
          title={item.label}
          className="inline-flex h-5 items-center gap-0.5 rounded-[var(--radius-plate)] px-1 text-[11px] font-semibold tabular-nums"
          style={{ color: TONE[item.tone].fg, background: TONE[item.tone].bg }}
        >
          <ToneIcon tone={item.tone} className="h-3 w-3" />
          <span aria-hidden="true">{item.n}</span>
          <span className="sr-only">{item.label}</span>
        </span>
      ))}
    </span>
  )
}

export default function ProjectPhasesSidebar({
  phases,
  activePhaseId,
  expandedPhases,
  canEdit,
  readOnly = false,
  permissions,
  projectId,
  documentRequests,
  isGeneralActive,
  onSelectPhase,
  onSelectActivity,
  onSelectGeneral,
  phaseSignals,
  generalId,
  onToggleExpand,
  onRefresh,
  onReorderRefresh,
  onDuplicateRefresh,
  apiFetch,
  mobileOpen,
  onMobileClose,
  collapsed = false,
  onCollapsedChange,
  onShowAll,
  showingAll = false,
}: ProjectPhasesSidebarProps) {
  // `canEdit` ține de ce vede echipa (ciorne, benzi); `canChange`, de ce poate modifica.
  const canChange = canEdit && !readOnly
  const { showToast, confirm } = useToast()
  const [showAddPhase, setShowAddPhase] = useState(false)
  const [addingPhase, setAddingPhase] = useState(false)
  const [showAddActivity, setShowAddActivity] = useState<Record<string, boolean>>({})
  const [addingActivity, setAddingActivity] = useState<Record<string, boolean>>({})

  const [deletingPhase, setDeletingPhase] = useState<string | null>(null)
  const [deletingActivity, setDeletingActivity] = useState<string | null>(null)

  const [duplicatingPhase, setDuplicatingPhase] = useState<string | null>(null)
  const [duplicatingActivity, setDuplicatingActivity] = useState<string | null>(null)

  // redenumire inline: id-ul elementului editat (fazele și activitățile au
  // id-uri distincte, deci o singură stare ajunge pentru amândouă)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [savingRename, setSavingRename] = useState<string | null>(null)
  // O fază aleasă altundeva (tabel, căutare, link) închide redenumirea începută
  // aici (S-11). Ajustat la randare, nu într-un efect, ca să nu clipească.
  const [seenActivePhaseId, setSeenActivePhaseId] = useState(activePhaseId)
  if (seenActivePhaseId !== activePhaseId) {
    setSeenActivePhaseId(activePhaseId)
    setRenamingId(null)
  }
  const select = (go: () => void) => { setRenamingId(null); go() }

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

  // `onRefresh` (fetchAll) readuce pagina la spinner și remontează sidebar-ul
  // (app/projects/[id]/page.tsx:787), ceea ce ar închide pe loc câmpul de
  // redenumire. Reordonarea folosește deja refresh-ul de faze, fără spinner.
  const softRefresh = () => (onReorderRefresh ?? onRefresh)()

  // Copia vine cu cereri de documente noi, iar `softRefresh` aduce doar fazele:
  // fără cereri, panoul central ar arăta „0 cereri” pe copie până la reload, iar
  // dialogul ei de ștergere ar tăcea despre cererile pe care le mută.
  const duplicateRefresh = () => (onDuplicateRefresh ?? softRefresh)()

  const handleRename = async (url: string, id: string, name: string) => {
    setSavingRename(id)
    try {
      const res = await apiFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) { setRenamingId(null); await softRefresh() }
      else { showToast('Nu am putut salva numele. Reîncearcă.', 'error') }
    } catch {
      showToast('Nu am putut salva numele. Reîncearcă.', 'error')
    } finally { setSavingRename(null) }
  }

  const handleRenamePhase = (phaseId: string, name: string) =>
    handleRename(`/api/projects/${projectId}/phases/${phaseId}`, phaseId, name)

  const handleRenameActivity = (phaseId: string, activityId: string, name: string) =>
    handleRename(`/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}`, activityId, name)

  // Duplicare (#15): copia preia structura și cererile de documente, dar nu și
  // fișierele încărcate de client, și rămâne „în pregătire” până o publici.
  // După copiere numele intră direct în editare, ca redenumirea să fie primul
  // lucru posibil — iar focusul aduce copia în ecran.
  const handleDuplicatePhase = async (phase: ProjectPhase) => {
    if (duplicatingPhase) return
    setDuplicatingPhase(phase.id)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phase.id}/duplicate`, {
        method: 'POST',
      })
      if (res.ok) {
        const { phase: copy, activities_created, document_requests_created, warnings } = await res.json()
        await duplicateRefresh()
        if (copy?.id) setRenamingId(copy.id)
        const omittedAssignments = Array.isArray(warnings) ? warnings.length : 0
        showToast(phaseDuplicatedMessage(phase.name, {
          activities: activities_created ?? 0,
          documentRequests: document_requests_created ?? 0,
        }, omittedAssignments), omittedAssignments > 0 ? 'warning' : 'success')
      } else {
        showToast(await serverMessage(res, 'Nu am putut duplica faza. Reîncearcă.'), 'error')
      }
    } catch {
      showToast('Nu am putut duplica faza. Reîncearcă.', 'error')
    } finally { setDuplicatingPhase(null) }
  }

  const handleDuplicateActivity = async (phaseId: string, activity: ProjectActivity) => {
    if (duplicatingActivity) return
    setDuplicatingActivity(activity.id)
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/phases/${phaseId}/activities/${activity.id}/duplicate`,
        { method: 'POST' }
      )
      if (res.ok) {
        const { activity: copy, document_requests_created, warnings } = await res.json()
        await duplicateRefresh()
        if (copy?.id) setRenamingId(copy.id)
        const omittedAssignments = Array.isArray(warnings) ? warnings.length : 0
        showToast(activityDuplicatedMessage(activity.name, document_requests_created ?? 0, omittedAssignments), omittedAssignments > 0 ? 'warning' : 'success')
      } else {
        showToast(await serverMessage(res, 'Nu am putut duplica activitatea. Reîncearcă.'), 'error')
      }
    } catch {
      showToast('Nu am putut duplica activitatea. Reîncearcă.', 'error')
    } finally { setDuplicatingActivity(null) }
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
    const confirmed = await confirm(phaseDeletionConfirm(phase, phaseDeletionImpact(documentRequests, phase)))
    if (confirmed) await handleDeletePhase(phase.id)
  }

  const askToDeleteActivity = async (phase: ProjectPhase, activity: ProjectActivity) => {
    if (deletingActivity === activity.id) return
    const confirmed = await confirm(
      activityDeletionConfirm(activity, activityDeletionImpact(documentRequests, phase, activity)),
    )
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
          className="fixed inset-0 z-[999998] md:hidden" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }}
          aria-hidden="true"
        />
      )}

      {/* Strâns, panoul lasă în urmă o fâșie cu butonul care îl redeschide. */}
      {collapsed && !mobileOpen && onCollapsedChange && (
        <div className="hidden md:sticky md:top-16 md:flex md:self-start md:border-r md:border-rule md:bg-plate md:py-1.5 md:pl-1 md:pr-1">
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            aria-label="Arată panoul fazelor"
            title="Arată panoul fazelor"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-plate)] text-ink-soft transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-[999999] w-80 max-w-[85vw] min-h-0 flex-shrink-0 flex-col overflow-hidden border-r border-rule bg-plate
        md:sticky md:inset-auto md:top-16 md:z-auto md:w-72 md:max-w-none md:self-start md:max-h-[calc(100dvh-4rem)] lg:w-80
        ${mobileOpen ? 'flex translate-x-0' : collapsed ? 'hidden' : 'hidden md:flex md:translate-x-0'}`}
        style={{ boxShadow: mobileOpen ? 'var(--sg-lift)' : undefined }}
      >

      {/* Header */}
      <div className="h-11 px-4 border-b border-[var(--p-border)] flex-shrink-0 flex items-center justify-between">
        {onShowAll ? (
          <button
            type="button"
            onClick={() => select(onShowAll)}
            aria-current={showingAll ? 'true' : undefined}
            title="Arată toate fazele în tabel"
            className={`-ml-2 flex min-h-9 items-center gap-2 rounded-[var(--radius-plate)] px-2 text-sm font-semibold transition-colors duration-[120ms] hover:bg-paper-sunk ${
              showingAll ? 'text-[var(--sg-accent-ink)]' : 'text-ink'
            }`}
          >
            <Layers className="h-4 w-4" aria-hidden="true" /> Toate fazele
          </button>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Layers className="h-4 w-4" aria-hidden="true" /> Toate fazele
          </p>
        )}
        <button
          onClick={onMobileClose}
          aria-label="Închide"
          className="md:hidden p-1 rounded text-[var(--p-ink-faint)] hover:text-[var(--p-ink)] hover:bg-[var(--p-surface-2)]"
        >
          <X className="w-4 h-4" />
        </button>
        {onCollapsedChange && (
          <button
            type="button"
            onClick={() => onCollapsedChange(true)}
            aria-label="Strânge panoul fazelor"
            title="Strânge panoul fazelor"
            className="hidden h-8 w-8 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink md:inline-flex"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Phases list */}
      {/* Pe calculator panoul stă lipit sub navigare și se derulează singur:
          fazele rămân la vedere oricât de jos ajungi în cereri. */}
      <nav className="flex-1 min-h-0 px-3 py-2 space-y-0.5 overflow-y-auto overscroll-contain">
        {phases.length === 0 && !showAddPhase && (
          <div className="p-6 text-center">
            <FolderOpen className="w-8 h-8 text-[var(--p-ink-faint)] mx-auto mb-2" />
            <p className="text-xs text-[var(--p-ink-faint)]">Nicio fază adăugată</p>
          </div>
        )}

        {displayPhases.map(phase => {
          const isActive = phase.id === activePhaseId
          const isExpanded = expandedPhases.has(phase.id)
          const phaseIndex = phases.findIndex(p => p.id === phase.id)
          // Publicarea e un detaliu de echipă: clientul vede doar faze publicate.
          const phaseDraft = canEdit && phase.visibility !== 'published'

          return (
            <div key={phase.id}>
              <Collapsible.Root open={isExpanded} onOpenChange={() => onToggleExpand(phase.id)}>
                <div
                    onClick={() => select(() => onSelectPhase(phase.id))}
                    onDragOver={e => handlePhaseDragOver(e, phase.id)}
                    data-tooltip={phaseDraft ? 'În pregătire — clientul n-o vede încă. Clic: doar faza asta în tabel.' : 'Clic: doar faza asta în tabel'}
                    className={`group relative flex min-h-11 items-center gap-2 rounded-[var(--radius-plate)] py-1 pl-1 pr-1 cursor-pointer transition-colors pointer-fine:min-h-8 ${
                      isActive ? 'bg-[var(--p-accent-soft)]' : 'hover:bg-[var(--p-surface-2)]'
                    } ${draggedPhaseId === phase.id ? 'opacity-50' : ''}`}
                  >
                    {/* `pointer-coarse:opacity-100`: pe un aparat fără maus nu există
                        „a trece peste”, deci mânerul rămâne invizibil și reordonarea nu
                        există. Pragul e lipsa mausului, nu lățimea — un iPad de 768px
                        n-are maus, dar trece de `md:`. */}
                    {canChange && renamingId !== phase.id && (
                      <span
                        draggable
                        onDragStart={e => handlePhaseDragStart(e, phase.id)}
                        onDragEnd={handlePhaseDragEnd}
                        onClick={e => e.stopPropagation()}
                        title="Trage pentru a reordona"
                        className="absolute -left-2.5 top-1/2 flex h-6 w-4 -translate-y-1/2 items-center justify-center rounded-[var(--radius-plate)] text-[var(--p-ink-faint)] hover:text-[var(--p-ink-soft)] opacity-0 group-hover:opacity-100 pointer-coarse:hidden transition-opacity cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                    )}
                    {/* Semnul aripii, aceeași bandă ca în panou și în pagină — o pastilă
                        verticală lângă nume, nu o muchie colorată. Faza în pregătire are
                        pastila goală, cu contur întrerupt: „plăcuța nemontată”. */}
                    <span
                      aria-hidden="true"
                      className={`ml-1 h-4 w-1.5 shrink-0 rounded-[1px] ${phaseDraft ? 'border border-dashed border-rule-strong' : ''}`}
                      style={phaseDraft ? undefined : { background: bandVar(bandFor(phaseIndex)) }}
                    />
                    {renamingId === phase.id ? (
                      <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                        <InlineInput
                          initialValue={phase.name}
                          placeholder="Nume fază..."
                          loading={savingRename === phase.id}
                          onConfirm={name => handleRenamePhase(phase.id, name)}
                          onCancel={() => setRenamingId(null)}
                        />
                      </div>
                    ) : (
                      // Panoul arată tot, inclusiv ce e finalizat (D10): aici se
                      // reordonează, deci nimic nu se ascunde, doar se marchează.
                      <span className={`min-w-0 flex-1 break-words text-[13px] leading-snug ${
                        isActive ? 'font-semibold text-[var(--sg-accent-ink)]' : isPhaseFinal(phase) ? 'font-medium text-ink-faint' : 'font-medium text-ink'
                      }`}>
                        {isPhaseFinal(phase) && (
                          <Check className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-[var(--sg-ok)]" strokeWidth={2.5} aria-hidden="true" />
                        )}
                        {phase.name}
                        {isPhaseFinal(phase) && <span className="sr-only"> (finalizată)</span>}
                        {phaseDraft && <span className="sr-only"> (în pregătire)</span>}
                      </span>
                    )}
                    {renamingId !== phase.id && <PhaseSignals signal={phaseSignals?.get(phase.id)} />}
                    {renamingId !== phase.id && (
                      <Collapsible.Trigger asChild>
                        <button
                          onClick={e => e.stopPropagation()}
                          aria-label={isExpanded ? 'Restrânge faza' : 'Extinde faza'}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-[var(--p-ink-faint)] hover:bg-paper-sunk hover:text-ink"
                        >
                          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-[120ms] ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                      </Collapsible.Trigger>
                    )}
                    {canChange && renamingId !== phase.id && (
                      <RowActionsMenu
                        label={`Acțiuni pentru faza ${phase.name}`}
                        busy={duplicatingPhase === phase.id || deletingPhase === phase.id}
                        // `group-hover` nu se declanșează pe touch, iar „⋯” e
                        // singura cale spre Redenumește / Duplică / Șterge:
                        // pe telefon rămâne vizibil.
                        className="md:opacity-0 md:group-hover:opacity-100 pointer-coarse:opacity-100 has-[:focus-visible]:opacity-100 data-[open=true]:opacity-100 transition-opacity"
                        actions={[
                          {
                            label: 'Redenumește',
                            icon: <Pencil className="w-3 h-3" />,
                            onSelect: () => setRenamingId(phase.id),
                          },
                          {
                            label: 'Duplică',
                            icon: <Copy className="w-3 h-3" />,
                            onSelect: () => { void handleDuplicatePhase(phase) },
                          },
                          {
                            label: 'Șterge',
                            icon: <Trash2 className="w-3 h-3" />,
                            danger: true,
                            hidden: !permissions.delete_phases,
                            onSelect: () => { void askToDeletePhase(phase) },
                          },
                        ]}
                      />
                    )}
                </div>

              {/* Activities sub-list */}
              <Collapsible.Content>
                {/* Activitățile atârnă sub pastila fazei, pe o linie subțire. */}
                <div className="mb-1 ml-[11px] border-l border-rule pl-2">
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
                    const actFinal = isActivityFinal(act)
                    // Pe o activitate finalizată, un termen trecut nu mai arde.
                    const isOverdue = !actFinal && !!deadlineDate && deadlineDate < today
                    // Chihlimbarul e pentru termenul apropiat (DESIGN.md), nu pentru
                    // orice dată: altfel fiecare rând ar părea că arde.
                    const isSoon = !actFinal && !isOverdue && !!deadlineDate && deadlineDate.getTime() - today.getTime() <= 7 * 86_400_000
                    const deadlineTone = isOverdue ? 'text-[var(--sg-danger)] font-semibold' : isSoon ? 'text-[var(--sg-warn)] font-semibold' : 'text-ink-faint'

                    return (
                      <div
                        key={act.id}
                        onDragOver={e => handleActivityDragOver(e, phase.id, act.id)}
                        className={draggedActivity?.actId === act.id ? 'opacity-50' : ''}
                      >
                        {/* Rândul întreg duce la activitate; datele și meniul își opresc
                            singure clicul. Numele rămâne întreg, termenul stă la dreapta. */}
                        <div
                          onClick={() => { if (renamingId !== act.id) select(() => onSelectActivity?.(phase.id, act.id)) }}
                          className={`group/act relative flex min-h-11 items-center gap-1.5 rounded-[var(--radius-plate)] py-0.5 pl-2 pr-1 transition-colors pointer-fine:min-h-7 ${
                            onSelectActivity ? 'cursor-pointer hover:bg-[var(--p-surface-2)]' : ''
                          }`}
                        >
                          {canChange && renamingId !== act.id && (
                            <span
                              draggable
                              onDragStart={e => handleActivityDragStart(e, phase, act.id)}
                              onDragEnd={handleActivityDragEnd}
                              onClick={e => e.stopPropagation()}
                              title="Trage pentru a reordona"
                              className="absolute -left-3.5 top-1/2 flex h-6 w-4 -translate-y-1/2 items-center justify-center rounded-[var(--radius-plate)] text-[var(--p-ink-faint)] hover:text-[var(--p-ink-soft)] opacity-0 group-hover/act:opacity-100 pointer-coarse:hidden transition-opacity cursor-grab active:cursor-grabbing"
                            >
                              <GripVertical className="w-3 h-3" />
                            </span>
                          )}
                          {renamingId === act.id ? (
                            <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                              <InlineInput
                                initialValue={act.name}
                                placeholder="Nume activitate..."
                                loading={savingRename === act.id}
                                onConfirm={name => handleRenameActivity(phase.id, act.id, name)}
                                onCancel={() => setRenamingId(null)}
                              />
                            </div>
                          ) : (
                            <span className={`min-w-0 flex-1 break-words text-xs leading-snug ${actFinal ? 'text-ink-faint' : 'text-ink-soft group-hover/act:text-ink'}`}>
                              {actFinal && (
                                <Check className="mr-1 inline h-3 w-3 -translate-y-px text-[var(--sg-ok)]" strokeWidth={2.5} aria-hidden="true" />
                              )}
                              {act.name}
                              {actFinal && <span className="sr-only"> (finalizată)</span>}
                            </span>
                          )}

                          {/* Termenul, pe același rând, aliniat la dreapta. Echipa îl
                              modifică apăsând pe dată; fără termen, apare doar calendarul. */}
                          {renamingId !== act.id && (canChange ? (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                setEditingDeadline(isEditingThisDeadline ? null : act.id)
                              }}
                              title={act.deadline_at ? 'Modifică termenul' : 'Setează termen'}
                              aria-label={deadlineLabel ? `${isOverdue ? 'Termen depășit, ' : ''}termen ${deadlineLabel} — modifică` : 'Setează termen'}
                              className={`inline-flex min-h-6 shrink-0 items-center gap-1 rounded-[var(--radius-plate)] px-1 text-[11px] tabular-nums transition-colors hover:bg-paper-sunk ${
                                deadlineLabel ? deadlineTone : 'text-ink-faint opacity-0 group-hover/act:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100'
                              }`}
                            >
                              {isOverdue && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                              {deadlineLabel ?? <Calendar className="h-3 w-3" aria-hidden="true" />}
                            </button>
                          ) : deadlineLabel && (
                            <span className={`inline-flex shrink-0 items-center gap-1 px-1 text-[11px] tabular-nums ${deadlineTone}`}>
                              {isOverdue && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                              {isOverdue && <span className="sr-only">Termen depășit: </span>}
                              {deadlineLabel}
                            </span>
                          ))}

                          {canChange && renamingId !== act.id && (
                            <RowActionsMenu
                              label={`Acțiuni pentru activitatea ${act.name}`}
                              size="sm"
                              busy={duplicatingActivity === act.id || deletingActivity === act.id}
                              className="md:opacity-0 md:group-hover/act:opacity-100 pointer-coarse:opacity-100 has-[:focus-visible]:opacity-100 data-[open=true]:opacity-100 transition-opacity"
                              actions={[
                                {
                                  label: 'Redenumește',
                                  icon: <Pencil className="w-3 h-3" />,
                                  onSelect: () => setRenamingId(act.id),
                                },
                                {
                                  label: 'Duplică',
                                  icon: <Copy className="w-3 h-3" />,
                                  onSelect: () => { void handleDuplicateActivity(phase.id, act) },
                                },
                                {
                                  label: 'Șterge',
                                  icon: <Trash2 className="w-3 h-3" />,
                                  danger: true,
                                  hidden: !permissions.delete_phases,
                                  onSelect: () => { void askToDeleteActivity(phase, act) },
                                },
                              ]}
                            />
                          )}
                        </div>

                        {/* Date picker inline */}
                        {isEditingThisDeadline && canChange && (
                          <div className="px-2 pb-1">
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
                  {canChange && (
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
                      <button data-tooltip="Adaugă o activitate nouă în această fază"
                        onClick={() => setShowAddActivity(prev => ({ ...prev, [phase.id]: true }))}
                        className="flex min-h-7 items-center gap-1.5 w-full px-2 py-1 text-xs text-[var(--p-ink-faint)] hover:text-[var(--p-accent)] hover:bg-[var(--p-accent-soft)] rounded-[var(--radius-plate)] transition-colors"
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
        {canChange && (
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
                data-tooltip="Adaugă o fază nouă la sfârșitul proiectului"
                className="flex min-h-8 items-center gap-1.5 w-full px-2.5 py-1.5 text-xs text-[var(--p-ink-faint)] hover:text-[var(--p-accent)] hover:bg-[var(--p-accent-soft)] rounded-[var(--radius-plate)] transition-colors"
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
            onClick={() => select(onSelectGeneral)}
            data-tooltip="Documentele care nu țin de o anumită fază"
            className={`group flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-plate)] cursor-pointer transition-colors ${
              isGeneralActive ? 'bg-[var(--p-accent-soft)]' : 'hover:bg-[var(--p-surface-2)]'
            }`}
          >
            <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isGeneralActive ? 'text-[var(--p-accent)]' : 'text-[var(--p-ink-faint)]'}`} />
            <span className={`min-w-0 flex-1 break-words text-[13px] leading-snug ${isGeneralActive ? 'font-semibold text-[var(--sg-accent-ink)]' : 'font-medium text-ink'}`}>
              Cereri generale
            </span>
            {generalId && <PhaseSignals signal={phaseSignals?.get(generalId)} />}
          </div>
        </div>
      </nav>

      </aside>
    </>
  )
}
