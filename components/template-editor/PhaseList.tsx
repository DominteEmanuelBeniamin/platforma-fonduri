'use client'

import { memo, useRef } from 'react'
import {
  AlertCircle, ArrowDown, ArrowUp, ChevronRight, Copy, Edit2, FileText, GripVertical, Paperclip, Pencil, Plus, Trash2, Upload,
} from 'lucide-react'
import RowActionsMenu from '@/components/RowActionsMenu'
import { IconButton } from '@/components/ui/IconButton'
import { Plate } from '@/components/ui/Plate'
import { countLabel } from '@/lib/count-label'
import { profileDisplayName } from '@/lib/profile-display'
import { REQUIREMENT_BADGE, REQUIREMENT_LABELS } from '@/lib/requirement-type'
import { bandFor } from '@/lib/signage'
import type { Consultant, DocumentRequirement, EditorActions, TemplateActivity, TemplatePhase } from './types'

/**
 * Fazele, activitățile și cererile din editorul de șabloane. Fiecare nivel e
 * `memo` și primește funcții stabile (`EditorActions`): o tastare în numele
 * șablonului sau într-un dialog nu mai re-randează tot arborele (S-26).
 *
 * Numele se citesc ca titluri și se schimbă din „⋯ → Redenumește” (D9, S-27);
 * toate acțiunile unui rând stau în „⋯” (S-28). Mânerul de tras rămâne pentru
 * maus, în coloana lui; pe touch și de la tastatură, „Mută sus/jos” din meniu.
 */

/** Butoanele-pictogramă ale rândurilor: 32px cu mausul, 44px la atingere. */
const compactIcon = 'pointer-fine:h-8! pointer-fine:w-8!'
/** Mânerul are locul lui, în flux: nu se suprapune niciodată pe nume (S-08). */
const dragHandleClass = 'hidden w-4 shrink-0 cursor-grab text-ink-faint hover:text-ink-soft active:cursor-grabbing pointer-fine:flex pointer-fine:items-center pointer-fine:justify-center'
const menuTrigger = 'inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink disabled:opacity-60 pointer-fine:h-8 pointer-fine:w-8'

export function countPhaseDocuments(phase: TemplatePhase) {
  return phase.activities.reduce((sum, activity) => sum + activity.document_requirements.length, 0)
}

function hasMissingTemplateAttachment(doc: DocumentRequirement) {
  return Boolean(doc.templateFileMissingAt || doc.templateAttachments.some(attachment => attachment.missing_at))
}

const errorKey = {
  phase: (phaseId: string) => `phase:${phaseId}:name`,
  activity: (phaseId: string, activityId: string) => `activity:${phaseId}:${activityId}:name`,
  docName: (phaseId: string, activityId: string, docId: string) => `doc:${phaseId}:${activityId}:${docId}:name`,
  docFile: (phaseId: string, activityId: string, docId: string) => `doc:${phaseId}:${activityId}:${docId}:templateFile`,
}

/** Titlul unui rând: numele, sau „Fără nume” roșu cu motivul, la datele vechi. */
function Title({ name, invalid, className }: { name: string; invalid: boolean; className: string }) {
  if (name.trim()) return <span className={`min-w-0 break-words ${className}`}>{name}</span>
  return (
    <span className={`min-w-0 ${className} ${invalid ? 'text-[var(--sg-danger)]' : 'text-ink-faint'}`}>
      Fără nume
    </span>
  )
}

