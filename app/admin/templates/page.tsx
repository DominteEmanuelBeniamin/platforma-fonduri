/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Fragment, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  Layers, FileText, Plus, Trash2,
  ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Check, X, Paperclip, Upload,
  Loader2, Edit2, AlertCircle, GripVertical, Copy,
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { countLabel } from '@/lib/count-label'
import { RequirementType, REQUIREMENT_TYPES, REQUIREMENT_LABELS, REQUIREMENT_BADGE, normalizeRequirementType } from '@/lib/requirement-type'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { useToast } from '@/app/providers/ToastProvider'
import { buildCopyName } from '@/lib/duplicate-name'
import { templateFormDirty, type TemplateFormState } from '@/lib/template-form'
import { serverMessage } from '@/lib/api-error'
import { mapWithConcurrency } from '@/lib/template-tree'
import {
  duplicationFromSource,
  isPersistentTemplateId,
} from '@/app/api/_utils/template-duplication'
import type { TemplateDuplication } from '@/app/api/_utils/template-duplication'
import { Spinner } from '@/components/ui/Spinner'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { IconButton } from '@/components/ui/IconButton'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { Plate } from '@/components/ui/Plate'
import { Signal } from '@/components/ui/Signal'
import { FloatingSurface, Scrim } from '@/components/ui/Surface'
import { profileDisplayName } from '@/lib/profile-display'
import { bandFor, bandVar } from '@/lib/signage'

interface ProjectStatus {
  id: string
  name: string
  slug: string
  color: string
}

interface DocumentRequirement {
  id: string
  name: string
  description: string
  is_outgoing: boolean
  requirement_type: RequirementType
  templateFiles: File[]
  templateAttachments: TemplateAttachment[]
  templateFileName: string | null
  templateFileMissingAt?: string | null
  templateFileRemoved?: boolean
  duplication?: TemplateDuplication
  sourceLocalId?: string
}

interface TemplateAttachment {
  id: string
  storage_path: string
  original_name: string | null
  mime_type?: string | null
  file_size?: number | null
  order_index?: number
  missing_at?: string | null
  missing_checked_at?: string | null
}

interface Consultant {
  id: string
  full_name: string | null
  email: string
  is_active?: boolean | null
}

interface TemplateActivity {
  id: string
  name: string
  document_requirements: DocumentRequirement[]
  expanded: boolean
  default_consultant_id?: string
  duplication?: TemplateDuplication
  sourceLocalId?: string
}

interface TemplatePhase {
  id: string
  name: string
  project_status_id: string | null
  activities: TemplateActivity[]
  expanded: boolean
  duplication?: TemplateDuplication
  sourceLocalId?: string
}

interface Template {
  id: string
  name: string
  description: string | null
  status: 'draft' | 'published'
  /** Setat când conținutul unui șablon publicat s-a schimbat după ultima aplicare în proiecte. */
  unpropagated_changes_at?: string | null
  phases: {
    id: string
    name: string
    project_status_id: string | null
    order_index: number
    activities?: {
      id: string
      name: string
      order_index: number
        document_requirements?: {
          id: string
          name: string
          description: string | null
          is_mandatory: boolean
          is_outgoing?: boolean | null
          requirement_type?: RequirementType | null
          attachment_original_name?: string | null
          attachment_path: string | null
          attachment_missing_at?: string | null
          attachments?: TemplateAttachment[]
        }[]
    }[]
  }[]
}

type TemplateValidationResult = {
  ok: boolean
  errors: Set<string>
  firstMessage: string | null
}

type TemplateDeleteTarget =
  | {
      type: 'template'
      templateId: string
      templateName: string
      phaseCount: number
      activityCount: number
      documentCount: number
    }
  | {
      type: 'phase'
      phaseId: string
      phaseName: string
      activityCount: number
      documentCount: number
      persisted: boolean
    }
  | {
      type: 'activity'
      phaseId: string
      activityId: string
      activityName: string
      documentCount: number
      persisted: boolean
    }
  | {
      type: 'document'
      phaseId: string
      activityId: string
      documentId: string
      documentName: string
      persisted: boolean
    }

interface TemplatePropagationPreviewProject {
  project_id: string
  project_title: string
  eligible: boolean
  blocked_reasons?: string[]
  totals: {
    phases: number
    activities: number
    document_requests: number
  }
}

interface TemplatePropagationPreview {
  template?: {
    id: string
    name: string
  }
  eligible?: TemplatePropagationPreviewProject[]
  ineligible?: TemplatePropagationPreviewProject[]
  totals?: {
    phases: number
    activities: number
    document_requests: number
    candidate_projects?: number
    eligible_projects?: number
    ineligible_projects?: number
  }
}

type PropagationTotals = TemplatePropagationPreviewProject['totals']

function generateId() {
  return Math.random().toString(36).substring(2, 11)
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || generateId()
}

// IDs din DB sunt UUID (36 chars cu cratime), cele locale sunt scurte
function isDbId(id: string): boolean {
  return isPersistentTemplateId(id)
}

function hasPropagationChanges(project: TemplatePropagationPreviewProject) {
  return project.totals.phases + project.totals.activities + project.totals.document_requests > 0
}

function sumPropagationTotals(projects: TemplatePropagationPreviewProject[]): PropagationTotals {
  return projects.reduce(
    (totals, project) => ({
      phases: totals.phases + project.totals.phases,
      activities: totals.activities + project.totals.activities,
      document_requests: totals.document_requests + project.totals.document_requests,
    }),
    { phases: 0, activities: 0, document_requests: 0 }
  )
}

function countTemplateDocuments(template: Template) {
  return (template.phases ?? []).reduce(
    (sum, phase) =>
      sum + (phase.activities ?? []).reduce(
        (activitySum, activity) => activitySum + (activity.document_requirements?.length ?? 0),
        0
      ),
    0
  )
}

function countPhaseDocuments(phase: TemplatePhase) {
  return phase.activities.reduce(
    (sum, activity) => sum + activity.document_requirements.length,
    0
  )
}

function hasMissingTemplateAttachment(doc: DocumentRequirement) {
  return Boolean(doc.templateFileMissingAt || doc.templateAttachments.some(attachment => attachment.missing_at))
}

/** Încărcarea stă lângă Modifică și Șterge, ca pictogramă; textul rămâne în tooltip și pentru cititoare. */
function uploadLabel(doc: DocumentRequirement) {
  const hasFiles = doc.templateAttachments.length > 0 || doc.templateFiles.length > 0
  return `${hasFiles ? 'Adaugă' : 'Atașează'} ${doc.is_outgoing ? 'documente' : 'modele'}`
}

function getDeleteModalText(target: TemplateDeleteTarget | null) {
  if (!target) {
    return {
      title: 'Confirmare ștergere',
      description: 'Această acțiune este permanentă și nu poate fi anulată.',
      confirmText: 'Șterge',
    }
  }

  if (target.type === 'template') {
    return {
      title: `Șterge template-ul "${target.templateName}"?`,
      description: 'Template-ul va fi șters permanent împreună cu toate fazele, activitățile și cererile de document definite în el.',
      confirmText: 'Șterge template-ul',
    }
  }

  if (target.type === 'phase') {
    return {
      title: `Șterge faza "${target.phaseName}"?`,
      description: target.persisted
        ? 'Faza va fi eliminată din template la salvare, împreună cu activitățile și cererile de document din ea.'
        : 'Faza va fi eliminată din formular, împreună cu activitățile și cererile de document din ea.',
      confirmText: 'Șterge faza',
    }
  }

  if (target.type === 'activity') {
    return {
      title: `Șterge activitatea "${target.activityName}"?`,
      description: target.persisted
        ? 'Activitatea va fi eliminată din template la salvare, împreună cu cererile de document din ea.'
        : 'Activitatea va fi eliminată din formular, împreună cu cererile de document din ea.',
      confirmText: 'Șterge activitatea',
    }
  }

  return {
    title: `Șterge cererea "${target.documentName}"?`,
    description: target.persisted
      ? 'Cererea de document va fi eliminată din template la salvare.'
      : 'Cererea de document va fi eliminată din formular.',
    confirmText: 'Șterge cererea',
  }
}

/** Reordonare cu un pas — perechea accesibilă de la tastatură a tragerii cu mouse-ul. */
function moveInArray<T extends { id: string }>(list: T[], id: string, direction: -1 | 1): T[] {
  const index = list.findIndex(item => item.id === id)
  const targetIndex = index + direction
  if (index === -1 || targetIndex < 0 || targetIndex >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(targetIndex, 0, item)
  return next
}

/** Câmpul de formular: etichetă, ajutor vizibil sub câmp și input. */
function Camp({
  label, required, hint, error, children,
}: { label: string; required?: boolean; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">
        {label}{required && <span className="ml-0.5 text-[var(--sg-danger)]" aria-hidden="true">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-[var(--sg-danger)]">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-soft">{hint}</span>
      ) : null}
    </label>
  )
}

const inputClass =
  'h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-10'
const inputErrorClass =
  'h-11 w-full rounded-[var(--radius-plate)] border border-[var(--sg-danger)] bg-[var(--sg-danger-soft)] px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-danger)] sm:h-10'

/** Butoanele-pictogramă ale rândurilor: 32px cu mausul, ca rândurile să rămână joase; 44px la atingere. */
const compactIcon = 'pointer-fine:h-8! pointer-fine:w-8!'

/** Numele fazei și al activității se citesc ca titluri și se editează pe loc; muchia apare la hover și la focus. */
const titleInputClass =
  'rounded-[var(--radius-plate)] border border-transparent bg-transparent px-2 text-ink placeholder:text-ink-faint ' +
  'transition-colors duration-[120ms] hover:border-rule hover:bg-plate focus:border-[var(--sg-accent)] focus:bg-plate'
const titleInputErrorClass = 'border-[var(--sg-danger)]! bg-[var(--sg-danger-soft)]!'

/** Mânerul de tras e doar pentru maus: tragerea HTML nu merge la atingere, acolo rămân săgețile. */
const dragHandleClass = 'hidden shrink-0 cursor-grab p-0.5 text-ink-faint hover:text-ink-soft active:cursor-grabbing pointer-fine:block'

/* Săgețile de reordonare apar la hover sau la focus de la tastatură când există maus; la atingere stau mereu la vedere. */
const revealOnPhaseHover = 'transition-opacity duration-[120ms] pointer-fine:opacity-0 group-hover/phase:opacity-100! has-[:focus-visible]:opacity-100!'
const revealOnActivityHover = 'transition-opacity duration-[120ms] pointer-fine:opacity-0 group-hover/act:opacity-100! has-[:focus-visible]:opacity-100!'
const revealOnDocHover = 'transition-opacity duration-[120ms] pointer-fine:opacity-0 group-hover/doc:opacity-100! has-[:focus-visible]:opacity-100!'

