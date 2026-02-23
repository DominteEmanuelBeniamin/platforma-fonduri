'use client'

import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Play,
  Layers,
  FolderOpen,
} from 'lucide-react'

import TeamManager from '@/components/TeamManager'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectActivity {
  id: string
  name: string
  status: string
  order_index: number
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

// ─── Status config ─────────────────────────────────────────────────────────────

export const phaseStatusCfg: Record<string, { label: string; color: string; ring: string }> = {
  pending:     { label: 'În așteptare', color: 'text-slate-500',   ring: 'ring-slate-200' },
  in_progress: { label: 'În lucru',     color: 'text-blue-600',    ring: 'ring-blue-200' },
  completed:   { label: 'Finalizat',    color: 'text-emerald-600', ring: 'ring-emerald-200' },
  skipped:     { label: 'Omis',         color: 'text-slate-400',   ring: 'ring-slate-100' },
}

// ─── Activity status icon ─────────────────────────────────────────────────────

function ActivityStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
  if (status === 'in_progress') return <Play className="w-4 h-4 text-blue-500 flex-shrink-0" />
  return <Circle className="w-4 h-4 text-slate-300 flex-shrink-0" />
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectPhasesSidebarProps {
  phases: ProjectPhase[]
  activePhaseId: string | null
  expandedPhases: Set<string>
  canEdit: boolean
  projectId: string
  onSelectPhase: (phaseId: string) => void
  onToggleExpand: (phaseId: string) => void
  onUpdateActivityStatus: (phaseId: string, activityId: string, status: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectPhasesSidebar({
  phases,
  activePhaseId,
  expandedPhases,
  canEdit,
  projectId,
  onSelectPhase,
  onToggleExpand,
  onUpdateActivityStatus,
}: ProjectPhasesSidebarProps) {
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
                  onSelectPhase(phase.id)
                  onToggleExpand(phase.id)
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
                    <div
                      key={act.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-slate-50"
                    >
                      <ActivityStatusIcon status={act.status} />
                      <span className="text-xs text-slate-600 truncate flex-1">{act.name}</span>
                      {canEdit && (
                        <select
                          value={act.status}
                          onChange={e => onUpdateActivityStatus(phase.id, act.id, e.target.value)}
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

      {/* Team manager */}
      <div className="border-t border-slate-100 flex-shrink-0">
        <TeamManager projectId={projectId} />
      </div>
    </aside>
  )
}