const DocRow = memo(function DocRow({
  doc, index, count, phaseId, activityId, errors, dragging, actions,
}: {
  doc: DocumentRequirement
  index: number
  count: number
  phaseId: string
  activityId: string
  errors: ReadonlySet<string>
  dragging: boolean
  actions: EditorActions
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const nameError = errors.has(errorKey.docName(phaseId, activityId, doc.id))
  const fileError = errors.has(errorKey.docFile(phaseId, activityId, doc.id))
  const hasFiles = doc.templateAttachments.length > 0 || doc.templateFiles.length > 0
  const noun = doc.is_outgoing ? 'document' : 'model'
  const parentKey = `${phaseId}:${activityId}`
  return (
    <li
      onDragOver={e => actions.dragOver(e, 'doc', parentKey, doc.id)}
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 ${
        nameError || fileError ? 'bg-[var(--sg-danger-soft)]' : doc.is_outgoing ? 'bg-[var(--sg-accent-soft)]' : ''
      } ${dragging ? 'opacity-50' : ''}`}
    >
      <span
        draggable
        aria-hidden="true"
        onDragStart={e => { actions.dragStart('doc', parentKey, doc.id); e.dataTransfer.effectAllowed = 'move' }}
        onDragEnd={actions.dragEnd}
        data-tooltip="Trage pentru a reordona"
        className={dragHandleClass}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <FileText className={`h-4 w-4 shrink-0 ${doc.is_outgoing ? 'text-[var(--sg-accent)]' : 'text-ink-faint'}`} aria-hidden="true" />
      <div className="min-w-[10rem] flex-1 py-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-ink">{doc.name || 'Document fără nume'}</span>
          {doc.is_outgoing ? (
            <span className="rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-plate px-1.5 text-[11px] leading-[18px] text-[var(--sg-accent)]">
              Document de trimis
            </span>
          ) : REQUIREMENT_BADGE[doc.requirement_type] && (
            <span className={`rounded-[var(--radius-plate)] border px-1.5 text-[11px] leading-[18px] ${REQUIREMENT_BADGE[doc.requirement_type].bg} ${REQUIREMENT_BADGE[doc.requirement_type].text} ${REQUIREMENT_BADGE[doc.requirement_type].border}`}>
              {REQUIREMENT_LABELS[doc.requirement_type]}
            </span>
          )}
        </div>
        {nameError && <p className="mt-0.5 text-xs text-[var(--sg-danger)]">Numele documentului este obligatoriu.</p>}
        {fileError && <p className="mt-0.5 text-xs text-[var(--sg-danger)]">Documentul de trimis are nevoie de fișier atașat.</p>}
        {doc.description && <p className="mt-0.5 text-xs leading-5 text-ink-soft">{doc.description}</p>}
        {hasFiles && (
          <p className={`mt-0.5 flex items-start gap-1 text-xs leading-5 ${hasMissingTemplateAttachment(doc) ? 'text-[var(--sg-warn)]' : 'text-[var(--sg-accent)]'}`}>
            {hasMissingTemplateAttachment(doc)
              ? <AlertCircle className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />
              : <Paperclip className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 break-words">{[
              ...doc.templateAttachments.map(a => `${a.original_name || a.storage_path.split('/').pop() || 'fișier atașat'}${a.missing_at ? ' (indisponibil)' : ''}`),
              ...doc.templateFiles.map(file => file.name),
            ].filter(Boolean).join(', ')}</span>
          </p>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
        multiple
        onChange={e => {
          const files = Array.from(e.currentTarget.files ?? [])
          if (files.length) actions.attachFiles(phaseId, activityId, doc.id, files)
          e.currentTarget.value = ''
        }}
      />
      <RowActionsMenu
        className="ml-auto"
        label={`Acțiuni pentru cererea ${doc.name || 'fără nume'}`}
        tooltip="Acțiuni cerere"
        triggerClassName={menuTrigger}
        actions={[
          { label: 'Modifică', icon: <Edit2 className="h-4 w-4" />, onSelect: () => actions.editDoc(phaseId, activityId, doc) },
          { label: hasFiles ? `Adaugă încă un ${noun}` : `Încarcă ${noun}`, icon: <Upload className="h-4 w-4" />, onSelect: () => fileRef.current?.click() },
          { label: 'Mută sus', icon: <ArrowUp className="h-4 w-4" />, hidden: index === 0, onSelect: () => actions.moveDoc(phaseId, activityId, doc.id, -1) },
          { label: 'Mută jos', icon: <ArrowDown className="h-4 w-4" />, hidden: index === count - 1, onSelect: () => actions.moveDoc(phaseId, activityId, doc.id, 1) },
          { label: 'Șterge', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => actions.deleteDoc(phaseId, activityId, doc) },
        ]}
      />
    </li>
  )
})

const ActivityBlock = memo(function ActivityBlock({
  activity, index, count, phaseId, phaseLabel, consultants, errors, dragId, actions,
}: {
  activity: TemplateActivity
  index: number
  count: number
  phaseId: string
  phaseLabel: string
  consultants: Consultant[]
  errors: ReadonlySet<string>
  dragId: string | null
  actions: EditorActions
}) {
  const activityLabel = activity.name || `${index + 1}`
  const nameError = errors.has(errorKey.activity(phaseId, activity.id))
  const inactive = consultants.find(c => c.id === activity.default_consultant_id && c.is_active === false)
  return (
    <div className={dragId === activity.id ? 'opacity-50' : ''}>
      <div
        className="flex flex-wrap items-center gap-x-1.5 gap-y-1"
        onDragOver={e => actions.dragOver(e, 'activity', phaseId, activity.id)}
      >
        <span
          draggable
          aria-hidden="true"
          onDragStart={e => { actions.dragStart('activity', phaseId, activity.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={actions.dragEnd}
          data-tooltip="Trage pentru a reordona"
          className={dragHandleClass}
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <IconButton
          className={compactIcon}
          label={activity.expanded ? `Restrânge activitatea ${activityLabel}` : `Extinde activitatea ${activityLabel}`}
          aria-expanded={activity.expanded}
          onClick={() => actions.toggleActivity(phaseId, activity.id)}
        >
          <ChevronRight className={`h-4 w-4 transition-transform duration-[120ms] ${activity.expanded ? 'rotate-90' : ''}`} />
        </IconButton>
        {/* Lățime minimă: pe telefon, lista de consultanți coboară pe rândul
            următor, nu rupe numele literă cu literă. */}
        <Title name={activity.name} invalid={nameError} className="min-w-[10rem] flex-1 px-1 text-sm font-medium text-ink" />
        <div className="ml-auto flex items-center gap-0.5">
          <select
            value={activity.default_consultant_id ?? ''}
            onChange={e => actions.setConsultant(phaseId, activity.id, e.target.value || undefined)}
            aria-label={`Consultant implicit pentru activitatea ${activityLabel}`}
            className="mr-1 h-10 w-44 rounded-[var(--radius-plate)] border border-rule bg-plate px-2 text-xs text-ink-soft transition-colors duration-[120ms] hover:border-rule-strong focus:border-[var(--sg-accent)] pointer-fine:h-8"
          >
            <option value="">Consultant implicit</option>
            {inactive && <option value={activity.default_consultant_id} disabled>{profileDisplayName(inactive)}</option>}
            {consultants.filter(c => c.is_active !== false).map(c => (
              <option key={c.id} value={c.id}>{profileDisplayName(c)}</option>
            ))}
          </select>
          <RowActionsMenu
            label={`Acțiuni pentru activitatea ${activityLabel} din faza ${phaseLabel}`}
            tooltip="Acțiuni activitate"
            triggerClassName={menuTrigger}
            actions={[
              { label: 'Redenumește', icon: <Pencil className="h-4 w-4" />, onSelect: () => actions.renameActivity(phaseId, activity) },
              { label: 'Duplică', icon: <Copy className="h-4 w-4" />, onSelect: () => actions.duplicateActivity(phaseId, activity.id) },
              { label: 'Mută sus', icon: <ArrowUp className="h-4 w-4" />, hidden: index === 0, onSelect: () => actions.moveActivity(phaseId, activity.id, -1) },
              { label: 'Mută jos', icon: <ArrowDown className="h-4 w-4" />, hidden: index === count - 1, onSelect: () => actions.moveActivity(phaseId, activity.id, 1) },
              { label: 'Șterge', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => actions.deleteActivity(phaseId, activity) },
            ]}
          />
        </div>
      </div>

      {activity.expanded && (
        <div className="mt-1.5 sm:ml-14">
          {nameError && <p className="mb-1.5 text-xs text-[var(--sg-danger)]">Numele activității este obligatoriu.</p>}
          {/* Cererile activității: o singură listă cu despărțitoare. */}
          <ul className="divide-y divide-rule overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
            {activity.document_requirements.map((doc, docIdx) => (
              <DocRow
                key={doc.id}
                doc={doc}
                index={docIdx}
                count={activity.document_requirements.length}
                phaseId={phaseId}
                activityId={activity.id}
                errors={errors}
                dragging={dragId === doc.id}
                actions={actions}
              />
            ))}
            <li>
              <button data-tooltip="Adaugă o cerere de document în această activitate"
                type="button"
                onClick={() => actions.addDoc(phaseId, activity.id)}
                className="flex min-h-9 w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-[var(--sg-accent)] transition-colors duration-[120ms] hover:bg-[var(--sg-accent-soft)]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Adaugă cerere document
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
})

const PhaseCard = memo(function PhaseCard({
  phase, index, count, consultants, errors, dragId, actions,
}: {
  phase: TemplatePhase
  index: number
  count: number
  consultants: Consultant[]
  errors: ReadonlySet<string>
  dragId: string | null
  actions: EditorActions
}) {
  const phaseLabel = phase.name || `${index + 1}`
  const nameError = errors.has(errorKey.phase(phase.id))
  return (
    <Plate band={bandFor(index)} className={`overflow-hidden !p-0 ${dragId === phase.id ? 'opacity-50' : ''}`}>
      <div
        className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 bg-paper-sunk px-2 pb-2 pt-3 sm:px-3 ${phase.expanded ? 'border-b border-rule' : ''}`}
        onDragOver={e => actions.dragOver(e, 'phase', '', phase.id)}
      >
        <span
          draggable
          aria-hidden="true"
          onDragStart={e => { actions.dragStart('phase', '', phase.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={actions.dragEnd}
          data-tooltip="Trage pentru a reordona"
          className={dragHandleClass}
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <IconButton
          className={compactIcon}
          label={phase.expanded ? `Restrânge faza ${phaseLabel}` : `Extinde faza ${phaseLabel}`}
          aria-expanded={phase.expanded}
          onClick={() => actions.togglePhase(phase.id)}
        >
          <ChevronRight className={`h-4 w-4 transition-transform duration-[120ms] ${phase.expanded ? 'rotate-90' : ''}`} />
        </IconButton>
        <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-ink-soft">{index + 1}</span>
        <h3 className="flex min-w-[10rem] flex-1 px-1 text-[15px] font-semibold text-ink">
          <Title name={phase.name} invalid={nameError} className="" />
        </h3>
        <span className="hidden shrink-0 px-1 text-xs text-ink-faint md:inline">
          {countLabel(phase.activities.length, 'activitate', 'activități')} · {countLabel(countPhaseDocuments(phase), 'document', 'documente')}
        </span>
        <RowActionsMenu
          className="ml-auto"
          label={`Acțiuni pentru faza ${phaseLabel}`}
          tooltip="Acțiuni fază"
          triggerClassName={menuTrigger}
          actions={[
            { label: 'Redenumește', icon: <Pencil className="h-4 w-4" />, onSelect: () => actions.renamePhase(phase) },
            { label: 'Duplică', icon: <Copy className="h-4 w-4" />, onSelect: () => actions.duplicatePhase(phase.id) },
            { label: 'Mută sus', icon: <ArrowUp className="h-4 w-4" />, hidden: index === 0, onSelect: () => actions.movePhase(phase.id, -1) },
            { label: 'Mută jos', icon: <ArrowDown className="h-4 w-4" />, hidden: index === count - 1, onSelect: () => actions.movePhase(phase.id, 1) },
            { label: 'Șterge', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => actions.deletePhase(phase) },
          ]}
        />
      </div>

      {phase.expanded && (
        <div className="space-y-3 px-2 py-3 sm:px-3">
          {nameError && <p className="text-xs text-[var(--sg-danger)]">Completează numele fazei înainte de salvare.</p>}
          {phase.activities.map((activity, activityIdx) => (
            <ActivityBlock
              key={activity.id}
              activity={activity}
              index={activityIdx}
              count={phase.activities.length}
              phaseId={phase.id}
              phaseLabel={phaseLabel}
              consultants={consultants}
              errors={errors}
              dragId={dragId}
              actions={actions}
            />
          ))}
          <button data-tooltip="Adaugă o activitate nouă în această fază"
            type="button"
            onClick={() => actions.addActivity(phase.id)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-plate)] px-2 text-sm font-semibold text-[var(--sg-accent)] transition-colors duration-[120ms] hover:bg-[var(--sg-accent-soft)]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Adaugă activitate
          </button>
        </div>
      )}
    </Plate>
  )
})

export const PhaseList = memo(function PhaseList({
  phases, consultants, errors, dragId, actions,
}: {
  phases: TemplatePhase[]
  consultants: Consultant[]
  errors: ReadonlySet<string>
  dragId: string | null
  actions: EditorActions
}) {
  return (
    <div className="space-y-3">
      {phases.map((phase, index) => (
        <PhaseCard
          key={phase.id}
          phase={phase}
          index={index}
          count={phases.length}
          consultants={consultants}
          errors={errors}
          dragId={dragId}
          actions={actions}
        />
      ))}
    </div>
  )
})
