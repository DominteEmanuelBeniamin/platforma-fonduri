/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Fragment, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  Layers, Activity, FileText, Plus, Trash2,
  ChevronDown, ChevronRight, ChevronUp, Check, X, Paperclip, Upload,
  Loader2, Edit2, AlertCircle, GripVertical, Copy,
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { RequirementType, REQUIREMENT_TYPES, REQUIREMENT_LABELS, REQUIREMENT_BADGE, normalizeRequirementType } from '@/lib/requirement-type'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { useToast } from '@/app/providers/ToastProvider'
import { buildCopyName } from '@/lib/duplicate-name'
import { serverMessage } from '@/lib/api-error'
import {
  duplicationFromSource,
  isPersistentTemplateId,
  resolveDuplicationForSave,
} from '@/app/api/_utils/template-duplication'
import type { TemplateDuplication } from '@/app/api/_utils/template-duplication'
import { Spinner } from '@/components/ui/Spinner'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { Plate } from '@/components/ui/Plate'
import { Signal } from '@/components/ui/Signal'
import { FloatingSurface, Scrim } from '@/components/ui/Surface'

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
  project_status_id: string
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
  phases: {
    id: string
    name: string
    project_status_id: string
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
      <span className="mb-1.5 block text-sm font-semibold text-ink">
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

/** Perechea sus/jos — alternativa la tastatură a tragerii cu mouse-ul, cerută de WCAG 2.1.1. */
function ReorderButtons({
  itemLabel, onUp, onDown, disableUp, disableDown,
}: { itemLabel: string; onUp: () => void; onDown: () => void; disableUp: boolean; disableDown: boolean }) {
  return (
    <div className="flex flex-col" role="group" aria-label={`Reordonează ${itemLabel}`}>
      <button
        type="button"
        onClick={onUp}
        disabled={disableUp}
        aria-label={`Mută ${itemLabel} mai sus`}
        className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={disableDown}
        aria-label={`Mută ${itemLabel} mai jos`}
        className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
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
  const canEditTemplate = (template: Template) => isAdmin || template.status === 'draft'
  const { showToast } = useToast()

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
        apiFetch('/api/users'),
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

  const addPhase = () => {
    setPhases([...phases, {
      id: generateId(),
      name: '',
      project_status_id: statuses[0]?.id || '',
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

  const getStatusColor = (statusId: string) => statuses.find(s => s.id === statusId)?.color || 'var(--sg-rule-strong)'

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

      if (!phase.project_status_id) {
        errors.add(`phase:${phase.id}:project_status_id`)
        messages.push(`Faza "${phaseLabel}" nu are status asociat.`)
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
            errors.has(`phase:${phase.id}:project_status_id`) ||
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
    setFormError(null)
    setValidationErrors(new Set())
    setShowForm(true)
  }, [])

  const resetForm = () => {
    setTemplateName('')
    setTemplateDescription('')
    setPhases([])
    setEditingTemplate(null)
    setFormError(null)
    setValidationErrors(new Set())
    setShowForm(false)
  }

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

  const openTemplatePropagation = async (templateId: string) => {
    const previewRes = await apiFetch(`/api/admin/templates/${templateId}/propagation/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    const previewData = await previewRes.json().catch(() => ({}))
    if (!previewRes.ok) {
      showToast('Nu am putut încărca previzualizarea propagării. Reîncearcă.', 'error')
      return
    }

    const preview = previewData as TemplatePropagationPreview
    const affectedEligible = (preview.eligible ?? []).filter(hasPropagationChanges)
    const ineligible = preview.ineligible ?? []

    if (affectedEligible.length === 0 && ineligible.length === 0) {
      showToast('Nu există proiecte care necesită propagarea modificărilor.', 'info')
      return
    }

    setPropagationTemplateId(templateId)
    setPropagationPreview(preview)
    setPropagationSelectedProjectIds(affectedEligible.map(project => project.project_id))
    setPropagationError(null)
  }

  const closeTemplatePropagation = () => {
    if (propagationApplying) return
    setPropagationTemplateId(null)
    setPropagationPreview(null)
    setPropagationSelectedProjectIds([])
    setPropagationError(null)
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

      showToast('Modificările template-ului au fost propagate.', 'success')
      closeTemplatePropagation()
    } catch (error: any) {
      setPropagationError(error?.message || 'Propagarea template-ului a eșuat')
    } finally {
      setPropagationApplying(false)
    }
  }

  const handleSave = async () => {
    const validation = validateTemplateForm()
    if (!validation.ok) {
      setValidationErrors(validation.errors)
      setFormError(validation.firstMessage || 'Completează câmpurile obligatorii înainte de salvare.')
      return
    }

    setFormError(null)
    setValidationErrors(new Set())
    setSaving(true)
    try {
      const safeParseError = async (res: Response, fallback: string) => {
        return serverMessage(res, `${fallback} (${res.status})`)
      }

      let templateId: string
      const savedIds = new Map<string, string>()

      if (editingTemplate) {
        // PATCH template existent
        const res = await apiFetch(`/api/admin/templates/${editingTemplate.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: templateName.trim(),
            slug: generateSlug(templateName.trim()),
            description: templateDescription.trim() || null,
          })
        })
        if (!res.ok) throw new Error(await safeParseError(res, 'Eroare la actualizare template'))
        templateId = editingTemplate.id

        // Ștergem fazele care au fost eliminate din UI
        const existingPhaseIds = new Set(editingTemplate.phases?.map(p => p.id) || [])
        const currentPhaseIds = new Set(phases.filter(p => isDbId(p.id)).map(p => p.id))
        for (const oldId of existingPhaseIds) {
          if (!currentPhaseIds.has(oldId)) {
            await apiFetch(`/api/admin/templates/phases/${oldId}`, { method: 'DELETE' })
          }
        }
      } else {
        // POST template nou
        const res = await apiFetch('/api/admin/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: templateName.trim(),
            slug: generateSlug(templateName.trim()),
            description: templateDescription.trim() || null,
          })
        })
        if (!res.ok) throw new Error(await safeParseError(res, 'Eroare la creare template'))
        const data = await res.json()
        templateId = data.template.id
      }

      // Salvează fazele
      for (let pIdx = 0; pIdx < phases.length; pIdx++) {
        const phase = phases[pIdx]
        let phaseId: string

        if (isDbId(phase.id)) {
          // PATCH faza existentă
          const phaseRes = await apiFetch(`/api/admin/templates/phases/${phase.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: phase.name,
              project_status_id: phase.project_status_id,
              order_index: pIdx + 1,
            })
          })
          if (!phaseRes.ok) throw new Error(await safeParseError(phaseRes, `Eroare la actualizare faza "${phase.name}"`))
          phaseId = phase.id

          // Ștergem activitățile eliminate
          const originalPhase = editingTemplate?.phases?.find(p => p.id === phase.id)
          const existingActivityIds = new Set(originalPhase?.activities?.map(a => a.id) || [])
          const currentActivityIds = new Set(phase.activities.filter(a => isDbId(a.id)).map(a => a.id))
          for (const oldId of existingActivityIds) {
            if (!currentActivityIds.has(oldId)) {
              await apiFetch(`/api/admin/templates/activities/${oldId}`, { method: 'DELETE' })
            }
          }
        } else {
          // POST faza nouă
          const phaseRes = await apiFetch('/api/admin/templates/phases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              template_id: templateId,
              project_status_id: phase.project_status_id,
              name: phase.name,
              slug: generateSlug(phase.name) || `faza-${pIdx + 1}`,
              order_index: pIdx + 1,
              duplication: resolveDuplicationForSave(phase, savedIds),
            })
          })
          if (!phaseRes.ok) throw new Error(await safeParseError(phaseRes, `Eroare la salvare faza "${phase.name}"`))
          const phaseData = await phaseRes.json()
          phaseId = phaseData.phase.id
          savedIds.set(phase.id, phaseId)
        }

        // Salvează activitățile
        for (let aIdx = 0; aIdx < phase.activities.length; aIdx++) {
          const activity = phase.activities[aIdx]
          let activityId: string

          if (isDbId(activity.id)) {
            // PATCH activitate existentă
            const actRes = await apiFetch(`/api/admin/templates/activities/${activity.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: activity.name,
                order_index: aIdx + 1,
                default_consultant_id: activity.default_consultant_id || null,
              })
            })
            if (!actRes.ok) throw new Error(await safeParseError(actRes, `Eroare la actualizare activitate "${activity.name}"`))
            activityId = activity.id

            // Ștergem documentele eliminate
            const originalPhase = editingTemplate?.phases?.find(p => p.id === phase.id)
            const originalActivity = originalPhase?.activities?.find(a => a.id === activity.id)
            const existingDocIds = new Set(originalActivity?.document_requirements?.map(d => d.id) || [])
            const currentDocIds = new Set(activity.document_requirements.filter(d => isDbId(d.id)).map(d => d.id))
            for (const oldId of existingDocIds) {
              if (!currentDocIds.has(oldId)) {
                await apiFetch(`/api/admin/templates/documents/${oldId}`, { method: 'DELETE' })
              }
            }
          } else {
            // POST activitate nouă
            const actRes = await apiFetch('/api/admin/templates/activities', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                template_phase_id: phaseId,
                name: activity.name,
                order_index: aIdx + 1,
                default_consultant_id: activity.default_consultant_id || null,
                duplication: resolveDuplicationForSave(activity, savedIds),
              })
            })
            if (!actRes.ok) throw new Error(await safeParseError(actRes, `Eroare la salvare activitate "${activity.name}"`))
            const actData = await actRes.json()
            activityId = actData.activity.id
            savedIds.set(activity.id, activityId)
          }

          // Salvează documentele
          for (let dIdx = 0; dIdx < activity.document_requirements.length; dIdx++) {
            const doc = activity.document_requirements[dIdx]
            const attachmentItems: any[] = doc.templateFileRemoved ? [] : [...(doc.templateAttachments ?? [])]
            for (const file of doc.templateFiles ?? []) {
              const uploaded = await uploadTemplateFile(file)
              if (!uploaded) throw new Error(`Nu s-a putut încărca fișierul "${file.name}"`)
              attachmentItems.push({
                storage_path: uploaded,
                original_name: file.name,
                mime_type: file.type || 'application/octet-stream',
                file_size: file.size,
              })
            }
            const firstAttachment = attachmentItems[0] ?? null
            const attachmentPayload = attachmentItems.map((attachment, index) => ({
              ...attachment,
              order_index: index,
            }))

            if (isDbId(doc.id)) {
              // PATCH document existent
              const patchBody: any = {
                name: doc.name,
                description: doc.description || null,
                is_outgoing: doc.is_outgoing,
                requirement_type: doc.is_outgoing ? 'optional' : doc.requirement_type,
                order_index: dIdx + 1,
                attachments: attachmentPayload,
                attachment_path: firstAttachment?.storage_path || null,
                attachment_original_name: firstAttachment?.original_name || null,
              }
              const docRes = await apiFetch(`/api/admin/templates/documents/${doc.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patchBody)
              })
              if (!docRes.ok) throw new Error(await safeParseError(docRes, `Eroare la actualizare document "${doc.name}"`))
            } else {
              // POST document nou
              const docRes = await apiFetch('/api/admin/templates/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  template_activity_id: activityId,
                  name: doc.name,
                  description: doc.description || null,
                  is_outgoing: doc.is_outgoing,
                  requirement_type: doc.is_outgoing ? 'optional' : doc.requirement_type,
                  order_index: dIdx + 1,
                  attachments: attachmentPayload,
                  attachment_path: firstAttachment?.storage_path || null,
                  attachment_original_name: firstAttachment?.original_name || null,
                  duplication: resolveDuplicationForSave(doc, savedIds),
                })
              })
              if (!docRes.ok) throw new Error(await safeParseError(docRes, `Eroare la salvare document "${doc.name}"`))
              const docData = await docRes.json()
              savedIds.set(doc.id, docData.document.id)
            }
          }
        }
      }

      if (editingTemplate && isAdmin && editingTemplate.status === 'published') {
        await openTemplatePropagation(templateId)
      }

      resetForm()
      fetchData()
    } catch (error: any) {
      showToast(error?.message || 'Nu am putut salva template-ul. Reîncearcă.', 'error')
    } finally {
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
      setPublishTarget(null)
      await fetchData()
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
      setDeleteTarget(null)
      await fetchData()
    } catch (error: any) {
      setDeleteError(error?.message || 'Eroare la ștergere')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleEdit = useCallback((template: Template) => {
    if (!(isAdmin || template.status === 'draft')) return
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
    setShowForm(true)
  }, [isAdmin])

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
      if (target && (isAdmin || target.status === 'draft')) {
        handleEdit(target)
      } else if (target) {
        showToast('Acest șablon e publicat — doar un administrator îl poate edita.', 'info')
      } else {
        showToast('Șablonul căutat nu a fost găsit.', 'error')
      }
    } else if (isNew) {
      openCreateForm()
    }
    router.replace('/admin/templates')
  }, [loading, templates, searchParams, isAdmin, handleEdit, openCreateForm, router, showToast])

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
      <LocationStrip
        segments={[
          { label: 'Bonie', href: '/' },
          { label: 'Șabloane', href: '/admin' },
          ...(showForm
            ? [{ label: editingTemplate ? (editingTemplate.name.trim() || 'Șablon fără nume') : 'Șablon nou' }]
            : [{ label: 'Gestionează' }]),
        ]}
        action={
          !showForm ? (
            <Button variant="primary" onClick={openCreateForm}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Șablon nou</span>
            </Button>
          ) : (
            <Button variant="quiet" onClick={resetForm}>
              <X className="h-4 w-4" aria-hidden="true" />
              Renunță
            </Button>
          )
        }
      />

      {!showForm && (
        <>
          <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Șabloane</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {templates.length} {templates.length === 1 ? 'șablon' : 'șabloane'} — creează, editează, publică sau șterge.
          </p>

          {templates.length > 0 && (
            <div className="mt-6 max-w-sm border-b border-rule pb-4">
              <SearchInput value={templateSearch} onChange={setTemplateSearch} placeholder="Caută după nume sau descriere…" label="Caută șabloane" />
            </div>
          )}

          <div className={templates.length > 0 ? 'mt-4 pb-10' : 'mt-6 pb-10'}>
            {templates.length === 0 ? (
              <EmptyState
                title="Niciun șablon creat"
                action={
                  <Button variant="primary" onClick={openCreateForm}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> Creează primul șablon
                  </Button>
                }
              >
                Un șablon codifică felul în care lucrezi un tip de finanțare: fazele, activitățile și documentele cerute. Creează-l o dată, refolosește-l la fiecare proiect nou.
              </EmptyState>
            ) : filteredTemplates.length === 0 ? (
              <EmptyState
                title="Niciun șablon nu se potrivește"
                action={<Button variant="secondary" onClick={() => setTemplateSearch('')}>Șterge căutarea</Button>}
              >
                Încearcă alt termen de căutare.
              </EmptyState>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-plate)] border border-rule bg-plate">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-rule bg-paper-sunk">
                        <th scope="col" className="w-full px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Șablon</th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Status</th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Faze</th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Activități</th>
                        <th scope="col" className="w-px px-4 py-2.5"><span className="sr-only">Acțiuni</span></th>
                      </tr>
                    </thead>
                    <tbody>
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
                              className={`border-b border-rule last:border-b-0 transition-colors ${phaseCount > 0 ? 'cursor-pointer hover:bg-paper-sunk' : ''} ${expanded ? 'bg-paper-sunk' : ''}`}
                            >
                              <td className="px-4 py-3">
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
                                  <div className="min-w-0">
                                    <span className="font-medium text-ink">{template.name}</span>
                                    {template.description && (
                                      <span className="ml-2 truncate text-ink-soft">{template.description}</span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <Signal tone={template.status === 'draft' ? 'draft' : 'ok'}>
                                  {template.status === 'draft' ? 'Ciornă' : 'Publicat'}
                                </Signal>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-ink-soft whitespace-nowrap">{phaseCount}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-ink-soft whitespace-nowrap">{activityCount}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                  {editable && (
                                    <IconButton label={`Editează șablonul ${template.name}`} onClick={() => handleEdit(template)}>
                                      <Edit2 className="h-4 w-4" />
                                    </IconButton>
                                  )}
                                  {isAdmin && template.status === 'draft' && (
                                    <IconButton label={`Publică șablonul ${template.name}`} onClick={() => requestPublishTemplate(template)}>
                                      <Check className="h-4 w-4" />
                                    </IconButton>
                                  )}
                                  {isAdmin && (
                                    <IconButton label={`Șterge șablonul ${template.name}`} tone="danger" onClick={() => requestDeleteTemplate(template)}>
                                      <Trash2 className="h-4 w-4" />
                                    </IconButton>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {expanded && phaseCount > 0 && (
                              <tr id={detailsId} className="border-b border-rule bg-paper-sunk last:border-b-0">
                                <td colSpan={5} className="px-4 py-3 pl-11">
                                  <ol className="flex flex-col gap-2">
                                    {template.phases.map((phase, index) => {
                                      const status = statuses.find(s => s.id === phase.project_status_id)
                                      return (
                                        <li key={phase.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                                          {/* Culoarea statusului e aleasă de administrator, deci nu poate
                                              garanta contrast pe text alb — o purtăm ca semn de identitate
                                              pe muchie, cu numele scris în cerneală. */}
                                          <span
                                            aria-hidden="true"
                                            className="mt-1 h-3.5 w-[var(--sg-rail)] shrink-0 self-start rounded-[1px]"
                                            style={{ background: status?.color || 'var(--sg-rule-strong)' }}
                                          />
                                          <span className="w-5 shrink-0 text-ink-faint">{index + 1}.</span>
                                          <span className="min-w-0 flex-1 font-medium text-ink">{phase.name}</span>
                                          {status && <span className="shrink-0 text-ink-soft">{status.name}</span>}
                                          <span className="shrink-0 text-ink-faint">
                                            {phase.activities?.length || 0} {phase.activities?.length === 1 ? 'activitate' : 'activități'}
                                          </span>
                                        </li>
                                      )
                                    })}
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
              </div>
            )}
          </div>
        </>
      )}

      {showForm && (
        <>
          <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">
            {editingTemplate ? 'Editează șablonul' : 'Șablon nou'}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {editingTemplate
              ? 'Modifică fazele, activitățile și cererile de documente ale acestui șablon.'
              : 'Definește fazele, activitățile și documentele cerute — un proiect nou pornește de aici.'}
          </p>

          <div className="mt-6 space-y-6 pb-16">
            {formError && <FeedbackMessage variant="error">{formError}</FeedbackMessage>}

            <Plate className="p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Faze și activități</h2>
                {phases.length > 0 && (
                  <span className="text-xs text-ink-soft">
                    {phases.length} {phases.length === 1 ? 'fază' : 'faze'}
                  </span>
                )}
              </div>

              {phases.length === 0 ? (
                <EmptyState title="Nicio fază încă">
                  Un șablon fără faze nu poate fi salvat. Adaugă prima fază pentru a începe să definești fluxul de lucru.
                </EmptyState>
              ) : (
                <div className="space-y-4">
                  {phases.map((phase, phaseIdx) => (
                    <Plate
                      key={phase.id}
                      rail={getStatusColor(phase.project_status_id)}
                      className={`overflow-hidden !p-0 ${dragItem?.kind === 'phase' && dragItem.id === phase.id ? 'opacity-50' : ''}`}
                    >
                      <div
                        className="flex items-center gap-2 bg-paper-sunk px-4 py-3"
                        onDragOver={e => handleReorderDragOver(e, 'phase', '', phase.id)}
                      >
                        <span
                          draggable
                          aria-hidden="true"
                          onDragStart={e => { setDragItem({ kind: 'phase', parentKey: '', id: phase.id }); e.dataTransfer.effectAllowed = 'move' }}
                          onDragEnd={() => setDragItem(null)}
                          title="Trage pentru a reordona"
                          className="-ml-1 cursor-grab p-0.5 text-ink-faint hover:text-ink-soft active:cursor-grabbing"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <ReorderButtons
                          itemLabel={`faza ${phase.name || phaseIdx + 1}`}
                          onUp={() => movePhase(phase.id, -1)}
                          onDown={() => movePhase(phase.id, 1)}
                          disableUp={phaseIdx === 0}
                          disableDown={phaseIdx === phases.length - 1}
                        />
                        <IconButton
                          label={phase.expanded ? `Restrânge faza ${phase.name || phaseIdx + 1}` : `Extinde faza ${phase.name || phaseIdx + 1}`}
                          onClick={() => updatePhase(phase.id, { expanded: !phase.expanded })}
                        >
                          {phase.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </IconButton>
                        <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-ink-soft">{phaseIdx + 1}</span>
                        <input
                          type="text"
                          value={phase.name}
                          onChange={(e) => {
                            updatePhase(phase.id, { name: e.target.value })
                            clearValidationError(`phase:${phase.id}:name`)
                          }}
                          placeholder="Nume fază…"
                          aria-label={`Nume pentru faza ${phaseIdx + 1}`}
                          className={`h-10 flex-1 rounded-[var(--radius-plate)] border bg-plate px-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] ${
                            hasValidationError(`phase:${phase.id}:name`) ? 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)]' : 'border-rule'
                          }`}
                        />
                        <select
                          value={phase.project_status_id}
                          onChange={(e) => {
                            updatePhase(phase.id, { project_status_id: e.target.value })
                            clearValidationError(`phase:${phase.id}:project_status_id`)
                          }}
                          aria-label={`Status de proiect pentru faza ${phaseIdx + 1}`}
                          className={`h-10 rounded-[var(--radius-plate)] border bg-plate px-2 text-sm text-ink transition-colors duration-[120ms] focus:border-[var(--sg-accent)] ${
                            hasValidationError(`phase:${phase.id}:project_status_id`) ? 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)]' : 'border-rule'
                          }`}
                        >
                          {statuses.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <IconButton label={`Duplică faza ${phase.name || phaseIdx + 1}`} onClick={() => duplicatePhase(phase.id)}>
                          <Copy className="h-4 w-4" />
                        </IconButton>
                        <IconButton label={`Șterge faza ${phase.name || phaseIdx + 1}`} tone="danger" onClick={() => requestDeletePhase(phase)}>
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>

                      {phase.expanded && (
                        <div className="space-y-3 p-4">
                          {(hasValidationError(`phase:${phase.id}:name`) || hasValidationError(`phase:${phase.id}:project_status_id`)) && (
                            <p className="text-xs text-[var(--sg-danger)]">
                              Completează numele fazei și statusul înainte de salvare.
                            </p>
                          )}

                          {phase.activities.map((activity, activityIdx) => (
                            <div
                              key={activity.id}
                              className={`border-l border-rule pl-4 ${dragItem?.kind === 'activity' && dragItem.id === activity.id ? 'opacity-50' : ''}`}
                            >
                              <div
                                className="mb-2 flex flex-wrap items-center gap-2"
                                onDragOver={e => handleReorderDragOver(e, 'activity', phase.id, activity.id)}
                              >
                                <span
                                  draggable
                                  aria-hidden="true"
                                  onDragStart={e => { setDragItem({ kind: 'activity', parentKey: phase.id, id: activity.id }); e.dataTransfer.effectAllowed = 'move' }}
                                  onDragEnd={() => setDragItem(null)}
                                  title="Trage pentru a reordona"
                                  className="-ml-1 cursor-grab p-0.5 text-ink-faint hover:text-ink-soft active:cursor-grabbing"
                                >
                                  <GripVertical className="h-3.5 w-3.5" />
                                </span>
                                <ReorderButtons
                                  itemLabel={`activitatea ${activity.name || activityIdx + 1}`}
                                  onUp={() => moveActivity(phase.id, activity.id, -1)}
                                  onDown={() => moveActivity(phase.id, activity.id, 1)}
                                  disableUp={activityIdx === 0}
                                  disableDown={activityIdx === phase.activities.length - 1}
                                />
                                <Activity className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                                <input
                                  type="text"
                                  value={activity.name}
                                  onChange={(e) => {
                                    updateActivity(phase.id, activity.id, { name: e.target.value })
                                    clearValidationError(`activity:${phase.id}:${activity.id}:name`)
                                  }}
                                  placeholder="Nume activitate…"
                                  aria-label={`Nume pentru activitatea ${activityIdx + 1} din faza ${phase.name || phaseIdx + 1}`}
                                  className={`h-9 min-w-[160px] flex-1 rounded-[var(--radius-plate)] border bg-plate px-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] ${
                                    hasValidationError(`activity:${phase.id}:${activity.id}:name`) ? 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)]' : 'border-rule'
                                  }`}
                                />
                                <select
                                  value={activity.default_consultant_id ?? ''}
                                  onChange={e => updateActivity(phase.id, activity.id, { default_consultant_id: e.target.value || undefined })}
                                  aria-label={`Consultant implicit pentru activitatea ${activity.name || activityIdx + 1}`}
                                  className="h-9 min-w-[150px] rounded-[var(--radius-plate)] border border-rule bg-plate px-2 text-xs text-ink transition-colors duration-[120ms] focus:border-[var(--sg-accent)]"
                                >
                                  <option value="">Consultant implicit</option>
                                  {consultants.map(c => (
                                    <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                                  ))}
                                </select>
                                <IconButton
                                  label={activity.expanded ? `Restrânge activitatea ${activity.name || activityIdx + 1}` : `Extinde activitatea ${activity.name || activityIdx + 1}`}
                                  className="!h-9 !w-9"
                                  onClick={() => updateActivity(phase.id, activity.id, { expanded: !activity.expanded })}
                                >
                                  {activity.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </IconButton>
                                <IconButton label={`Duplică activitatea ${activity.name || activityIdx + 1}`} className="!h-9 !w-9" onClick={() => duplicateActivity(phase.id, activity.id)}>
                                  <Copy className="h-3.5 w-3.5" />
                                </IconButton>
                                <IconButton label={`Șterge activitatea ${activity.name || activityIdx + 1}`} tone="danger" className="!h-9 !w-9" onClick={() => requestDeleteActivity(phase.id, activity)}>
                                  <X className="h-3.5 w-3.5" />
                                </IconButton>
                              </div>

                              {activity.expanded && (
                                <div className="ml-5 space-y-2">
                                  {hasValidationError(`activity:${phase.id}:${activity.id}:name`) && (
                                    <p className="text-xs text-[var(--sg-danger)]">Numele activității este obligatoriu.</p>
                                  )}

                                  {activity.document_requirements.map((doc, docIdx) => (
                                    <div
                                      key={doc.id}
                                      onDragOver={e => handleReorderDragOver(e, 'doc', `${phase.id}:${activity.id}`, doc.id)}
                                      className={`flex items-start gap-2 rounded-[var(--radius-plate)] border p-3 ${
                                        hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:name`) ||
                                        hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`)
                                          ? 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)]'
                                          : doc.is_outgoing
                                          ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]'
                                          : 'border-rule bg-paper-sunk'
                                      } ${dragItem?.kind === 'doc' && dragItem.id === doc.id ? 'opacity-50' : ''}`}
                                    >
                                      <span
                                        draggable
                                        aria-hidden="true"
                                        onDragStart={e => { setDragItem({ kind: 'doc', parentKey: `${phase.id}:${activity.id}`, id: doc.id }); e.dataTransfer.effectAllowed = 'move' }}
                                        onDragEnd={() => setDragItem(null)}
                                        title="Trage pentru a reordona"
                                        className="-ml-1 mt-0.5 cursor-grab p-0.5 text-ink-faint hover:text-ink-soft active:cursor-grabbing"
                                      >
                                        <GripVertical className="h-3.5 w-3.5" />
                                      </span>
                                      <ReorderButtons
                                        itemLabel={`cererea ${doc.name || docIdx + 1}`}
                                        onUp={() => moveDocRequirement(phase.id, activity.id, doc.id, -1)}
                                        onDown={() => moveDocRequirement(phase.id, activity.id, doc.id, 1)}
                                        disableUp={docIdx === 0}
                                        disableDown={docIdx === activity.document_requirements.length - 1}
                                      />
                                      <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${doc.is_outgoing ? 'text-[var(--sg-accent)]' : 'text-ink-faint'}`} aria-hidden="true" />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-sm font-medium text-ink">{doc.name || 'Document fără nume'}</span>
                                          {doc.is_outgoing ? (
                                            <span className="rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] px-1.5 py-0.5 text-xs text-[var(--sg-accent)]">
                                              Document de trimis
                                            </span>
                                          ) : REQUIREMENT_BADGE[doc.requirement_type] && (
                                            <span className={`rounded-[var(--radius-plate)] border px-1.5 py-0.5 text-xs ${REQUIREMENT_BADGE[doc.requirement_type].bg} ${REQUIREMENT_BADGE[doc.requirement_type].text} ${REQUIREMENT_BADGE[doc.requirement_type].border}`}>
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
                                          <p className="mt-0.5 text-xs text-ink-soft">{doc.description}</p>
                                        )}
                                        {(doc.templateAttachments.length > 0 || doc.templateFiles.length > 0) && (
                                          <div className={`mt-1 flex items-center gap-1 text-xs ${hasMissingTemplateAttachment(doc) ? 'text-[var(--sg-warn)]' : 'text-[var(--sg-accent)]'}`}>
                                            {hasMissingTemplateAttachment(doc) ? <AlertCircle className="h-3 w-3" aria-hidden="true" /> : <Paperclip className="h-3 w-3" aria-hidden="true" />}
                                            <span>{[
                                              ...doc.templateAttachments.map(a => `${a.original_name || a.storage_path.split('/').pop() || 'fișier atașat'}${a.missing_at ? ' (indisponibil)' : ''}`),
                                              ...doc.templateFiles.map(file => file.name),
                                            ].filter(Boolean).join(', ')}</span>
                                          </div>
                                        )}
                                        <div className="mt-2 flex items-center gap-2">
                                          <label className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-plate)] border border-rule bg-plate px-2 py-1 text-xs text-ink-soft hover:border-[var(--sg-accent)] hover:text-[var(--sg-accent)]">
                                            <Upload className="h-3 w-3" aria-hidden="true" />
                                            {doc.templateAttachments.length > 0 || doc.templateFiles.length > 0
                                              ? doc.is_outgoing ? 'Adaugă documente' : 'Adaugă modele'
                                              : doc.is_outgoing ? 'Atașează documente' : 'Atașează modele'}
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
                                        </div>
                                      </div>
                                      <IconButton label={`Modifică cererea ${doc.name || 'fără nume'}`} className="!h-9 !w-9" onClick={() => openEditDocModal(phase.id, activity.id, doc)}>
                                        <Edit2 className="h-3.5 w-3.5" />
                                      </IconButton>
                                      <IconButton label={`Șterge cererea ${doc.name || 'fără nume'}`} tone="danger" className="!h-9 !w-9" onClick={() => requestDeleteDocRequirement(phase.id, activity.id, doc)}>
                                        <X className="h-3.5 w-3.5" />
                                      </IconButton>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => openAddDocModal(phase.id, activity.id)}
                                    className="flex items-center gap-1 rounded-[var(--radius-plate)] px-3 py-2 text-xs font-semibold text-[var(--sg-accent)] transition-colors duration-[120ms] hover:bg-[var(--sg-accent-soft)]"
                                  >
                                    <Plus className="h-3 w-3" aria-hidden="true" /> Adaugă cerere document
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addActivity(phase.id)}
                            className="ml-4 flex items-center gap-1 text-sm font-semibold text-[var(--sg-accent)] transition-colors duration-[120ms] hover:text-[var(--sg-accent-ink)]"
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" /> Adaugă activitate
                          </button>
                        </div>
                      )}
                    </Plate>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={addPhase}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-plate)] border border-dashed border-rule-strong px-4 py-3 text-sm font-semibold text-ink-soft transition-colors duration-[120ms] hover:border-[var(--sg-accent)] hover:text-[var(--sg-accent)]"
              >
                <Plus className="h-5 w-5" aria-hidden="true" /> Adaugă fază nouă
              </button>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-rule pt-4 sm:flex-row">
              <Button variant="secondary" className="sm:flex-1" onClick={resetForm}>
                Anulează
              </Button>
              <Button
                variant="primary"
                className="sm:flex-1"
                onClick={handleSave}
                disabled={saving || !templateName.trim()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                {saving ? 'Se salvează…' : (editingTemplate ? 'Salvează modificările' : 'Creează template')}
              </Button>
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
            <p>După aprobare, consultanții nu îl mai pot edita.</p>
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
              <Button variant="secondary" className="sm:flex-1" onClick={closeTemplatePropagation} disabled={propagationApplying}>
                Mai târziu
              </Button>
              <Button
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
                        <button
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
                        <button
                          type="button"
                          onClick={() => setNewDocTemplates(current => current.filter((_, fileIndex) => fileIndex !== index))}
                          className="text-xs font-medium text-[var(--sg-danger)] hover:brightness-90"
                        >
                          Elimină
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => newDocFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sg-accent)] hover:text-[var(--sg-accent-ink)]"
                    >
                      <Upload className="h-3 w-3" aria-hidden="true" />
                      Adaugă fișiere
                    </button>
                  </div>
                ) : (
                  <button
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
              <Button variant="secondary" className="flex-1" onClick={closeDocModal}>
                Anulează
              </Button>
              <Button
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