/** Perechea sus/jos — alternativa la tastatură a tragerii cu mouse-ul, cerută de WCAG 2.1.1. */
function ReorderButtons({
  itemLabel, onUp, onDown, disableUp, disableDown, className = '',
}: { itemLabel: string; onUp: () => void; onDown: () => void; disableUp: boolean; disableDown: boolean; className?: string }) {
  return (
    <div className={`flex items-center ${className}`} role="group" aria-label={`Reordonează ${itemLabel}`}>
      <button
        type="button"
        onClick={onUp}
        disabled={disableUp}
        aria-label={`Mută ${itemLabel} mai sus`}
        className="flex h-11 w-10 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 pointer-fine:h-8 pointer-fine:w-6"
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={disableDown}
        aria-label={`Mută ${itemLabel} mai jos`}
        className="flex h-11 w-10 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 pointer-fine:h-8 pointer-fine:w-6"
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

function AdminTemplatesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  // Seniorul editează și șablonele publicate, le șterge și le duplică; publicarea
  // și propagarea rămân la admin. Serverul verifică oricum aceleași reguli.
  const canManageTemplates = isAdmin || (profile?.role === 'consultant' && profile?.consultant_level === 'senior')
  const canEditTemplate = (template: Template) => canManageTemplates || template.status === 'draft'
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const { showToast, confirm } = useToast()

  const [templates, setTemplates] = useState<Template[]>([])
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [templateSearch, setTemplateSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)

  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [phases, setPhases] = useState<TemplatePhase[]>([])
  const [saving, setSaving] = useState(false)
  // Garda salvării, pe lângă `saving`: pe un șablon mare randarea întârzie, iar
  // un al doilea clic apucă butonul încă activ (S-29).
  const savingRef = useRef(false)
  // Formularul de la deschidere (sau de la ultima salvare): „Anulează” întreabă
  // doar dacă s-a schimbat ceva de atunci (D12).
  const formSnapshotRef = useRef<TemplateFormState>({ name: '', description: '', phases: [] })
  // Adminul rămâne în editor până închide propagarea; abia apoi iese în listă.
  const exitAfterPropagationRef = useRef(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Set<string>>(new Set())
  const [consultants, setConsultants] = useState<Consultant[]>([])
  const [deleteTarget, setDeleteTarget] = useState<TemplateDeleteTarget | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [publishTarget, setPublishTarget] = useState<Template | null>(null)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [expandedTemplateIds, setExpandedTemplateIds] = useState<Set<string>>(new Set())
  const deepLinkAppliedRef = useRef(false)

  const toggleTemplateExpanded = (templateId: string) => {
    setExpandedTemplateIds(current => {
      const next = new Set(current)
      if (next.has(templateId)) next.delete(templateId)
      else next.add(templateId)
      return next
    })
  }

  const [addingDocTo, setAddingDocTo] = useState<{ phaseId: string, activityId: string } | null>(null)
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [newDocName, setNewDocName] = useState('')
  const [newDocDescription, setNewDocDescription] = useState('')
  const [newDocOutgoing, setNewDocOutgoing] = useState(false)
  const [newDocCategory, setNewDocCategory] = useState<RequirementType>('obligatoriu')
  const [newDocTemplates, setNewDocTemplates] = useState<File[]>([])
  const [newDocAttachments, setNewDocAttachments] = useState<TemplateAttachment[]>([])
  const newDocFileInputRef = useRef<HTMLInputElement | null>(null)
  const [propagationTemplateId, setPropagationTemplateId] = useState<string | null>(null)
  const [propagationPreview, setPropagationPreview] = useState<TemplatePropagationPreview | null>(null)
  const [propagationSelectedProjectIds, setPropagationSelectedProjectIds] = useState<string[]>([])
  const [propagationApplying, setPropagationApplying] = useState(false)
  const [propagationError, setPropagationError] = useState<string | null>(null)

  // Drag & drop reorder — doar în array-urile locale; handleSave persistă order_index = index + 1
  const [dragItem, setDragItem] = useState<{ kind: 'phase' | 'activity' | 'doc'; parentKey: string; id: string } | null>(null)

  const reorderList = <T extends { id: string }>(list: T[], draggedId: string, targetId: string): T[] => {
    const from = list.findIndex(item => item.id === draggedId)
    const to = list.findIndex(item => item.id === targetId)
    if (from === -1 || to === -1 || from === to) return list
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }

  const handleReorderDragOver = (
    e: React.DragEvent,
    kind: 'phase' | 'activity' | 'doc',
    parentKey: string,
    targetId: string
  ) => {
    // doar în cadrul aceleiași liste (același nivel + același părinte)
    if (!dragItem || dragItem.kind !== kind || dragItem.parentKey !== parentKey) return
    e.preventDefault()
    if (dragItem.id === targetId) return
    if (kind === 'phase') {
      setPhases(prev => reorderList(prev, dragItem.id, targetId))
    } else if (kind === 'activity') {
      setPhases(prev => prev.map(p => p.id === parentKey
        ? { ...p, activities: reorderList(p.activities, dragItem.id, targetId) }
        : p))
    } else {
      const [phaseId, activityId] = parentKey.split(':')
      setPhases(prev => prev.map(p => p.id === phaseId
        ? {
            ...p,
            activities: p.activities.map(a => a.id === activityId
              ? { ...a, document_requirements: reorderList(a.document_requirements, dragItem.id, targetId) }
              : a),
          }
        : p))
    }
  }

  const movePhase = (phaseId: string, direction: -1 | 1) => {
    setPhases(prev => moveInArray(prev, phaseId, direction))
  }

  const moveActivity = (phaseId: string, activityId: string, direction: -1 | 1) => {
    setPhases(prev => prev.map(p => p.id === phaseId
      ? { ...p, activities: moveInArray(p.activities, activityId, direction) }
      : p))
  }

  const moveDocRequirement = (phaseId: string, activityId: string, docId: string, direction: -1 | 1) => {
    setPhases(prev => prev.map(p => p.id === phaseId
      ? {
          ...p,
          activities: p.activities.map(a => a.id === activityId
            ? { ...a, document_requirements: moveInArray(a.document_requirements, docId, direction) }
            : a),
        }
      : p))
  }

  const fetchData = useCallback(async () => {
    try {
      const [templatesRes, statusesRes, usersRes] = await Promise.all([
        apiFetch('/api/admin/templates'),
        apiFetch('/api/admin/statuses'),
        apiFetch('/api/users?state=all'),
      ])
      if (templatesRes.ok) {
        const data = await templatesRes.json()
        setTemplates(data.templates || [])
      }
      if (statusesRes.ok) {
        const data = await statusesRes.json()
        setStatuses(data.statuses || [])
      }
      if (usersRes.ok) {
        const data = await usersRes.json()
        setConsultants((data.users || []).filter((u: any) => u.role === 'consultant'))
      }
    } catch (error) {
      console.error('Eroare:', error)
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    if (!profile) return
    if (profile.role !== 'admin' && profile.role !== 'consultant') { router.replace('/'); return }
    fetchData()
  }, [authLoading, token, profile, router, fetchData])

  // Statusul fazei nu se mai alege în editor; faza nouă îl primește pe primul,
  // ca importul în proiect să meargă ca înainte.
  const addPhase = () => {
    setPhases([...phases, {
      id: generateId(),
      name: '',
      project_status_id: statuses[0]?.id || null,
      activities: [],
      expanded: true
    }])
  }

  const updatePhase = (phaseId: string, updates: Partial<TemplatePhase>) => {
    setPhases(phases.map(p => p.id === phaseId ? { ...p, ...updates } : p))
  }

  const removePhase = (phaseId: string) => {
    setPhases(phases.filter(p => p.id !== phaseId))
  }

  const allPhasesExpanded = phases.length > 0 && phases.every(p => p.expanded)
  const setAllPhasesExpanded = (expanded: boolean) => {
    setPhases(current => current.map(p => ({ ...p, expanded })))
  }

  // Duplicare (#15). Copia primește id-uri locale noi, deci salvarea o creează
  // ca element nou, cu tot cu cererile de documente și fișierele-model.
  const cloneDocRequirement = (doc: DocumentRequirement): DocumentRequirement => ({
    ...doc,
    id: generateId(),
    templateFiles: [...(doc.templateFiles ?? [])],
    templateAttachments: (doc.templateAttachments ?? []).map(attachment => ({ ...attachment })),
    ...duplicationFromSource(doc, 'template_document'),
  })

  const cloneActivity = (activity: TemplateActivity, name: string): TemplateActivity => ({
    ...activity,
    id: generateId(),
    name,
    expanded: true,
    document_requirements: activity.document_requirements.map(cloneDocRequirement),
    ...duplicationFromSource(activity, 'template_activity'),
  })

  const duplicatePhase = (phaseId: string) => {
    const index = phases.findIndex(p => p.id === phaseId)
    if (index === -1) return
    const source = phases[index]
    const copy: TemplatePhase = {
      ...source,
      id: generateId(),
      name: buildCopyName(source.name, phases.map(p => p.name)),
      expanded: true,
      activities: source.activities.map(activity => cloneActivity(activity, activity.name)),
      ...duplicationFromSource(source, 'template_phase'),
    }
    setPhases([...phases.slice(0, index + 1), copy, ...phases.slice(index + 1)])
  }

  const duplicateActivity = (phaseId: string, activityId: string) => {
    setPhases(phases.map(p => {
      if (p.id !== phaseId) return p
      const index = p.activities.findIndex(a => a.id === activityId)
      if (index === -1) return p
      const source = p.activities[index]
      const copy = cloneActivity(source, buildCopyName(source.name, p.activities.map(a => a.name)))
      return {
        ...p,
        activities: [...p.activities.slice(0, index + 1), copy, ...p.activities.slice(index + 1)],
      }
    }))
  }

  const addActivity = (phaseId: string) => {
    setPhases(phases.map(p =>
      p.id === phaseId
        ? { ...p, activities: [...p.activities, { id: generateId(), name: '', document_requirements: [], expanded: true }] }
        : p
    ))
  }

  const updateActivity = (phaseId: string, activityId: string, updates: Partial<TemplateActivity>) => {
    setPhases(phases.map(p =>
      p.id === phaseId
        ? { ...p, activities: p.activities.map(a => a.id === activityId ? { ...a, ...updates } : a) }
        : p
    ))
  }

  const removeActivity = (phaseId: string, activityId: string) => {
    setPhases(phases.map(p =>
      p.id === phaseId
        ? { ...p, activities: p.activities.filter(a => a.id !== activityId) }
        : p
    ))
  }

  const openAddDocModal = (phaseId: string, activityId: string) => {
    setAddingDocTo({ phaseId, activityId })
    setEditingDocId(null)
    setNewDocName('')
    setNewDocDescription('')
    setNewDocOutgoing(false)
    setNewDocCategory('obligatoriu')
    setNewDocTemplates([])
    setNewDocAttachments([])
  }

  const openEditDocModal = (phaseId: string, activityId: string, doc: DocumentRequirement) => {
    setAddingDocTo({ phaseId, activityId })
    setEditingDocId(doc.id)
    setNewDocName(doc.name)
    setNewDocDescription(doc.description)
    setNewDocOutgoing(doc.is_outgoing)
    setNewDocCategory(doc.requirement_type)
    setNewDocTemplates(doc.templateFiles ?? [])
    setNewDocAttachments(doc.templateAttachments ?? [])
  }

  const closeDocModal = () => {
    setAddingDocTo(null)
    setEditingDocId(null)
    setNewDocName('')
    setNewDocDescription('')
    setNewDocOutgoing(false)
    setNewDocCategory('obligatoriu')
    setNewDocTemplates([])
    setNewDocAttachments([])
  }

  const addNewDocTemplateFiles = (files: FileList | null) => {
    const nextFiles = Array.from(files ?? [])
    if (nextFiles.length === 0) return
    setNewDocTemplates(current => [...current, ...nextFiles])
  }

  const confirmAddDoc = () => {
    if (!addingDocTo || !newDocName.trim()) return
    const { phaseId, activityId } = addingDocTo
    if (newDocOutgoing && newDocTemplates.length === 0 && newDocAttachments.length === 0) return
    const docRequirementType: RequirementType = newDocOutgoing ? 'optional' : newDocCategory

    if (editingDocId) {
      const updates: Partial<DocumentRequirement> = {
        name: newDocName.trim(),
        description: newDocDescription.trim(),
        is_outgoing: newDocOutgoing,
        requirement_type: docRequirementType,
      }
      const firstAttachmentName = newDocAttachments[0]?.original_name || newDocAttachments[0]?.storage_path.split('/').pop()
      updates.templateFiles = newDocTemplates
      updates.templateAttachments = newDocAttachments
      updates.templateFileName = firstAttachmentName || newDocTemplates[0]?.name || null
      updates.templateFileMissingAt = newDocAttachments.find(attachment => attachment.missing_at)?.missing_at || null
      updates.templateFileRemoved = newDocAttachments.length === 0 && newDocTemplates.length === 0
      updateDocRequirement(phaseId, activityId, editingDocId, updates)
      closeDocModal()
      return
    }

    const newDoc: DocumentRequirement = {
      id: generateId(),
      name: newDocName.trim(),
      description: newDocDescription.trim(),
      is_outgoing: newDocOutgoing,
      requirement_type: docRequirementType,
      templateFiles: newDocTemplates,
      templateAttachments: [],
      templateFileName: newDocTemplates[0]?.name || null,
      templateFileMissingAt: null,
      templateFileRemoved: false,
    }
    setPhases(phases.map(p =>
      p.id === phaseId
        ? { ...p, activities: p.activities.map(a =>
            a.id === activityId
              ? { ...a, document_requirements: [...a.document_requirements, newDoc] }
              : a
          )}
        : p
    ))
    closeDocModal()
  }

  const removeDocRequirement = (phaseId: string, activityId: string, docId: string) => {
    setPhases(phases.map(p =>
      p.id === phaseId
        ? { ...p, activities: p.activities.map(a =>
            a.id === activityId
              ? { ...a, document_requirements: a.document_requirements.filter(d => d.id !== docId) }
              : a
          )}
        : p
    ))
  }

  const requestDeletePhase = (phase: TemplatePhase) => {
    setDeleteError(null)
    setDeleteTarget({
      type: 'phase',
      phaseId: phase.id,
      phaseName: phase.name.trim() || 'Fază fără nume',
      activityCount: phase.activities.length,
      documentCount: countPhaseDocuments(phase),
      persisted: isDbId(phase.id),
    })
  }

  const requestDeleteActivity = (phaseId: string, activity: TemplateActivity) => {
    setDeleteError(null)
    setDeleteTarget({
      type: 'activity',
      phaseId,
      activityId: activity.id,
      activityName: activity.name.trim() || 'Activitate fără nume',
      documentCount: activity.document_requirements.length,
      persisted: isDbId(activity.id),
    })
  }

  const requestDeleteDocRequirement = (
    phaseId: string,
    activityId: string,
    doc: DocumentRequirement
  ) => {
    setDeleteError(null)
    setDeleteTarget({
      type: 'document',
      phaseId,
      activityId,
      documentId: doc.id,
      documentName: doc.name.trim() || 'Document fără nume',
      persisted: isDbId(doc.id),
    })
  }

  const updateDocRequirement = (
    phaseId: string,
    activityId: string,
    docId: string,
    updates: Partial<DocumentRequirement>
  ) => {
    setPhases(phases.map(p =>
      p.id === phaseId
        ? {
            ...p,
            activities: p.activities.map(a =>
              a.id === activityId
                ? {
                    ...a,
                    document_requirements: a.document_requirements.map(d =>
                      d.id === docId ? { ...d, ...updates } : d
                    )
                  }
                : a
            )
          }
        : p
    ))
  }

  const clearValidationError = (key: string) => {
    setValidationErrors(prev => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setFormError(null)
  }

  const hasValidationError = (key: string) => validationErrors.has(key)

  const validateTemplateForm = (): TemplateValidationResult => {
    const errors = new Set<string>()
    const messages: string[] = []

    if (!templateName.trim()) {
      errors.add('template:name')
      messages.push('Numele template-ului este obligatoriu.')
    }

    phases.forEach((phase, phaseIdx) => {
      const phaseLabel = phase.name.trim() || `Faza ${phaseIdx + 1}`

      if (!phase.name.trim()) {
        errors.add(`phase:${phase.id}:name`)
        messages.push(`Faza ${phaseIdx + 1} nu are nume.`)
      }

      phase.activities.forEach((activity, activityIdx) => {
        const activityLabel = activity.name.trim() || `Activitatea ${activityIdx + 1}`

        if (!activity.name.trim()) {
          errors.add(`activity:${phase.id}:${activity.id}:name`)
          messages.push(`Activitatea ${activityIdx + 1} din faza "${phaseLabel}" nu are nume.`)
        }

        activity.document_requirements.forEach((doc, docIdx) => {
          if (!doc.name.trim()) {
            errors.add(`doc:${phase.id}:${activity.id}:${doc.id}:name`)
            messages.push(`Cererea de document ${docIdx + 1} din activitatea "${activityLabel}" nu are nume.`)
          }
          if (doc.is_outgoing && !doc.templateFileName && doc.templateFiles.length === 0 && doc.templateAttachments.length === 0) {
            errors.add(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`)
            messages.push(`Documentul de trimis "${doc.name.trim() || `#${docIdx + 1}`}" din activitatea "${activityLabel}" nu are fișier atașat.`)
          }
        })
      })
    })

    if (errors.size > 0) {
      setPhases(current =>
        current.map(phase => {
          const phaseHasErrors =
            errors.has(`phase:${phase.id}:name`) ||
            phase.activities.some(activity =>
              errors.has(`activity:${phase.id}:${activity.id}:name`) ||
              activity.document_requirements.some(doc =>
                errors.has(`doc:${phase.id}:${activity.id}:${doc.id}:name`) ||
                errors.has(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`)
              )
            )

          return {
            ...phase,
            expanded: phase.expanded || phaseHasErrors,
            activities: phase.activities.map(activity => {
              const activityHasErrors =
                errors.has(`activity:${phase.id}:${activity.id}:name`) ||
                activity.document_requirements.some(doc =>
                  errors.has(`doc:${phase.id}:${activity.id}:${doc.id}:name`) ||
                  errors.has(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`)
                )

              return {
                ...activity,
                expanded: activity.expanded || activityHasErrors,
              }
            }),
          }
        })
      )
    }

    return {
      ok: errors.size === 0,
      errors,
      firstMessage: messages[0] ?? null,
    }
  }

  const openCreateForm = useCallback(() => {
    formSnapshotRef.current = { name: '', description: '', phases: [] }
    setFormError(null)
    setValidationErrors(new Set())
    setShowForm(true)
  }, [])

  /** Închide editorul fără nicio întrebare; „Anulează” trece prin `requestCancel`. */
  const closeEditor = () => {
    setTemplateName('')
    setTemplateDescription('')
    setPhases([])
    setEditingTemplate(null)
    setFormError(null)
    setValidationErrors(new Set())
    setShowForm(false)
  }

  // Cât se salvează, editorul nu se închide: salvarea ar continua în spate și
  // propagarea ar apărea peste listă (S-29). Cu modificări nesalvate, întreabă.
  const requestCancel = async () => {
    if (savingRef.current) return
    const current = { name: templateName, description: templateDescription, phases }
    if (templateFormDirty(formSnapshotRef.current, current) && !(await confirm({
      title: 'Renunți la modificări?',
      description: 'Ce ai schimbat de la ultima salvare se pierde.',
      confirmText: 'Renunță la modificări',
    }))) return
    closeEditor()
  }

  // Și ieșirea din pagină cere confirmare cât timp salvarea e pe drum.
  useEffect(() => {
    if (!saving) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saving])

  const uploadTemplateFile = async (file: File): Promise<string | null> => {
    try {
      const initRes = await apiFetch('/api/admin/templates/documents/attachment/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, type: file.type, template_id: editingTemplate?.id })
      })
      if (!initRes.ok) return null
      const initData = await initRes.json()
      const uploadRes = await fetch(initData.signedUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'Authorization': `Bearer ${initData.token}` },
        body: file
      })
      if (!uploadRes.ok) return null
      return initData.storagePath
    } catch (error) {
      console.error('Upload error:', error)
      return null
    }
  }

  /** `true` dacă s-a deschis dialogul; altfel a spus deja de ce, ca toast. */
  const openTemplatePropagation = async (templateId: string): Promise<boolean> => {
    const previewRes = await apiFetch(`/api/admin/templates/${templateId}/propagation/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    const previewData = await previewRes.json().catch(() => ({}))
    if (!previewRes.ok) {
      showToast('Nu am putut încărca previzualizarea propagării. Reîncearcă.', 'error')
      return false
    }

    const preview = previewData as TemplatePropagationPreview
    const affectedEligible = (preview.eligible ?? []).filter(hasPropagationChanges)
    const ineligible = preview.ineligible ?? []

    if (affectedEligible.length === 0 && ineligible.length === 0) {
      showToast('Nu există proiecte care necesită propagarea modificărilor.', 'info')
      return false
    }

    setPropagationTemplateId(templateId)
    setPropagationPreview(preview)
    setPropagationSelectedProjectIds(affectedEligible.map(project => project.project_id))
    setPropagationError(null)
    return true
  }

  const closeTemplatePropagation = () => {
    if (propagationApplying) return
    setPropagationTemplateId(null)
    setPropagationPreview(null)
    setPropagationSelectedProjectIds([])
    setPropagationError(null)
    // Propagarea deschisă din editor, după salvare: abia acum se iese în listă.
    if (exitAfterPropagationRef.current) {
      exitAfterPropagationRef.current = false
      closeEditor()
    }
  }

  const togglePropagationProject = (projectId: string) => {
    setPropagationSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter(id => id !== projectId)
        : [...current, projectId]
    )
  }

  const applyTemplatePropagation = async () => {
    if (!propagationTemplateId || propagationSelectedProjectIds.length === 0) return

    setPropagationApplying(true)
    setPropagationError(null)

    try {
      const applyRes = await apiFetch(`/api/admin/templates/${propagationTemplateId}/propagation/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_ids: propagationSelectedProjectIds })
      })
      const applyData = await applyRes.json().catch(() => ({}))
      if (!applyRes.ok) {
        setPropagationError(applyData?.error || 'Propagarea template-ului a eșuat')
        return
      }

      const failedResults = (applyData.results ?? []).filter((result: any) => result.status === 'failed')
      if (failedResults.length > 0) {
        const projectTitles = new Map([
          ...(propagationPreview?.eligible ?? []).map(project => [project.project_id, project.project_title] as const),
          ...(propagationPreview?.ineligible ?? []).map(project => [project.project_id, project.project_title] as const),
        ])
        setPropagationError(
          failedResults
            .map((result: any) => `${projectTitles.get(result.project_id) || result.project_id}: ${result.error || 'Propagarea a eșuat.'}`)
            .join(' ')
        )
        return
      }

      // Ce a rămas neatins spune aplicarea, nu previzualizarea: cererile închise
      // nu se modifică până la redeschidere (#109, D13), iar proiectele încheiate
      // sunt sărite (D8). Fără mesajul ăsta, adminul ar crede că s-a propagat tot.
      // Redeschiderea nu repropagă nimic, iar eticheta „Modificări neaplicate” se
      // stinge oricum (T05), deci mesajul spune ce are de făcut după.
      const results = (applyData.results ?? []) as any[]
      const closedRequests = results.flatMap(result => (result.warnings ?? [])
        .filter((warning: any) => warning.type === 'closed_request')
        .map((warning: any) => warning.name as string))
      const skippedProjects = results.filter(result => result.status === 'skipped').length
      const notes: string[] = []
      if (closedRequests.length > 0) {
        // Aceeași cerere din șablon poate fi închisă în mai multe proiecte: se
        // numără fiecare, dar numele apare o dată.
        const uniqueNames = [...new Set(closedRequests)]
        const names = uniqueNames.slice(0, 3).map(name => `„${name}”`).join(', ')
        notes.push(`${countLabel(closedRequests.length, 'cerere închisă a rămas neschimbată', 'cereri închise au rămas neschimbate')} (${names}${uniqueNames.length > 3 ? ', …' : ''}); după redeschidere, propagă din nou șablonul`)
      }
      if (skippedProjects > 0) notes.push(countLabel(skippedProjects, 'proiect a fost sărit', 'proiecte au fost sărite'))
      if (notes.length > 0) showToast(`Modificările template-ului au fost propagate. ${notes.join('. ')}.`, 'warning')
      else showToast('Modificările template-ului au fost propagate.', 'success')
      const appliedId = propagationTemplateId
      setTemplates(current => current.map(template =>
        template.id === appliedId ? { ...template, unpropagated_changes_at: null } : template))
      closeTemplatePropagation()
    } catch (error: any) {
      setPropagationError(error?.message || 'Propagarea template-ului a eșuat')
    } finally {
      setPropagationApplying(false)
    }
  }

  const handleSave = async () => {
    if (savingRef.current) return
    const validation = validateTemplateForm()
    if (!validation.ok) {
      setValidationErrors(validation.errors)
      setFormError(validation.firstMessage || 'Completează câmpurile obligatorii înainte de salvare.')
      return
    }

    setFormError(null)
    setValidationErrors(new Set())
    savingRef.current = true
    setSaving(true)
    try {
      // Fișierele noi urcă direct în storage, câteva în paralel, înainte de
      // salvare. Apoi tot arborele pleacă într-o singură cerere: serverul
      // compară cu ce are și scrie doar diferențele, grupate pe niveluri.
      const newFiles = phases.flatMap(phase => phase.activities.flatMap(activity =>
        activity.document_requirements.flatMap(doc => doc.templateFiles ?? [])))
      const uploaded = new Map<File, Omit<TemplateAttachment, 'id'>>()
      await mapWithConcurrency(newFiles, 4, async file => {
        const storagePath = await uploadTemplateFile(file)
        if (!storagePath) throw new Error(`Nu s-a putut încărca fișierul "${file.name}"`)
        uploaded.set(file, {
          storage_path: storagePath,
          original_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size: file.size,
        })
      })

      const tree = {
        name: templateName.trim(),
        description: templateDescription.trim() || null,
        phases: phases.map(phase => ({
          id: phase.id,
          name: phase.name,
          project_status_id: phase.project_status_id || null,
          duplication: phase.duplication,
          source_local_id: phase.sourceLocalId,
          activities: phase.activities.map(activity => ({
            id: activity.id,
            name: activity.name,
            default_consultant_id: activity.default_consultant_id || null,
            duplication: activity.duplication,
            source_local_id: activity.sourceLocalId,
            document_requirements: activity.document_requirements.map(doc => ({
              id: doc.id,
              name: doc.name,
              description: doc.description || null,
              is_outgoing: doc.is_outgoing,
              requirement_type: doc.is_outgoing ? 'optional' : doc.requirement_type,
              attachments: [
                ...(doc.templateFileRemoved ? [] : doc.templateAttachments ?? []),
                ...(doc.templateFiles ?? []).map(file => uploaded.get(file)),
              ],
              duplication: doc.duplication,
              source_local_id: doc.sourceLocalId,
            })),
          })),
        })),
      }

      // Slug-ul șablonului se stabilește doar la creare: e un identificator
      // intern, iar regenerat din nume se lovea de unicitate.
      const res = editingTemplate
        ? await apiFetch(`/api/admin/templates/${editingTemplate.id}/tree`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tree),
          })
        : await apiFetch('/api/admin/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...tree, slug: generateSlug(tree.name) }),
          })
      if (!res.ok) {
        throw new Error(await serverMessage(res, `Nu am putut salva șablonul (${res.status})`))
      }
      const saved: Template = (await res.json()).template

      // Arborele salvat vine în răspuns, deci lista nu se mai reîncarcă.
      setTemplates(current => editingTemplate
        ? current.map(template => template.id === saved.id ? saved : template)
        : [saved, ...current])

      if (editingTemplate && editingTemplate.status === 'published') {
        if (isAdmin) {
          // Dialogul de propagare se deschide peste editor; editorul se
          // închide odată cu el (aplicat sau „Mai târziu”).
          if (await openTemplatePropagation(saved.id)) {
            exitAfterPropagationRef.current = true
            formSnapshotRef.current = { name: templateName, description: templateDescription, phases }
            return
          }
        } else {
          showToast('Șablonul a fost salvat. Un administrator poate propaga modificările în proiecte.', 'success')
        }
      }

      closeEditor()
    } catch (error: any) {
      showToast(error?.message || 'Nu am putut salva template-ul. Reîncearcă.', 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const requestDeleteTemplate = (template: Template) => {
    const phaseCount = template.phases?.length ?? 0
    const activityCount = template.phases?.reduce(
      (sum, phase) => sum + (phase.activities?.length ?? 0),
      0
    ) ?? 0

    setDeleteError(null)
    setDeleteTarget({
      type: 'template',
      templateId: template.id,
      templateName: template.name,
      phaseCount,
      activityCount,
      documentCount: countTemplateDocuments(template),
    })
  }

  const duplicateTemplate = async (template: Template) => {
    if (!canManageTemplates || duplicatingId) return
    try {
      setDuplicatingId(template.id)
      const res = await apiFetch(`/api/admin/templates/${template.id}/duplicate`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Nu am putut duplica șablonul.')
      // Copia vine cu tot arborele dintr-o singură cerere; restul listei rămâne.
      const treeRes = await apiFetch(`/api/admin/templates/${data.template.id}`)
      const treeData = await treeRes.json().catch(() => null)
      if (!treeRes.ok || !treeData?.template) throw new Error(treeData?.error || 'Copia a fost creată, dar nu am putut-o încărca.')
      setTemplates(current => [treeData.template, ...current])
      showToast(`Am creat „${treeData.template.name}”.`, 'success')
    } catch (error: any) {
      showToast(error?.message || 'Nu am putut duplica șablonul.', 'error')
    } finally {
      setDuplicatingId(null)
    }
  }

  const requestPublishTemplate = (template: Template) => {
    if (!isAdmin || template.status === 'published') return
    setPublishError(null)
    setPublishTarget(template)
  }

  const closePublishModal = () => {
    if (publishLoading) return
    setPublishTarget(null)
    setPublishError(null)
  }

  const confirmPublishTemplate = async () => {
    if (!publishTarget || !isAdmin || publishTarget.status === 'published') return

    try {
      setPublishLoading(true)
      setPublishError(null)
      const res = await apiFetch(`/api/admin/templates/${publishTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Template-ul nu a putut fi publicat')
      }
      // Se schimbă doar statusul; restul listei rămâne cum e.
      const { template: published } = await res.json()
      setTemplates(current => current.map(template =>
        template.id === published.id ? { ...template, status: published.status } : template))
      setPublishTarget(null)
    } catch (error: any) {
      setPublishError(error?.message || 'Template-ul nu a putut fi publicat')
    } finally {
      setPublishLoading(false)
    }
  }

  const closeDeleteModal = () => {
    if (deleteLoading) return
    setDeleteTarget(null)
    setDeleteError(null)
  }

  const confirmDeleteTarget = async () => {
    if (!deleteTarget) return

    if (deleteTarget.type === 'phase') {
      removePhase(deleteTarget.phaseId)
      setDeleteTarget(null)
      return
    }

    if (deleteTarget.type === 'activity') {
      removeActivity(deleteTarget.phaseId, deleteTarget.activityId)
      setDeleteTarget(null)
      return
    }

    if (deleteTarget.type === 'document') {
      removeDocRequirement(deleteTarget.phaseId, deleteTarget.activityId, deleteTarget.documentId)
      setDeleteTarget(null)
      return
    }

    try {
      setDeleteLoading(true)
      setDeleteError(null)
      const res = await apiFetch(`/api/admin/templates/${deleteTarget.templateId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Eroare la ștergerea template-ului')
      }
      const deletedId = deleteTarget.templateId
      setTemplates(current => current.filter(template => template.id !== deletedId))
      setDeleteTarget(null)
    } catch (error: any) {
      setDeleteError(error?.message || 'Eroare la ștergere')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleEdit = useCallback((template: Template) => {
    if (!(canManageTemplates || template.status === 'draft')) return
    setEditingTemplate(template)
    setTemplateName(template.name)
    setTemplateDescription(template.description || '')
    setFormError(null)
    setValidationErrors(new Set())
    const editablePhases: TemplatePhase[] = template.phases?.map(p => ({
      id: p.id,
      name: p.name,
      project_status_id: p.project_status_id,
      expanded: true,
      activities: p.activities?.map((a: any) => ({
        id: a.id,
        name: a.name,
        expanded: true,
        default_consultant_id: a.default_consultant_id || '',
        document_requirements: a.document_requirements?.map((d: any) => ({
          id: d.id,
          name: d.name,
          description: d.description || '',
          is_outgoing: d.is_outgoing === true,
          requirement_type: normalizeRequirementType(d.requirement_type, d.is_mandatory),
          templateFiles: [],
          templateAttachments: d.attachments?.length
            ? d.attachments
            : d.attachment_path
            ? [{
                id: `legacy-${d.id}`,
                storage_path: d.attachment_path,
                original_name: d.attachment_original_name || null,
                missing_at: d.attachment_missing_at || null,
              }]
            : [],
          templateFileName: d.attachment_original_name || (d.attachment_path ? d.attachment_path.split('/').pop() || null : null),
          templateFileMissingAt: d.attachment_missing_at || d.attachments?.find((attachment: TemplateAttachment) => attachment.missing_at)?.missing_at || null,
          templateFileRemoved: false,
        })) || []
      })) || []
    })) || []
    setPhases(editablePhases)
    formSnapshotRef.current = { name: template.name, description: template.description || '', phases: editablePhases }
    setShowForm(true)
  }, [canManageTemplates])

  // Legătura care lipsea: `/admin` (panoul-director) trimite aici cu
  // ?edit=<id> sau ?new=1 fiindcă lista lui e doar de citit. Fără asta un
  // administrator nu avea cum să ajungă la editarea unui șablon existent.
  useEffect(() => {
    if (loading || deepLinkAppliedRef.current) return
    const editId = searchParams.get('edit')
    const isNew = searchParams.get('new') === '1'
    if (!editId && !isNew) return

    deepLinkAppliedRef.current = true
    if (editId) {
      const target = templates.find(t => t.id === editId)
      if (target && (canManageTemplates || target.status === 'draft')) {
        handleEdit(target)
      } else if (target) {
        showToast('Acest șablon e publicat — doar un administrator sau un consultant senior îl poate edita.', 'info')
      } else {
        showToast('Șablonul căutat nu a fost găsit.', 'error')
      }
    } else if (isNew) {
      openCreateForm()
    }
    router.replace('/admin/templates')
  }, [loading, templates, searchParams, canManageTemplates, handleEdit, openCreateForm, router, showToast])

  const affectedPropagationProjects = (propagationPreview?.eligible ?? []).filter(hasPropagationChanges)
  const selectedPropagationProjects = affectedPropagationProjects.filter(project =>
    propagationSelectedProjectIds.includes(project.project_id)
  )
  const selectedPropagationTotals = sumPropagationTotals(selectedPropagationProjects)
  const allPropagationProjectsSelected =
    affectedPropagationProjects.length > 0 &&
    affectedPropagationProjects.every(project => propagationSelectedProjectIds.includes(project.project_id))
  const deleteModalText = getDeleteModalText(deleteTarget)
  const docModalHasTemplate = Boolean(newDocTemplates.length > 0 || newDocAttachments.length > 0)

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
    )
  }, [templates, templateSearch])

  const formActivityCount = phases.reduce((sum, phase) => sum + phase.activities.length, 0)
  const formSummary = [
    countLabel(phases.length, 'fază', 'faze'),
    countLabel(formActivityCount, 'activitate', 'activități'),
    countLabel(phases.reduce((sum, phase) => sum + countPhaseDocuments(phase), 0), 'cerere de document', 'cereri de documente'),
  ].join(' · ')

  const totalFaze = templates.reduce((sum, template) => sum + template.phases.length, 0)
  const totalActivitati = templates.reduce((sum, template) => sum + template.phases.reduce((count, phase) => count + (phase.activities?.length ?? 0), 0), 0)

  if (authLoading || loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <Spinner size="md" />
        <span className="sr-only">Se încarcă șabloanele…</span>
      </div>
    )
  }

  return (
    <div>
      {/* Lista e pagină din meniu: antet lipit, cu căutarea și „Șablon nou” la
          vedere la orice derulare (S-33). Editorul e nivelul 2: fâșia
          „Șabloane / <nume>”, cu „Șabloane” ca drum înapoi (S-32). */}
      {showForm && (
        <LocationStrip
          segments={[
            { label: 'Șabloane', onClick: () => { void requestCancel() } },
            { label: editingTemplate ? (editingTemplate.name.trim() || 'Șablon fără nume') : 'Șablon nou' },
          ]}
        />
      )}

      {!showForm && (
        <>
          <PageHeader
            title="Șabloane"
            subtitle={`${countLabel(templates.length, 'șablon', 'șabloane')} · ${countLabel(totalFaze, 'fază', 'faze')} · ${countLabel(totalActivitati, 'activitate', 'activități')}`}
            actions={
              <>
                {templates.length > 0 && (
                  <div className="w-full sm:w-72">
                    <SearchInput value={templateSearch} onChange={setTemplateSearch} placeholder="Caută după nume sau descriere…" label="Caută șabloane" />
                  </div>
                )}
                <Button data-tooltip="Pornește un șablon nou de faze și activități" variant="primary" onClick={openCreateForm} aria-label="Șablon nou">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Șablon nou</span>
                </Button>
              </>
            }
          />

          <div className="pb-10">
            {templates.length === 0 ? (
              <EmptyState
                title="Niciun șablon creat"
                action={
                  <Button data-tooltip="Pornește un șablon nou de faze și activități" variant="primary" onClick={openCreateForm}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> Creează primul șablon
                  </Button>
                }
              >
                Un șablon codifică felul în care lucrezi un tip de finanțare: fazele, activitățile și documentele cerute. Creează-l o dată, refolosește-l la fiecare proiect nou.
              </EmptyState>
            ) : filteredTemplates.length === 0 ? (
              <EmptyState
                title="Niciun șablon nu se potrivește"
                action={<Button data-tooltip="Golește căutarea și arată toate șabloanele" variant="secondary" onClick={() => setTemplateSearch('')}>Șterge căutarea</Button>}
              >
                Încearcă alt termen de căutare.
              </EmptyState>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
                <table className="block w-full table-fixed border-collapse text-sm lg:table">
                    <thead className="hidden lg:table-header-group">
                      <tr className="border-b border-rule bg-paper-sunk">
                        {/* Acțiunile au loc rezervat; numele se rupe în lățimea rămasă. */}
                        <th scope="col" className="px-3 py-2 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Șablon</th>
                        <th scope="col" className="w-40 px-3 py-2 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Status</th>
                        <th scope="col" className="w-16 px-3 py-2 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Faze</th>
                        <th scope="col" className="w-24 px-3 py-2 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Activități</th>
                        <th scope="col" className="w-24 px-3 py-2 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Documente</th>
                        <th scope="col" className="w-44 px-3 py-2"><span className="sr-only">Acțiuni</span></th>
                      </tr>
                    </thead>
                    <tbody className="block lg:table-row-group">
                      {filteredTemplates.map((template) => {
                        const phaseCount = template.phases?.length || 0
                        const activityCount = template.phases?.reduce((sum, p) => sum + (p.activities?.length || 0), 0) || 0
                        const expanded = expandedTemplateIds.has(template.id)
                        const detailsId = `faze-template-${template.id}`
                        const editable = canEditTemplate(template)
                        return (
                          <Fragment key={template.id}>
                            <tr
                              onClick={() => phaseCount > 0 && toggleTemplateExpanded(template.id)}
                              className={`flex flex-wrap items-center border-b border-rule last:border-b-0 transition-colors lg:table-row ${phaseCount > 0 ? 'cursor-pointer hover:bg-paper-sunk' : ''} ${expanded ? 'bg-paper-sunk' : ''}`}
                            >
                              <td className="w-full px-3 pb-1 pt-2.5 lg:w-auto lg:py-2">
                                <div className="flex items-center gap-1.5">
                                  {phaseCount > 0 ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); toggleTemplateExpanded(template.id) }}
                                      aria-expanded={expanded}
                                      aria-controls={expanded ? detailsId : undefined}
                                      aria-label={`${expanded ? 'Ascunde' : 'Arată'} fazele — ${template.name}`}
                                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
                                    >
                                      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden />
                                    </button>
                                  ) : (
                                    <span className="w-6 flex-shrink-0" aria-hidden />
                                  )}
                                  <div className="min-w-0 break-words">
                                    <span className="block font-medium text-ink">{template.name}</span>
                                    {template.description && (
                                      <span className="mt-0.5 text-xs leading-5 text-ink-soft line-clamp-1" title={template.description}>{template.description}</span>
                                    )}
                                    <span className="mt-0.5 block text-xs text-ink-faint lg:hidden">
                                      {countLabel(phaseCount, 'fază', 'faze')} · {countLabel(activityCount, 'activitate', 'activități')} · {countLabel(countTemplateDocuments(template), 'document', 'documente')}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="max-w-full px-3 pb-2 lg:py-2">
                                <div className="flex flex-col items-start gap-1">
                                  <Signal tone={template.status === 'draft' ? 'draft' : 'ok'}>
                                    {template.status === 'draft' ? 'Ciornă' : 'Publicat'}
                                  </Signal>
                                  {/* Seniorul poate schimba un șablon publicat, dar numai adminul
                                      aplică schimbarea în proiecte: eticheta e și intrarea spre asta. */}
                                  {isAdmin && template.status === 'published' && template.unpropagated_changes_at && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); void openTemplatePropagation(template.id) }}
                                      title="Deschide aplicarea modificărilor în proiectele existente"
                                      className="max-w-full rounded-[var(--radius-plate)] text-left transition-opacity hover:opacity-80"
                                    >
                                      <Signal tone="warn">Modificări neaplicate în proiecte</Signal>
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="hidden px-3 py-2 text-right tabular-nums text-ink-soft lg:table-cell">{phaseCount}</td>
                              <td className="hidden px-3 py-2 text-right tabular-nums text-ink-soft lg:table-cell">{activityCount}</td>
                              <td className="hidden px-3 py-2 text-right tabular-nums text-ink-soft lg:table-cell">{countTemplateDocuments(template)}</td>
                              <td className="ml-auto px-3 pb-2 lg:ml-0 lg:py-2">
                                <div className="flex flex-wrap items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                  {editable && (
                                    <IconButton className={compactIcon} label={`Editează șablonul ${template.name}`} onClick={() => handleEdit(template)}>
                                      <Edit2 className="h-4 w-4" />
                                    </IconButton>
                                  )}
                                  {isAdmin && template.status === 'draft' && (
                                    <IconButton className={compactIcon} label={`Publică șablonul ${template.name}`} onClick={() => requestPublishTemplate(template)}>
                                      <Check className="h-4 w-4" />
                                    </IconButton>
                                  )}
                                  {canManageTemplates && (
                                    <IconButton
                                      className={compactIcon}
                                      label={`Duplică șablonul ${template.name}`}
                                      disabled={duplicatingId !== null}
                                      onClick={() => { void duplicateTemplate(template) }}
                                    >
                                      {duplicatingId === template.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                                    </IconButton>
                                  )}
                                  {canManageTemplates && (
                                    <IconButton className={compactIcon} label={`Șterge șablonul ${template.name}`} tone="danger" onClick={() => requestDeleteTemplate(template)}>
                                      <Trash2 className="h-4 w-4" />
                                    </IconButton>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {expanded && phaseCount > 0 && (
                              <tr id={detailsId} className="block border-b border-rule bg-paper-sunk last:border-b-0 lg:table-row">
                                <td colSpan={6} className="block break-words px-3 py-2.5 pl-10 lg:table-cell">
                                  {/* Fazele curg pe coloane, în ordine de sus în jos: nouă faze încap în trei rânduri. */}
                                  <ol className="columns-1 gap-x-10 sm:columns-2 xl:columns-3">
                                    {template.phases.map((phase, index) => (
                                      <li key={phase.id} className="flex break-inside-avoid items-baseline gap-x-2.5 py-0.5 text-sm">
                                        {/* Banda după poziție, aceeași pe care faza o poartă în proiect. */}
                                        <span
                                          aria-hidden="true"
                                          className="mt-1 h-3.5 w-[var(--sg-rail)] shrink-0 self-start rounded-[1px]"
                                          style={{ background: bandVar(bandFor(index)) }}
                                        />
                                        <span className="w-5 shrink-0 tabular-nums text-ink-faint">{index + 1}.</span>
                                        <span className="min-w-0 flex-1 font-medium text-ink">{phase.name}</span>
                                        <span className="shrink-0 text-xs text-ink-faint">
                                          {countLabel(phase.activities?.length || 0, 'activitate', 'activități')}
                                        </span>
                                      </li>
                                    ))}
                                  </ol>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showForm && (
        <>
          <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">
            {editingTemplate ? 'Editează șablonul' : 'Șablon nou'}
          </h1>
          <p className="mt-1 hidden text-sm text-ink-soft sm:block">
            {editingTemplate
              ? 'Modifică fazele, activitățile și cererile de documente ale acestui șablon.'
              : 'Definește fazele, activitățile și documentele cerute — un proiect nou pornește de aici.'}
          </p>

          <div className="mt-4 space-y-4">
            {formError && <FeedbackMessage variant="error">{formError}</FeedbackMessage>}

            <Plate className="p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Camp label="Nume șablon" required error={hasValidationError('template:name') ? 'Numele șablonului este obligatoriu.' : null}>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => {
                      setTemplateName(e.target.value)
                      clearValidationError('template:name')
                    }}
                    placeholder="Ex: Proiect Standard"
                    className={hasValidationError('template:name') ? inputErrorClass : inputClass}
                  />
                </Camp>
                <Camp label="Descriere">
                  <input
                    type="text"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Descriere scurtă…"
                    className={inputClass}
                  />
                </Camp>
              </div>
            </Plate>

            <section aria-labelledby="faze-sablon">
              <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
                <h2 id="faze-sablon" className="text-sm font-semibold text-ink">Faze și activități</h2>
                {phases.length > 1 && (
                  <Button data-tooltip={allPhasesExpanded ? 'Închide toate fazele șablonului' : 'Deschide toate fazele șablonului, cu activitățile lor'} variant="quiet" size="sm" onClick={() => setAllPhasesExpanded(!allPhasesExpanded)}>
                    {allPhasesExpanded
                      ? <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" />
                      : <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />}
                    {allPhasesExpanded ? 'Restrânge toate fazele' : 'Extinde toate fazele'}
                  </Button>
                )}
              </div>

              {phases.length === 0 ? (
                <EmptyState title="Nicio fază încă">
                  Un șablon fără faze nu poate fi salvat. Adaugă prima fază pentru a începe să definești fluxul de lucru.
                </EmptyState>
              ) : (
                <div className="space-y-3">
                  {phases.map((phase, phaseIdx) => {
                    const phaseLabel = phase.name || phaseIdx + 1
                    return (
                      <Plate
                        key={phase.id}
                        band={bandFor(phaseIdx)}
                        className={`overflow-hidden !p-0 ${dragItem?.kind === 'phase' && dragItem.id === phase.id ? 'opacity-50' : ''}`}
                      >
                        {/* Capul fazei: numele se citește ca titlu și se editează pe loc. */}
                        <div
                          className={`group/phase flex flex-wrap items-center gap-x-1.5 gap-y-1 bg-paper-sunk px-2 pb-2 pt-3 sm:px-3 ${phase.expanded ? 'border-b border-rule' : ''}`}
                          onDragOver={e => handleReorderDragOver(e, 'phase', '', phase.id)}
                        >
                          <span
                            draggable
                            aria-hidden="true"
                            onDragStart={e => { setDragItem({ kind: 'phase', parentKey: '', id: phase.id }); e.dataTransfer.effectAllowed = 'move' }}
                            onDragEnd={() => setDragItem(null)}
                            title="Trage pentru a reordona"
                            className={dragHandleClass}
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>
                          <IconButton
                            className={compactIcon}
                            label={phase.expanded ? `Restrânge faza ${phaseLabel}` : `Extinde faza ${phaseLabel}`}
                            aria-expanded={phase.expanded}
                            onClick={() => updatePhase(phase.id, { expanded: !phase.expanded })}
                          >
                            <ChevronRight className={`h-4 w-4 transition-transform duration-[120ms] ${phase.expanded ? 'rotate-90' : ''}`} />
                          </IconButton>
                          <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-ink-soft">{phaseIdx + 1}</span>
                          <input
                            type="text"
                            value={phase.name}
                            onChange={(e) => {
                              updatePhase(phase.id, { name: e.target.value })
                              clearValidationError(`phase:${phase.id}:name`)
                            }}
                            placeholder="Nume fază…"
                            aria-label={`Nume pentru faza ${phaseIdx + 1}`}
                            className={`${titleInputClass} h-10 min-w-[10rem] flex-1 text-[15px] font-semibold pointer-fine:h-9 ${
                              hasValidationError(`phase:${phase.id}:name`) ? titleInputErrorClass : ''
                            }`}
                          />
                          <span className="hidden shrink-0 px-1 text-xs text-ink-faint md:inline">
                            {countLabel(phase.activities.length, 'activitate', 'activități')} · {countLabel(countPhaseDocuments(phase), 'document', 'documente')}
                          </span>
                          <div className="ml-auto flex items-center gap-0.5">
                            <ReorderButtons
                              className={revealOnPhaseHover}
                              itemLabel={`faza ${phaseLabel}`}
                              onUp={() => movePhase(phase.id, -1)}
                              onDown={() => movePhase(phase.id, 1)}
                              disableUp={phaseIdx === 0}
                              disableDown={phaseIdx === phases.length - 1}
                            />
                            <IconButton className={compactIcon} label={`Duplică faza ${phaseLabel}`} onClick={() => duplicatePhase(phase.id)}>
                              <Copy className="h-4 w-4" />
                            </IconButton>
                            <IconButton className={compactIcon} label={`Șterge faza ${phaseLabel}`} tone="danger" onClick={() => requestDeletePhase(phase)}>
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          </div>
                        </div>

                        {phase.expanded && (
                          <div className="space-y-3 px-2 py-3 sm:px-3">
                            {hasValidationError(`phase:${phase.id}:name`) && (
                              <p className="text-xs text-[var(--sg-danger)]">
                                Completează numele fazei înainte de salvare.
                              </p>
                            )}

                            {phase.activities.map((activity, activityIdx) => {
                              const activityLabel = activity.name || activityIdx + 1
                              return (
                                <div
                                  key={activity.id}
                                  className={dragItem?.kind === 'activity' && dragItem.id === activity.id ? 'opacity-50' : ''}
                                >
                                  <div
                                    className="group/act flex flex-wrap items-center gap-x-1.5 gap-y-1"
                                    onDragOver={e => handleReorderDragOver(e, 'activity', phase.id, activity.id)}
                                  >
                                    <span
                                      draggable
                                      aria-hidden="true"
                                      onDragStart={e => { setDragItem({ kind: 'activity', parentKey: phase.id, id: activity.id }); e.dataTransfer.effectAllowed = 'move' }}
                                      onDragEnd={() => setDragItem(null)}
                                      title="Trage pentru a reordona"
                                      className={dragHandleClass}
                                    >
                                      <GripVertical className="h-4 w-4" />
                                    </span>
                                    <IconButton
                                      className={compactIcon}
                                      label={activity.expanded ? `Restrânge activitatea ${activityLabel}` : `Extinde activitatea ${activityLabel}`}
                                      aria-expanded={activity.expanded}
                                      onClick={() => updateActivity(phase.id, activity.id, { expanded: !activity.expanded })}
                                    >
                                      <ChevronRight className={`h-4 w-4 transition-transform duration-[120ms] ${activity.expanded ? 'rotate-90' : ''}`} />
                                    </IconButton>
                                    <input
                                      type="text"
                                      value={activity.name}
                                      onChange={(e) => {
                                        updateActivity(phase.id, activity.id, { name: e.target.value })
                                        clearValidationError(`activity:${phase.id}:${activity.id}:name`)
                                      }}
                                      placeholder="Nume activitate…"
                                      aria-label={`Nume pentru activitatea ${activityIdx + 1} din faza ${phaseLabel}`}
                                      className={`${titleInputClass} h-10 min-w-[10rem] flex-1 text-sm font-medium pointer-fine:h-8 ${
                                        hasValidationError(`activity:${phase.id}:${activity.id}:name`) ? titleInputErrorClass : ''
                                      }`}
                                    />
                                    <div className="ml-auto flex items-center gap-0.5">
                                      <select
                                        value={activity.default_consultant_id ?? ''}
                                        onChange={e => updateActivity(phase.id, activity.id, { default_consultant_id: e.target.value || undefined })}
                                        aria-label={`Consultant implicit pentru activitatea ${activityLabel}`}
                                        className="mr-1 h-10 w-44 rounded-[var(--radius-plate)] border border-rule bg-plate px-2 text-xs text-ink-soft transition-colors duration-[120ms] hover:border-rule-strong focus:border-[var(--sg-accent)] pointer-fine:h-8"
                                      >
                                        <option value="">Consultant implicit</option>
                                        {consultants.find(c => c.id === activity.default_consultant_id && c.is_active === false) && (
                                          <option value={activity.default_consultant_id} disabled>{profileDisplayName(consultants.find(c => c.id === activity.default_consultant_id))}</option>
                                        )}
                                        {consultants.filter(c => c.is_active !== false).map(c => (
                                          <option key={c.id} value={c.id}>{profileDisplayName(c)}</option>
                                        ))}
                                      </select>
                                      <ReorderButtons
                                        className={revealOnActivityHover}
                                        itemLabel={`activitatea ${activityLabel}`}
                                        onUp={() => moveActivity(phase.id, activity.id, -1)}
                                        onDown={() => moveActivity(phase.id, activity.id, 1)}
                                        disableUp={activityIdx === 0}
                                        disableDown={activityIdx === phase.activities.length - 1}
                                      />
                                      <IconButton label={`Duplică activitatea ${activityLabel}`} className={compactIcon} onClick={() => duplicateActivity(phase.id, activity.id)}>
                                        <Copy className="h-3.5 w-3.5" />
                                      </IconButton>
                                      <IconButton label={`Șterge activitatea ${activityLabel}`} tone="danger-quiet" className={compactIcon} onClick={() => requestDeleteActivity(phase.id, activity)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </IconButton>
                                    </div>
                                  </div>

                                  {activity.expanded && (
                                    <div className="mt-1.5 sm:ml-14">
                                      {hasValidationError(`activity:${phase.id}:${activity.id}:name`) && (
                                        <p className="mb-1.5 text-xs text-[var(--sg-danger)]">Numele activității este obligatoriu.</p>
                                      )}

                                      {/* Cererile activității: o singură listă cu despărțitoare, nu câte o casetă pentru fiecare. */}
                                      <ul className="divide-y divide-rule overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
                                        {activity.document_requirements.map((doc, docIdx) => {
                                          const docInvalid =
                                            hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:name`) ||
                                            hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`)
                                          return (
                                            <li
                                              key={doc.id}
                                              onDragOver={e => handleReorderDragOver(e, 'doc', `${phase.id}:${activity.id}`, doc.id)}
                                              className={`group/doc flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 ${
                                                docInvalid
                                                  ? 'bg-[var(--sg-danger-soft)]'
                                                  : doc.is_outgoing
                                                  ? 'bg-[var(--sg-accent-soft)]'
                                                  : ''
                                              } ${dragItem?.kind === 'doc' && dragItem.id === doc.id ? 'opacity-50' : ''}`}
                                            >
                                              <span
                                                draggable
                                                aria-hidden="true"
                                                onDragStart={e => { setDragItem({ kind: 'doc', parentKey: `${phase.id}:${activity.id}`, id: doc.id }); e.dataTransfer.effectAllowed = 'move' }}
                                                onDragEnd={() => setDragItem(null)}
                                                title="Trage pentru a reordona"
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
                                                {hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:name`) && (
                                                  <p className="mt-0.5 text-xs text-[var(--sg-danger)]">Numele documentului este obligatoriu.</p>
                                                )}
                                                {hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`) && (
                                                  <p className="mt-0.5 text-xs text-[var(--sg-danger)]">Documentul de trimis are nevoie de fișier atașat.</p>
                                                )}
                                                {doc.description && (
                                                  <p className="mt-0.5 text-xs leading-5 text-ink-soft">{doc.description}</p>
                                                )}
                                                {(doc.templateAttachments.length > 0 || doc.templateFiles.length > 0) && (
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
                                              <div className="ml-auto flex items-center gap-0.5">
                                                <ReorderButtons
                                                  className={revealOnDocHover}
                                                  itemLabel={`cererea ${doc.name || docIdx + 1}`}
                                                  onUp={() => moveDocRequirement(phase.id, activity.id, doc.id, -1)}
                                                  onDown={() => moveDocRequirement(phase.id, activity.id, doc.id, 1)}
                                                  disableUp={docIdx === 0}
                                                  disableDown={docIdx === activity.document_requirements.length - 1}
                                                />
                                                <label
                                                  title={uploadLabel(doc)}
                                                  className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-[var(--sg-accent)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--sg-accent)] pointer-fine:h-8 pointer-fine:w-8"
                                                >
                                                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                                                  <span className="sr-only">{uploadLabel(doc)} — {doc.name || 'cerere fără nume'}</span>
                                                  <input
                                                    type="file"
                                                    className="sr-only"
                                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                                                    multiple
                                                    onChange={(e) => {
                                                      const files = Array.from(e.currentTarget.files ?? [])
                                                      if (files.length === 0) return
                                                      updateDocRequirement(phase.id, activity.id, doc.id, {
                                                        templateFiles: [...doc.templateFiles, ...files],
                                                        templateAttachments: doc.templateAttachments,
                                                        templateFileName: files[0].name,
                                                        templateFileMissingAt: doc.templateAttachments.find(attachment => attachment.missing_at)?.missing_at || null,
                                                        templateFileRemoved: false,
                                                      })
                                                      clearValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`)
                                                      e.currentTarget.value = ''
                                                    }}
                                                  />
                                                </label>
                                                <IconButton label={`Modifică cererea ${doc.name || 'fără nume'}`} className={compactIcon} onClick={() => openEditDocModal(phase.id, activity.id, doc)}>
                                                  <Edit2 className="h-3.5 w-3.5" />
                                                </IconButton>
                                                <IconButton label={`Șterge cererea ${doc.name || 'fără nume'}`} tone="danger-quiet" className={compactIcon} onClick={() => requestDeleteDocRequirement(phase.id, activity.id, doc)}>
                                                  <Trash2 className="h-3.5 w-3.5" />
                                                </IconButton>
                                              </div>
                                            </li>
                                          )
                                        })}
                                        <li>
                                          <button data-tooltip="Adaugă o cerere de document în această activitate"
                                            type="button"
                                            onClick={() => openAddDocModal(phase.id, activity.id)}
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
                            })}
                            <button data-tooltip="Adaugă o activitate nouă în această fază"
                              type="button"
                              onClick={() => addActivity(phase.id)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-plate)] px-2 text-sm font-semibold text-[var(--sg-accent)] transition-colors duration-[120ms] hover:bg-[var(--sg-accent-soft)]"
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" /> Adaugă activitate
                            </button>
                          </div>
                        )}
                      </Plate>
                    )
                  })}
                </div>
              )}

              <button data-tooltip="Adaugă o fază nouă la sfârșitul șablonului"
                type="button"
                onClick={addPhase}
                className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-4 py-2 text-sm font-semibold text-ink-soft transition-colors duration-[120ms] hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] hover:text-[var(--sg-accent)]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Adaugă fază nouă
              </button>
            </section>
          </div>

          {/* Bara de salvare rămâne la vedere: la un șablon cu zeci de cereri,
              butonul de la capătul paginii era la câteva ecrane distanță. */}
          <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-rule bg-paper px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="hidden min-w-0 text-sm leading-5 sm:block">
                <span className="block truncate font-semibold text-ink">
                  {templateName.trim() ? `„${templateName.trim()}”` : 'Șablon fără nume'}
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink-soft">{formSummary}</span>
              </p>
              <div className="flex shrink-0 gap-2">
                {/* Cât se salvează, „Anulează” nu închide nimic, iar butonul de
                    salvare își păstrează lățimea: doar iconița devine spinner.
                    Înainte, „Se salvează…” îl îngusta, iar al doilea clic cădea
                    pe „Anulează” (S-29). */}
                <Button
                  data-tooltip={saving ? 'Așteaptă să se termine salvarea' : 'Închide editorul fără să salvezi'}
                  variant="quiet"
                  className="flex-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-55 sm:flex-none"
                  aria-disabled={saving || undefined}
                  onClick={() => { void requestCancel() }}
                >
                  Anulează
                </Button>
                <Button data-tooltip={editingTemplate ? 'Salvează modificările șablonului' : 'Creează șablonul'}
                  variant="primary"
                  className="flex-1 sm:flex-none"
                  onClick={handleSave}
                  disabled={saving || !templateName.trim()}
                  aria-busy={saving || undefined}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                  {editingTemplate ? 'Salvează modificările' : 'Creează template'}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={closeDeleteModal}
        onConfirm={confirmDeleteTarget}
        title={deleteModalText.title}
        description={deleteModalText.description}
        confirmText={deleteModalText.confirmText}
        confirmWord="sterge"
        loading={deleteLoading}
        error={deleteError}
      >
        {deleteTarget && (
          <div className="rounded-[var(--radius-plate)] border border-rule bg-paper-sunk p-4 text-sm text-ink space-y-2">
            {deleteTarget.type === 'template' && (
              <>
                <p className="font-semibold text-ink">{deleteTarget.templateName}</p>
                <p>
                  Conține {deleteTarget.phaseCount} faze, {deleteTarget.activityCount} activități și {deleteTarget.documentCount} cereri de document.
                </p>
                <p className="text-[var(--sg-danger)]">
                  Dacă template-ul este folosit de proiecte existente, ștergerea va fi blocată.
                </p>
              </>
            )}

            {deleteTarget.type === 'phase' && (
              <>
                <p className="font-semibold text-ink">{deleteTarget.phaseName}</p>
                <p>
                  Include {deleteTarget.activityCount} activități și {deleteTarget.documentCount} cereri de document.
                </p>
              </>
            )}

            {deleteTarget.type === 'activity' && (
              <>
                <p className="font-semibold text-ink">{deleteTarget.activityName}</p>
                <p>Include {deleteTarget.documentCount} cereri de document.</p>
              </>
            )}

            {deleteTarget.type === 'document' && (
              <p className="font-semibold text-ink">{deleteTarget.documentName}</p>
            )}
          </div>
        )}
      </ConfirmDeleteModal>

      <ConfirmDeleteModal
        isOpen={!!publishTarget}
        onClose={closePublishModal}
        onConfirm={confirmPublishTemplate}
        title="Aprobă template-ul"
        description="Template-ul va fi disponibil pentru proiecte noi."
        confirmText="Aprobă"
        confirmWord="aproba"
        confirmReadyText="Poți confirma aprobarea"
        loadingText="Se aprobă..."
        loading={publishLoading}
        error={publishError}
      >
        {publishTarget && (
          <div className="rounded-[var(--radius-plate)] border border-rule bg-paper-sunk p-4 text-sm text-ink space-y-2">
            <p className="font-semibold text-ink">{publishTarget.name}</p>
            <p>După aprobare, dintre consultanți doar seniorii îl mai pot edita.</p>
            <p className="text-[var(--sg-danger)]">Template-ul nu poate reveni la ciornă.</p>
          </div>
        )}
      </ConfirmDeleteModal>

      {propagationPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Scrim onClick={closeTemplatePropagation} />
          <FloatingSurface
            role="dialog"
            ariaModal
            ariaLabel="Propagă modificările template-ului"
            className="relative flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden rounded-[var(--radius-plate-lg)]"
          >
            <div className="flex items-start gap-4 border-b border-rule bg-paper-sunk px-6 py-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-plate)] bg-[var(--sg-accent-soft)]">
                <Layers className="h-5 w-5 text-[var(--sg-accent)]" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 pr-10">
                <h2 id="template-propagation-title" className="text-lg font-bold text-ink">
                  Propagă modificările template-ului
                </h2>
                <p className="mt-1 truncate text-sm text-ink-soft">
                  {propagationPreview.template?.name || 'Template editat'}
                </p>
              </div>
              <IconButton
                label="Închide"
                onClick={closeTemplatePropagation}
                disabled={propagationApplying}
                className="absolute right-4 top-4"
              >
                <X className="h-5 w-5" />
              </IconButton>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] p-3">
                  <p className="text-xs font-medium text-[var(--sg-accent)]">Proiecte selectate</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--sg-accent)]">{selectedPropagationProjects.length}</p>
                </div>
                <div className="rounded-[var(--radius-plate)] border border-rule bg-paper-sunk p-3">
                  <p className="text-xs font-medium text-ink-soft">Faze</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{selectedPropagationTotals.phases}</p>
                </div>
                <div className="rounded-[var(--radius-plate)] border border-rule bg-paper-sunk p-3">
                  <p className="text-xs font-medium text-ink-soft">Activități</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{selectedPropagationTotals.activities}</p>
                </div>
                <div className="rounded-[var(--radius-plate)] border border-rule bg-paper-sunk p-3">
                  <p className="text-xs font-medium text-ink-soft">Cereri document</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{selectedPropagationTotals.document_requests}</p>
                </div>
              </div>

              {propagationError && <FeedbackMessage variant="error">{propagationError}</FeedbackMessage>}

              <section className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Proiecte eligibile</h3>
                    <p className="text-xs text-ink-soft">{affectedPropagationProjects.length} proiect(e) cu modificări</p>
                  </div>
                  {affectedPropagationProjects.length > 0 && (
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                      <input
                        type="checkbox"
                        checked={allPropagationProjectsSelected}
                        onChange={(e) => setPropagationSelectedProjectIds(
                          e.target.checked ? affectedPropagationProjects.map(project => project.project_id) : []
                        )}
                        disabled={propagationApplying}
                        className="h-4 w-4 border-rule-strong text-[var(--sg-accent)]"
                      />
                      Selectează toate
                    </label>
                  )}
                </div>

                <div className="space-y-2">
                  {affectedPropagationProjects.length === 0 && (
                    <div className="rounded-[var(--radius-plate)] border border-rule bg-paper-sunk p-4">
                      <p className="text-sm font-medium text-ink">
                        Nu există proiecte eligibile pentru propagare automată.
                      </p>
                      <p className="mt-1 text-xs text-ink-soft">
                        Verifică proiectele blocate de mai jos pentru motivul exact.
                      </p>
                    </div>
                  )}

                  {affectedPropagationProjects.map((project) => {
                    const checked = propagationSelectedProjectIds.includes(project.project_id)
                    return (
                      <label
                        key={project.project_id}
                        className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-plate)] border p-4 transition-colors duration-[120ms] ${
                          checked
                            ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]'
                            : 'border-rule bg-plate hover:bg-paper-sunk'
                        } ${propagationApplying ? 'cursor-not-allowed opacity-70' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePropagationProject(project.project_id)}
                          disabled={propagationApplying}
                          className="mt-1 h-4 w-4 border-rule-strong text-[var(--sg-accent)]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold text-ink">{project.project_title}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-[var(--radius-plate)] border border-rule bg-plate px-2 py-1 text-xs text-ink-soft">
                              {project.totals.phases} faze
                            </span>
                            <span className="rounded-[var(--radius-plate)] border border-rule bg-plate px-2 py-1 text-xs text-ink-soft">
                              {project.totals.activities} activități
                            </span>
                            <span className="rounded-[var(--radius-plate)] border border-rule bg-plate px-2 py-1 text-xs text-ink-soft">
                              {project.totals.document_requests} cereri
                            </span>
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </section>

              {(propagationPreview.ineligible ?? []).length > 0 && (
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Proiecte blocate</h3>
                    <p className="text-xs text-ink-soft">Nu vor fi modificate automat.</p>
                  </div>
                  <div className="space-y-2">
                    {(propagationPreview.ineligible ?? []).map((project) => (
                      <div key={project.project_id} className="rounded-[var(--radius-plate)] border border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] p-4">
                        <p className="break-words text-sm font-semibold text-[var(--sg-warn)]">{project.project_title}</p>
                        <ul className="mt-2 space-y-1 text-xs text-[var(--sg-warn)]">
                          {(project.blocked_reasons && project.blocked_reasons.length > 0
                            ? project.blocked_reasons
                            : ['Mapping incomplet pentru propagare.']
                          ).map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-rule bg-paper-sunk px-6 py-4 sm:flex-row">
              <Button data-tooltip="Nu propaga acum; proiectele existente rămân cum sunt" variant="secondary" className="sm:flex-1" onClick={closeTemplatePropagation} disabled={propagationApplying}>
                Mai târziu
              </Button>
              <Button data-tooltip="Aplică modificările șablonului și în proiectele care îl folosesc"
                variant="primary"
                className="sm:flex-1"
                onClick={applyTemplatePropagation}
                disabled={propagationApplying || propagationSelectedProjectIds.length === 0}
              >
                {propagationApplying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                {propagationApplying ? 'Se propagă…' : `Propagă în ${propagationSelectedProjectIds.length} proiect(e)`}
              </Button>
            </div>
          </FloatingSurface>
        </div>
      )}

      {/* Modal document */}
      {addingDocTo && createPortal((
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <Scrim onClick={closeDocModal} />
          <FloatingSurface
            role="dialog"
            ariaModal
            ariaLabel={editingDocId ? 'Modifică cererea de document' : 'Adaugă cerere document'}
            className="relative flex w-full max-w-md max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[var(--radius-plate-lg)]"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-rule px-6 py-4">
              <h2 className="font-bold text-ink">{editingDocId ? 'Modifică cererea de document' : 'Adaugă cerere document'}</h2>
              <IconButton label="Închide" onClick={closeDocModal}><X className="h-5 w-5" /></IconButton>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              <Camp label="Nume document" required>
                <input
                  type="text"
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="Ex: Certificat constatator"
                  className={inputClass}
                />
              </Camp>
              <Camp label="Descriere">
                <textarea
                  value={newDocDescription}
                  onChange={(e) => setNewDocDescription(e.target.value)}
                  placeholder="Instrucțiuni pentru client…"
                  rows={3}
                  className="w-full resize-none rounded-[var(--radius-plate)] border border-rule bg-plate px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)]"
                />
              </Camp>
              <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] px-3 py-2">
                <input
                  type="checkbox"
                  checked={newDocOutgoing}
                  onChange={(e) => {
                    setNewDocOutgoing(e.target.checked)
                    if (e.target.checked) setNewDocCategory('optional')
                  }}
                  className="mt-0.5 h-4 w-4 border-rule-strong text-[var(--sg-accent)]"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">Document de trimis (fără răspuns)</span>
                  <span className="block text-xs text-ink-soft">Clientul îl poate descărca, fără upload înapoi.</span>
                </span>
              </label>
              <div>
                <span className="mb-2 block text-sm font-semibold text-ink">
                  {newDocOutgoing ? <>Documente atașate<span className="ml-0.5 text-[var(--sg-danger)]" aria-hidden="true">*</span></> : 'Modele / template-uri (opțional)'}
                </span>
                <input
                  ref={newDocFileInputRef}
                  type="file"
                  onChange={(e) => {
                    addNewDocTemplateFiles(e.currentTarget.files)
                    e.currentTarget.value = ''
                  }}
                  className="sr-only"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                  multiple
                />
                {(newDocAttachments.length > 0 || newDocTemplates.length > 0) ? (
                  <div className="space-y-2 rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] p-3">
                    {newDocAttachments.map(attachment => (
                      <div key={attachment.id} className="flex items-center gap-3">
                        {attachment.missing_at ? (
                          <AlertCircle className="h-4 w-4 shrink-0 text-[var(--sg-warn)]" aria-hidden="true" />
                        ) : (
                          <Paperclip className="h-4 w-4 shrink-0 text-[var(--sg-accent)]" aria-hidden="true" />
                        )}
                        <p className={`flex-1 truncate text-sm font-medium ${attachment.missing_at ? 'text-[var(--sg-warn)]' : 'text-[var(--sg-accent)]'}`}>
                          {attachment.original_name || attachment.storage_path.split('/').pop() || 'fișier atașat'}
                          {attachment.missing_at && <span className="ml-1 text-xs">(indisponibil)</span>}
                        </p>
                        <button data-tooltip="Scoate fișierul-model din listă"
                          type="button"
                          onClick={() => setNewDocAttachments(current => current.filter(item => item.id !== attachment.id))}
                          className="text-xs font-medium text-[var(--sg-danger)] hover:brightness-90"
                        >
                          Elimină
                        </button>
                      </div>
                    ))}
                    {newDocTemplates.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-3">
                        <Paperclip className="h-4 w-4 shrink-0 text-[var(--sg-accent)]" aria-hidden="true" />
                        <p className="flex-1 truncate text-sm font-medium text-[var(--sg-accent)]">{file.name}</p>
                        <p className="text-xs text-[var(--sg-accent)]">{(file.size / 1024).toFixed(1)} KB</p>
                        <button data-tooltip="Scoate fișierul-model din listă"
                          type="button"
                          onClick={() => setNewDocTemplates(current => current.filter((_, fileIndex) => fileIndex !== index))}
                          className="text-xs font-medium text-[var(--sg-danger)] hover:brightness-90"
                        >
                          Elimină
                        </button>
                      </div>
                    ))}
                    <button data-tooltip="Atașează fișiere-model pe care clientul le descarcă și le completează"
                      type="button"
                      onClick={() => newDocFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sg-accent)] hover:text-[var(--sg-accent-ink)]"
                    >
                      <Upload className="h-3 w-3" aria-hidden="true" />
                      Adaugă fișiere
                    </button>
                  </div>
                ) : (
                  <button data-tooltip="Atașează fișiere-model pe care clientul le descarcă și le completează"
                    type="button"
                    onClick={() => newDocFileInputRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-plate)] border-2 border-dashed border-rule p-6 transition-colors duration-[120ms] hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)]"
                  >
                    <Upload className="h-8 w-8 text-ink-faint" aria-hidden="true" />
                    <span className="text-sm font-medium text-ink-soft">Click pentru a adăuga fișiere</span>
                    <span className="text-xs text-ink-faint">PDF, DOC, DOCX, XLS, XLSX, CSV, imagini</span>
                  </button>
                )}
                {newDocOutgoing && !docModalHasTemplate && (
                  <p className="mt-1 text-xs text-[var(--sg-danger)]">Documentul de trimis are nevoie de fișier atașat.</p>
                )}
              </div>
              {!newDocOutgoing && (
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-ink">Tip cerință</legend>
                  <div className="space-y-2">
                    {REQUIREMENT_TYPES.map(rt => (
                      <label key={rt} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="newDocCategoryTemplate"
                          value={rt}
                          checked={newDocCategory === rt}
                          onChange={() => setNewDocCategory(rt)}
                          className="h-4 w-4 border-rule-strong text-[var(--sg-accent)]"
                        />
                        <span className="text-sm text-ink">{REQUIREMENT_LABELS[rt]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
            <div className="flex shrink-0 gap-3 border-t border-rule bg-paper-sunk px-6 py-4">
              <Button data-tooltip="Închide fără să salvezi" variant="secondary" className="flex-1" onClick={closeDocModal}>
                Anulează
              </Button>
              <Button data-tooltip={editingDocId ? 'Salvează cererea de document' : 'Adaugă cererea de document în activitate'}
                variant="primary"
                className="flex-1"
                onClick={confirmAddDoc}
                disabled={!newDocName.trim() || (newDocOutgoing && !docModalHasTemplate)}
              >
                <Check className="h-4 w-4" aria-hidden="true" /> {editingDocId ? 'Salvează' : 'Adaugă'}
              </Button>
            </div>
          </FloatingSurface>
        </div>
      ), document.body)}
    </div>
  )
}

export default function AdminTemplatesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[60vh] items-center justify-center" role="status" aria-live="polite">
          <Spinner size="md" />
        </div>
      }
    >
      <AdminTemplatesContent />
    </Suspense>
  )
}
