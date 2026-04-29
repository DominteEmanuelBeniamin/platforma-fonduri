'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Layers,
  FolderOpen,
  Plus,
  Loader2,
  X,
  Check,
  Trash2,
  Calendar,
} from 'lucide-react'

import TeamManager from '@/components/TeamManager'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectActivity {
  id: string
  name: string
  status: string
  order_index: number
  deadline_at?: string | null
  assigned_to?: string | null
  assigned_user?: { id: string; full_name: string | null; email: string } | null
}

export interface ProjectPhase {
  id: string
  name: string
  status: string
  order_index: number
  project_status_id: string
  project_status?: { id: string; name: string; color: string }
  activities?: ProjectActivity[]
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
        className="flex-1 text-xs px-2 py-1.5 border border-indigo-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-slate-800 placeholder:text-slate-400"
      />
      <button
        onClick={() => value.trim() && onConfirm(value.trim())}
        disabled={loading || !value.trim()}
        className="p-1 rounded bg-emerald-100 text-emerald-600 hover:bg-emerald-200 disabled:opacity-40"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
      </button>
      <button
        onClick={onCancel}
        className="p-1 rounded bg-slate-100 text-slate-500 hover:bg-slate-200"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

// ─── Confirm delete inline ────────────────────────────────────────────────────

function ConfirmDelete({
  label,
  onConfirm,
  onCancel,
  loading,
}: {
  label: string
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50 rounded-md border border-red-100">
      <span className="text-[11px] text-red-600 flex-1 truncate">Ștergi &ldquo;{label}&rdquo;?</span>
      <button
        onClick={onConfirm}
        disabled={loading}
        className="p-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-40"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
      </button>
      <button
        onClick={onCancel}
        className="p-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200"
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
  onSelectPhase: (phaseId: string) => void
  onToggleExpand: (phaseId: string) => void
  onRefresh: () => void
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectPhasesSidebar({
  phases,
  activePhaseId,
  expandedPhases,
  canEdit,
  isAdmin,
  projectId,
  onSelectPhase,
  onToggleExpand,
  onRefresh,
  apiFetch,
}: ProjectPhasesSidebarProps) {
  const [showAddPhase, setShowAddPhase] = useState(false)
  const [addingPhase, setAddingPhase] = useState(false)
  const [showAddActivity, setShowAddActivity] = useState<Record<string, boolean>>({})
  const [addingActivity, setAddingActivity] = useState<Record<string, boolean>>({})

  // delete confirm state
  const [confirmDeletePhase, setConfirmDeletePhase] = useState<string | null>(null)
  const [deletingPhase, setDeletingPhase] = useState<string | null>(null)
  const [confirmDeleteActivity, setConfirmDeleteActivity] = useState<string | null>(null)
  const [deletingActivity, setDeletingActivity] = useState<string | null>(null)

  // deadline edit state: activityId → true/false (popup deschis)
  const [editingDeadline, setEditingDeadline] = useState<string | null>(null)
  const [savingDeadline, setSavingDeadline] = useState<string | null>(null)

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
      else { const d = await res.json().catch(() => null); alert(d?.error || 'Eroare') }
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
      else { const d = await res.json().catch(() => null); alert(d?.error || 'Eroare') }
    } finally { setAddingActivity(prev => ({ ...prev, [phaseId]: false })) }
  }

  const handleDeletePhase = async (phaseId: string) => {
    setDeletingPhase(phaseId)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/phases/${phaseId}`, {
        method: 'DELETE',
      })
      if (res.ok) { setConfirmDeletePhase(null); onRefresh() }
      else { const d = await res.json().catch(() => null); alert(d?.error || 'Eroare la ștergere') }
    } finally { setDeletingPhase(null) }
  }

  const handleDeleteActivity = async (phaseId: string, activityId: string) => {
    setDeletingActivity(activityId)
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}`,
        { method: 'DELETE' }
      )
      if (res.ok) { setConfirmDeleteActivity(null); onRefresh() }
      else { const d = await res.json().catch(() => null); alert(d?.error || 'Eroare la ștergere') }
    } finally { setDeletingActivity(null) }
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
      else { const d = await res.json().catch(() => null); alert(d?.error || 'Eroare la salvare') }
    } finally { setSavingDeadline(null) }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <aside className="hidden md:flex flex-col w-64 lg:w-72 flex-shrink-0 bg-white border-r border-slate-200 overflow-y-auto">

      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex-shrink-0">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" /> Faze proiect
        </p>
      </div>

      {/* Phases list */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {phases.length === 0 && !showAddPhase && (
          <div className="p-6 text-center">
            <FolderOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">Nicio fază adăugată</p>
          </div>
        )}

        {phases.map(phase => {
          const isActive = phase.id === activePhaseId
          const isExpanded = expandedPhases.has(phase.id)
          const color = phase.project_status?.color || '#6B7280'
          const isConfirmingDeletePhase = confirmDeletePhase === phase.id

          return (
            <div key={phase.id}>
              {/* Confirm delete phase */}
              {isConfirmingDeletePhase ? (
                <div className="mx-1 mb-0.5">
                  <ConfirmDelete
                    label={phase.name}
                    onConfirm={() => handleDeletePhase(phase.id)}
                    onCancel={() => setConfirmDeletePhase(null)}
                    loading={deletingPhase === phase.id}
                  />
                </div>
              ) : (
                <div
                    onClick={() => {
                      onSelectPhase(phase.id)
                      onToggleExpand(phase.id)
                    }}
                    className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                      isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className={`flex-1 text-sm font-medium truncate ${isActive ? 'text-indigo-900' : 'text-slate-700'}`}>
                      {phase.name}
                    </span>
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    }
                    {isAdmin && (
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeletePhase(phase.id) }}
                        className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                </div>
              )}

              {/* Activities sub-list */}
              {isExpanded && (
                <div className="ml-5 mt-0.5 mb-1 pl-3 border-l-2 border-slate-100 space-y-0.5">
                  {phase.activities?.map(act => {
                    const isConfirmingDeleteAct = confirmDeleteActivity === act.id

                    if (isConfirmingDeleteAct) {
                      return (
                        <ConfirmDelete
                          key={act.id}
                          label={act.name}
                          onConfirm={() => handleDeleteActivity(phase.id, act.id)}
                          onCancel={() => setConfirmDeleteActivity(null)}
                          loading={deletingActivity === act.id}
                        />
                      )
                    }

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
                        className="group/act flex flex-col gap-0.5 py-1.5 px-2 rounded-md hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600 truncate flex-1">{act.name}</span>

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
                                    ? 'text-red-400 hover:text-red-600'
                                    : 'text-amber-400 hover:text-amber-600'
                                  : 'text-slate-300 hover:text-indigo-500 opacity-0 group-hover/act:opacity-100'
                              }`}
                            >
                              <Calendar className="w-3 h-3" />
                            </button>
                          )}

                          {isAdmin && (
                            <button
                              onClick={e => { e.stopPropagation(); setConfirmDeleteActivity(act.id) }}
                              className="p-0.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/act:opacity-100 transition-opacity flex-shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        {/* Deadline label — afișat când există */}
                        {deadlineLabel && !isEditingThisDeadline && (
                          <span
                            className={`text-[10px] font-medium ml-0 ${
                              isOverdue ? 'text-red-500' : 'text-amber-500'
                            }`}
                          >
                            {isOverdue ? '⚠ ' : ''}{deadlineLabel}
                          </span>
                        )}

                        {/* Date picker inline */}
                        {isEditingThisDeadline && canEdit && (
                          <div
                            className="flex items-center gap-1 mt-0.5"
                            onClick={e => e.stopPropagation()}
                          >
                            <input
                              type="date"
                              defaultValue={currentDeadline}
                              disabled={savingDeadline === act.id}
                              autoFocus
                              className="flex-1 text-[11px] px-1.5 py-1 border border-indigo-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-slate-700"
                              onKeyDown={e => {
                                if (e.key === 'Escape') setEditingDeadline(null)
                                if (e.key === 'Enter') {
                                  handleSaveDeadline(phase.id, act.id, (e.target as HTMLInputElement).value)
                                }
                              }}
                            />
                            <button
                              onClick={e => {
                                const input = e.currentTarget.previousElementSibling as HTMLInputElement
                                handleSaveDeadline(phase.id, act.id, input.value)
                              }}
                              disabled={savingDeadline === act.id}
                              className="p-1 rounded bg-emerald-100 text-emerald-600 hover:bg-emerald-200 disabled:opacity-40 flex-shrink-0"
                            >
                              {savingDeadline === act.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Check className="w-3 h-3" />
                              }
                            </button>
                            <button
                              onClick={() => setEditingDeadline(null)}
                              className="p-1 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 flex-shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
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
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Adaugă activitate
                      </button>
                    )
                  )}
                </div>
              )}
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
                className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Adaugă fază
              </button>
            )}
          </div>
        )}
      </nav>

      {/* Team manager */}
      {isAdmin && (
        <div className="border-t border-slate-100 flex-shrink-0">
          <TeamManager projectId={projectId} />
        </div>
      )}
    </aside>
  )
}
