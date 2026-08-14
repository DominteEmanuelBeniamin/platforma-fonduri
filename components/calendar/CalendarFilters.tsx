'use client'

import { FolderOpen, Layers, RotateCcw } from 'lucide-react'
import {
  GENERAL_PHASE_ID,
  KIND_LABELS,
  PROGRESS_LABELS,
  UNASSIGNED_OWNER_ID,
  VISIBILITY_LABELS,
  activeFilterCount,
  type CalendarEventKind,
  type CalendarFilterState,
  type CalendarPayload,
  type CalendarPhaseOption,
  type CalendarProgress,
  type CalendarProjectOption,
  type CalendarVisibility,
} from '@/lib/calendar'
import FilterDropdown, { summarizeSelection, type FilterOption } from '@/components/calendar/FilterDropdown'

export interface OwnerOption {
  id: string
  name: string
}

interface CalendarFiltersProps {
  filters: CalendarFilterState
  defaults: CalendarFilterState
  onChange: (next: CalendarFilterState) => void
  role: CalendarPayload['role']
  userId: string
  /** Calendarul unui proiect filtrează pe fază; cel general, pe proiect. */
  scope: 'project' | 'global'
  phases: CalendarPhaseOption[]
  projects: CalendarProjectOption[]
  /** Responsabilii care apar efectiv în evenimentele încărcate. */
  owners: OwnerOption[]
}

const KIND_ICONS = { activity: Layers, request: FolderOpen }
const KINDS: CalendarEventKind[] = ['activity', 'request']
const PROGRESS_ORDER: CalendarProgress[] = ['open', 'done', 'overdue']
const VISIBILITY_ORDER: CalendarVisibility[] = ['draft', 'published']

/**
 * Cele patru controale ale calendarului. Toate sunt combinabile, iar starea lor
 * urcă în URL prin `CalendarSurface`, ca o vedere filtrată să poată fi trimisă
 * mai departe.
 */
export default function CalendarFilters({
  filters,
  defaults,
  onChange,
  role,
  userId,
  scope,
  phases,
  projects,
  owners,
}: CalendarFiltersProps) {
  const set = (patch: Partial<CalendarFilterState>) => onChange({ ...filters, ...patch })

  const toggleKind = (kind: CalendarEventKind) => {
    set({
      kinds: filters.kinds.includes(kind)
        ? filters.kinds.filter(entry => entry !== kind)
        : [...filters.kinds, kind],
    })
  }

  // ── Fază (proiect) sau Proiect (general) ───────────────────────────────────
  const phaseOptions: FilterOption[] = [
    ...phases.map(phase => ({ value: phase.id, label: phase.name })),
    // Cererile fără activitate n-au fază; „General" le face filtrabile ca atare.
    { value: GENERAL_PHASE_ID, label: 'General' },
  ]
  const projectOptions: FilterOption[] = projects.map(project => ({
    value: project.id,
    label: project.title,
    group: project.client_name ?? 'Fără client',
  }))

  // ── Stare: progres + publicare, sub același buton ──────────────────────────
  const progressOptions: FilterOption[] = PROGRESS_ORDER.map(value => ({ value, label: PROGRESS_LABELS[value] }))
  const visibilityOptions: FilterOption[] = VISIBILITY_ORDER.map(value => ({ value, label: VISIBILITY_LABELS[value] }))
  const stateSummary = filters.progress === null && filters.visibility === null
    ? 'Toate'
    : [
        summarizeSelection(filters.progress, progressOptions, 'Toate', count => `${count} stări`),
        // Grupul de publicare nu există pentru client, deci nici în rezumat.
        role === 'client'
          ? null
          : filters.visibility === null
          ? null
          : summarizeSelection(filters.visibility, visibilityOptions, 'Toate', count => `${count} stări`),
      ]
        .filter(entry => entry && entry !== 'Toate')
        .join(' · ') || 'Toate'

  const ownerOptions: FilterOption[] = [
    ...owners.map(owner => ({ value: owner.id, label: owner.name })),
    { value: UNASSIGNED_OWNER_ID, label: 'Fără responsabil' },
  ]

  const isMineOnly =
    filters.owners !== null && filters.owners.length === 1 && filters.owners[0] === userId

  const resetCount = activeFilterCount(filters, defaults)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* 1 — Tip element: comutatoare, nu dropdown */}
      <div className="flex items-center gap-1 rounded-full border border-[var(--p-border-strong)] bg-[var(--p-surface)] p-0.5">
        {KINDS.map(kind => {
          const Icon = KIND_ICONS[kind]
          const on = filters.kinds.includes(kind)
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)] ${
                on ? 'bg-[var(--p-accent)] text-white' : 'text-[var(--p-ink-faint)] hover:bg-[var(--p-surface-2)]'
              }`}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {KIND_LABELS[kind]}
            </button>
          )
        })}
      </div>

      {/* 2 — Fază, respectiv Proiect */}
      {scope === 'project' ? (
        <FilterDropdown
          label="Fază"
          active={filters.phaseIds !== null}
          summary={summarizeSelection(filters.phaseIds, phaseOptions, 'Toate', count => `${count} faze`)}
          sections={[
            {
              key: 'phases',
              allLabel: 'Toate fazele',
              options: phaseOptions,
              value: filters.phaseIds,
              onChange: next => set({ phaseIds: next }),
            },
          ]}
        />
      ) : (
        <FilterDropdown
          label="Proiect"
          active={filters.projectIds !== null}
          summary={summarizeSelection(filters.projectIds, projectOptions, 'Toate', count => `${count} proiecte`)}
          sections={[
            {
              key: 'projects',
              allLabel: 'Toate proiectele',
              options: projectOptions,
              value: filters.projectIds,
              onChange: next => set({ projectIds: next }),
            },
          ]}
        />
      )}

      {/* 3 — Stare: progres pentru toți, publicare doar pentru echipă */}
      <FilterDropdown
        label="Stare"
        active={filters.progress !== null || filters.visibility !== null}
        summary={stateSummary}
        sections={[
          {
            key: 'progress',
            title: 'Progres',
            allLabel: 'Toate',
            options: progressOptions,
            value: filters.progress,
            onChange: next => set({ progress: next as CalendarProgress[] | null }),
          },
          ...(role === 'client'
            ? []
            : [
                {
                  key: 'visibility',
                  title: 'Publicare',
                  allLabel: 'Toate',
                  options: visibilityOptions,
                  value: filters.visibility,
                  onChange: (next: string[] | null) => set({ visibility: next as CalendarVisibility[] | null }),
                },
              ]),
        ]}
      />

      {/* 4 — Responsabil: comutator la consultant, listă la administrator */}
      {role === 'consultant' && (
        <div className="flex items-center gap-1 rounded-full border border-[var(--p-border-strong)] bg-[var(--p-surface)] p-0.5">
          <button
            type="button"
            onClick={() => set({ owners: [userId] })}
            aria-pressed={isMineOnly}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)] ${
              isMineOnly ? 'bg-[var(--p-accent)] text-white' : 'text-[var(--p-ink-faint)] hover:bg-[var(--p-surface-2)]'
            }`}
          >
            Ale mele
          </button>
          <button
            type="button"
            onClick={() => set({ owners: null })}
            aria-pressed={filters.owners === null}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)] ${
              filters.owners === null ? 'bg-[var(--p-accent)] text-white' : 'text-[var(--p-ink-faint)] hover:bg-[var(--p-surface-2)]'
            }`}
          >
            Toate
          </button>
        </div>
      )}

      {role === 'admin' && (
        <FilterDropdown
          label="Responsabil"
          active={filters.owners !== null}
          summary={summarizeSelection(filters.owners, ownerOptions, 'Toți', count => `${count} persoane`)}
          sections={[
            {
              key: 'owners',
              allLabel: 'Toți responsabilii',
              options: ownerOptions,
              value: filters.owners,
              onChange: next => set({ owners: next }),
            },
          ]}
        />
      )}

      {resetCount > 0 && (
        <button
          type="button"
          onClick={() => onChange(defaults)}
          className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-[var(--p-ink-faint)] transition-colors hover:bg-[var(--p-surface-2)] hover:text-[var(--p-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)]"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Șterge filtrele
          <span className="sr-only">({resetCount} active)</span>
        </button>
      )}
    </div>
  )
}
