/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import {
  Layers, Activity, FileText, ArrowLeft, Plus, Trash2,
  ChevronDown, ChevronRight, Check, X, Paperclip, Upload,
  Loader2, Edit2, AlertCircle, GripVertical, Copy
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
    .replace(/[\u0300-\u036f]/g, '')
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

export default function AdminTemplatesPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEditTemplate = (template: Template) => isAdmin || template.status === 'draft'
  const { showToast } = useToast()

  const [templates, setTemplates] = useState<Template[]>([])
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [loading, setLoading] = useState(true)
  
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

  const getStatusColor = (statusId: string) => statuses.find(s => s.id === statusId)?.color || '#6B7280'

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

  const openCreateForm = () => {
    setFormError(null)
    setValidationErrors(new Set())
    setShowForm(true)
  }

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

  const handleEdit = (template: Template) => {
    if (!canEditTemplate(template)) return
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
  }

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

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-paper-sunk flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper-sunk">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href="/admin" aria-label="Înapoi la șabloane" className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink sm:h-9 sm:w-9">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-2xl font-bold text-ink">Template-uri Proiecte</h1>
            </div>
            <p className="text-ink-soft">Gestionează template-urile pentru crearea rapidă de proiecte</p>
          </div>
          {!showForm && (
            <button
              onClick={openCreateForm}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--sg-accent)] text-white rounded-lg font-medium hover:bg-[var(--sg-accent-ink)]"
            >
              <Plus className="w-4 h-4" /> Template nou
            </button>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-rule shadow-sm mb-6 overflow-hidden">
            <div className="px-6 py-4 bg-paper-sunk border-b border-rule flex items-center justify-between">
              <h2 className="font-semibold text-ink">
                {editingTemplate ? 'Editează Template' : 'Template Nou'}
              </h2>
              <button onClick={resetForm} className="p-1 text-ink-faint hover:text-ink-soft">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {formError && <FeedbackMessage variant="error">{formError}</FeedbackMessage>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Nume template *</label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => {
                      setTemplateName(e.target.value)
                      clearValidationError('template:name')
                    }}
                    placeholder="Ex: Proiect Standard"
                    className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sg-accent)] focus:border-transparent ${
                      hasValidationError('template:name') ? 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)]' : 'border-rule'
                    }`}
                  />
                  {hasValidationError('template:name') && (
                    <p className="mt-1 text-xs text-[var(--sg-danger)]">Numele template-ului este obligatoriu.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Descriere</label>
                  <input
                    type="text"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Descriere scurtă..."
                    className="w-full px-4 py-2 border border-rule rounded-lg focus:ring-2 focus:ring-[var(--sg-accent)] focus:border-transparent"
                  />
                </div>
              </div>

              {/* Faze */}
              <div>
                <label className="block text-sm font-medium text-ink mb-3">Faze și Activități</label>
                <div className="space-y-4">
                  {phases.map((phase, phaseIdx) => (
                    <div
                      key={phase.id}
                      className={`border border-rule rounded-xl overflow-hidden ${
                        dragItem?.kind === 'phase' && dragItem.id === phase.id ? 'opacity-50' : ''
                      }`}
                    >
                      <div
                        className="px-4 py-3 bg-paper-sunk flex items-center gap-3"
                        onDragOver={e => handleReorderDragOver(e, 'phase', '', phase.id)}
                      >
                        <span
                          draggable
                          onDragStart={e => { setDragItem({ kind: 'phase', parentKey: '', id: phase.id }); e.dataTransfer.effectAllowed = 'move' }}
                          onDragEnd={() => setDragItem(null)}
                          title="Trage pentru a reordona"
                          className="-ml-1 p-0.5 rounded text-ink-faint hover:text-ink-soft cursor-grab active:cursor-grabbing"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <button onClick={() => updatePhase(phase.id, { expanded: !phase.expanded })} className="text-ink-faint">
                          {phase.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div 
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: getStatusColor(phase.project_status_id) }}
                        >
                          {phaseIdx + 1}
                        </div>
                        <input
                          type="text"
                          value={phase.name}
                          onChange={(e) => {
                            updatePhase(phase.id, { name: e.target.value })
                            clearValidationError(`phase:${phase.id}:name`)
                          }}
                          placeholder="Nume fază..."
                          className={`flex-1 px-3 py-1.5 border rounded-lg text-sm ${
                            hasValidationError(`phase:${phase.id}:name`) ? 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)]' : 'border-rule'
                          }`}
                        />
                        <select
                          value={phase.project_status_id}
                          onChange={(e) => {
                            updatePhase(phase.id, { project_status_id: e.target.value })
                            clearValidationError(`phase:${phase.id}:project_status_id`)
                          }}
                          className={`px-3 py-1.5 border rounded-lg text-sm ${
                            hasValidationError(`phase:${phase.id}:project_status_id`) ? 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)]' : 'border-rule'
                          }`}
                        >
                          {statuses.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => duplicatePhase(phase.id)}
                          title="Duplică faza cu tot ce conține"
                          aria-label={`Duplică faza ${phase.name || phaseIdx + 1}`}
                          className="p-1.5 text-ink-faint hover:text-[var(--sg-accent)]"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button onClick={() => requestDeletePhase(phase)} className="p-1.5 text-ink-faint hover:text-[var(--sg-danger)]">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {phase.expanded && (
                        <div className="p-4 space-y-3">
                          {(hasValidationError(`phase:${phase.id}:name`) || hasValidationError(`phase:${phase.id}:project_status_id`)) && (
                            <p className="text-xs text-[var(--sg-danger)]">
                              Completează numele fazei și statusul înainte de salvare.
                            </p>
                          )}

                          {phase.activities.map((activity) => (
                            <div
                              key={activity.id}
                              className={`pl-4 border-l-2 border-rule ${
                                dragItem?.kind === 'activity' && dragItem.id === activity.id ? 'opacity-50' : ''
                              }`}
                            >
                              <div
                                className="flex items-center gap-2 mb-2"
                                onDragOver={e => handleReorderDragOver(e, 'activity', phase.id, activity.id)}
                              >
                                <span
                                  draggable
                                  onDragStart={e => { setDragItem({ kind: 'activity', parentKey: phase.id, id: activity.id }); e.dataTransfer.effectAllowed = 'move' }}
                                  onDragEnd={() => setDragItem(null)}
                                  title="Trage pentru a reordona"
                                  className="-ml-1 p-0.5 rounded text-ink-faint hover:text-ink-soft cursor-grab active:cursor-grabbing"
                                >
                                  <GripVertical className="w-3.5 h-3.5" />
                                </span>
                                <Activity className="w-4 h-4 text-ink-faint" />
                                <input
                                  type="text"
                                  value={activity.name}
                                  onChange={(e) => {
                                    updateActivity(phase.id, activity.id, { name: e.target.value })
                                    clearValidationError(`activity:${phase.id}:${activity.id}:name`)
                                  }}
                                  placeholder="Nume activitate..."
                                  className={`flex-1 px-3 py-1.5 border rounded-lg text-sm ${
                                    hasValidationError(`activity:${phase.id}:${activity.id}:name`) ? 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)]' : 'border-rule'
                                  }`}
                                />
                                <select
                                  value={activity.default_consultant_id ?? ''}
                                  onChange={e => updateActivity(phase.id, activity.id, { default_consultant_id: e.target.value || undefined })}
                                  className="text-xs border border-rule rounded-lg px-2 py-1.5 text-ink bg-white focus:border-[var(--sg-accent)] outline-none min-w-[150px]"
                                >
                                  <option value="">Consultant implicit</option>
                                  {consultants.map(c => (
                                    <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                                  ))}
                                </select>
                                <button onClick={() => updateActivity(phase.id, activity.id, { expanded: !activity.expanded })} className="p-1 text-ink-faint">
                                  {activity.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                </button>
                                <button
                                  onClick={() => duplicateActivity(phase.id, activity.id)}
                                  title="Duplică activitatea cu cererile ei"
                                  aria-label={`Duplică activitatea ${activity.name}`}
                                  className="p-1 text-ink-faint hover:text-[var(--sg-accent)]"
                                >
                                  <Copy className="w-4 h-4" />
                                </button>
                                <button onClick={() => requestDeleteActivity(phase.id, activity)} className="p-1 text-ink-faint hover:text-[var(--sg-danger)]">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>

                              {activity.expanded && (
                                <div className="ml-6 space-y-2">
                                  {hasValidationError(`activity:${phase.id}:${activity.id}:name`) && (
                                    <p className="text-xs text-[var(--sg-danger)]">Numele activității este obligatoriu.</p>
                                  )}

                                  {activity.document_requirements.map(doc => (
                                    <div
                                      key={doc.id}
                                      onDragOver={e => handleReorderDragOver(e, 'doc', `${phase.id}:${activity.id}`, doc.id)}
                                      className={`flex items-start gap-2 p-3 rounded-lg border ${
                                        hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:name`) ||
                                        hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`)
                                          ? 'bg-[var(--sg-danger-soft)] border-[var(--sg-danger)]'
                                          : doc.is_outgoing
                                          ? 'bg-[var(--sg-accent-soft)] border-[var(--sg-accent)]'
                                          : 'bg-paper-sunk border-rule'
                                      } ${dragItem?.kind === 'doc' && dragItem.id === doc.id ? 'opacity-50' : ''}`}
                                    >
                                      <span
                                        draggable
                                        onDragStart={e => { setDragItem({ kind: 'doc', parentKey: `${phase.id}:${activity.id}`, id: doc.id }); e.dataTransfer.effectAllowed = 'move' }}
                                        onDragEnd={() => setDragItem(null)}
                                        title="Trage pentru a reordona"
                                        className="-ml-1 mt-0.5 p-0.5 rounded text-ink-faint hover:text-ink-soft cursor-grab active:cursor-grabbing"
                                      >
                                        <GripVertical className="w-3.5 h-3.5" />
                                      </span>
                                      <FileText className={`w-4 h-4 mt-0.5 ${doc.is_outgoing ? 'text-[var(--sg-accent)]' : 'text-ink-faint'}`} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-medium text-sm text-ink">{doc.name || 'Document fără nume'}</span>
                                          {doc.is_outgoing ? (
                                            <span className="text-xs px-1.5 py-0.5 rounded border bg-[var(--sg-accent-soft)] text-[var(--sg-accent)] border-[var(--sg-accent)]">
                                              Document de trimis
                                            </span>
                                          ) : REQUIREMENT_BADGE[doc.requirement_type] && (
                                            <span className={`text-xs px-1.5 py-0.5 rounded border ${REQUIREMENT_BADGE[doc.requirement_type].bg} ${REQUIREMENT_BADGE[doc.requirement_type].text} ${REQUIREMENT_BADGE[doc.requirement_type].border}`}>
                                              {REQUIREMENT_LABELS[doc.requirement_type]}
                                            </span>
                                          )}
                                        </div>
                                        {hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:name`) && (
                                          <p className="text-xs text-[var(--sg-danger)] mt-0.5">Numele documentului este obligatoriu.</p>
                                        )}
                                        {hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:templateFile`) && (
                                          <p className="text-xs text-[var(--sg-danger)] mt-0.5">Documentul de trimis are nevoie de fișier atașat.</p>
                                        )}
                                        {doc.description && (
                                          <p className="text-xs text-ink-soft mt-0.5">{doc.description}</p>
                                        )}
                                        {(doc.templateAttachments.length > 0 || doc.templateFiles.length > 0) && (
                                          <div className={`flex items-center gap-1 mt-1 text-xs ${hasMissingTemplateAttachment(doc) ? 'text-[var(--sg-warn)]' : doc.is_outgoing ? 'text-[var(--sg-accent)]' : 'text-[var(--sg-accent)]'}`}>
                                            {hasMissingTemplateAttachment(doc) ? <AlertCircle className="w-3 h-3" /> : <Paperclip className="w-3 h-3" />}
                                            <span>{[
                                              ...doc.templateAttachments.map(a => `${a.original_name || a.storage_path.split('/').pop() || 'fișier atașat'}${a.missing_at ? ' (indisponibil)' : ''}`),
                                              ...doc.templateFiles.map(file => file.name),
                                            ].filter(Boolean).join(', ')}</span>
                                          </div>
                                        )}
                                        <div className="flex items-center gap-2 mt-2">
                                          <label className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-rule bg-white text-xs text-ink-soft hover:text-[var(--sg-accent)] hover:border-[var(--sg-accent)] cursor-pointer">
                                            <Upload className="w-3 h-3" />
                                            {doc.templateAttachments.length > 0 || doc.templateFiles.length > 0
                                              ? doc.is_outgoing ? 'Adaugă documente' : 'Adaugă modele'
                                              : doc.is_outgoing ? 'Atașează documente' : 'Atașează modele'}
                                            <input
                                              type="file"
                                              className="hidden"
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
                                      <button onClick={() => openEditDocModal(phase.id, activity.id, doc)} className="p-1 text-ink-faint hover:text-[var(--sg-accent)]" title="Modifică cererea">
                                        <Edit2 className="w-4 h-4" />
                                      </button>
                                      <button onClick={() => requestDeleteDocRequirement(phase.id, activity.id, doc)} className="p-1 text-ink-faint hover:text-[var(--sg-danger)]" title="Șterge cererea">
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => openAddDocModal(phase.id, activity.id)}
                                    className="flex items-center gap-1 py-2 px-3 text-xs text-[var(--sg-accent)] hover:text-[var(--sg-accent-ink)] hover:bg-[var(--sg-accent-soft)] rounded-lg"
                                  >
                                    <Plus className="w-3 h-3" /> Adaugă cerere document
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={() => addActivity(phase.id)}
                            className="text-sm text-[var(--sg-accent)] hover:text-[var(--sg-accent-ink)] flex items-center gap-1 ml-4"
                          >
                            <Plus className="w-4 h-4" /> Adaugă activitate
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    onClick={addPhase}
                    className="w-full py-3 border-2 border-dashed border-rule-strong rounded-xl text-ink-soft hover:border-[var(--sg-accent)] hover:text-[var(--sg-accent)] flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" /> Adaugă fază nouă
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-rule">
                <button
                  onClick={resetForm}
                  className="flex-1 px-4 py-2.5 border border-rule rounded-lg text-ink font-medium hover:bg-paper-sunk"
                >
                  Anulează
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !templateName.trim()}
                  className="flex-1 px-4 py-2.5 bg-[var(--sg-accent)] text-white rounded-lg font-medium hover:bg-[var(--sg-accent-ink)] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {saving ? 'Se salvează...' : (editingTemplate ? 'Salvează modificările' : 'Creează template')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Templates list */}
        {!showForm && (
          templates.length === 0 ? (
            <div className="bg-white rounded-xl border border-rule p-12 text-center">
              <Layers className="w-16 h-16 text-ink-faint mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-ink mb-2">Niciun template creat</h3>
              <p className="text-ink-soft mb-4">Creează primul template pentru a genera proiecte rapid</p>
              <button
                onClick={openCreateForm}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--sg-accent)] text-white rounded-lg font-medium hover:bg-[var(--sg-accent-ink)]"
              >
                <Plus className="w-4 h-4" /> Creează template
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-rule overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-rule bg-paper-sunk">
                      <th scope="col" className="px-4 py-2.5 w-full text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft">Nume</th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft whitespace-nowrap">Status</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft whitespace-nowrap">Faze</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-ink-soft whitespace-nowrap">Activități</th>
                      <th scope="col" className="px-4 py-2.5 w-px"><span className="sr-only">Acțiuni</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((template) => {
                      const phaseCount = template.phases?.length || 0
                      const activityCount = template.phases?.reduce((sum, p) => sum + (p.activities?.length || 0), 0) || 0
                      const expanded = expandedTemplateIds.has(template.id)
                      const detailsId = `faze-template-${template.id}`
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
                                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden />
                                  </button>
                                ) : (
                                  <span className="w-6 flex-shrink-0" aria-hidden />
                                )}
                                <span className="font-medium text-ink truncate">{template.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${template.status === 'draft' ? 'bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]' : 'bg-[var(--sg-ok-soft)] text-[var(--sg-ok)]'}`}>
                                {template.status === 'draft' ? 'Ciornă' : 'Publicat'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-soft whitespace-nowrap">{phaseCount}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-soft whitespace-nowrap">{activityCount}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                                {canEditTemplate(template) && (
                                  <button
                                    onClick={() => handleEdit(template)}
                                    className="p-1.5 text-ink-faint hover:text-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] rounded-lg"
                                    title="Editează template-ul"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                )}
                                {isAdmin && template.status === 'draft' && (
                                  <button
                                    onClick={() => requestPublishTemplate(template)}
                                    className="p-1.5 text-ink-faint hover:text-[var(--sg-ok)] hover:bg-[var(--sg-ok-soft)] rounded-lg"
                                    title="Publică template-ul"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                )}
                                {isAdmin && (
                                  <button
                                    onClick={() => requestDeleteTemplate(template)}
                                    className="p-1.5 text-ink-faint hover:text-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)] rounded-lg"
                                    title="Șterge template-ul"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded && phaseCount > 0 && (
                            <tr id={detailsId} className="border-b border-rule bg-paper-sunk last:border-b-0">
                              <td colSpan={5} className="px-4 py-3">
                                <div className="flex items-center gap-2 overflow-x-auto pb-1 pl-7">
                                  {template.phases.map((phase, index) => {
                                    const status = statuses.find(s => s.id === phase.project_status_id)
                                    return (
                                      <div key={phase.id} className="flex items-center flex-shrink-0">
                                        <div
                                          className="px-3 py-1 rounded-full text-xs font-medium text-white"
                                          style={{ backgroundColor: status?.color || '#6B7280' }}
                                        >
                                          {phase.name || `Faza ${index + 1}`}
                                        </div>
                                        {index < template.phases.length - 1 && (
                                          <ChevronRight className="w-4 h-4 text-ink-faint mx-1" />
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
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
          )
        )}
      </div>

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
          <div className="rounded-xl border border-rule bg-paper-sunk p-4 text-sm text-ink space-y-2">
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
          <div className="rounded-xl border border-rule bg-paper-sunk p-4 text-sm text-ink space-y-2">
            <p className="font-semibold text-ink">{publishTarget.name}</p>
            <p>După aprobare, consultanții nu îl mai pot edita.</p>
            <p className="text-[var(--sg-danger)]">Template-ul nu poate reveni la ciornă.</p>
          </div>
        )}
      </ConfirmDeleteModal>

      {propagationPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-propagation-title"
        >
          <div className="absolute inset-0" onClick={closeTemplatePropagation} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-rule bg-paper-sunk flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-[var(--sg-accent-soft)] flex items-center justify-center flex-shrink-0">
                <Layers className="w-5 h-5 text-[var(--sg-accent)]" />
              </div>
              <div className="flex-1 min-w-0 pr-10">
                <h3 id="template-propagation-title" className="text-lg font-semibold text-ink">
                  Propagă modificările template-ului
                </h3>
                <p className="text-sm text-ink-soft mt-1 truncate">
                  {propagationPreview.template?.name || 'Template editat'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeTemplatePropagation}
                disabled={propagationApplying}
                aria-label="Închide"
                className="absolute top-4 right-4 p-2 text-ink-faint hover:text-ink-soft hover:bg-white rounded-lg disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]">
                  <p className="text-xs font-medium text-[var(--sg-accent)]">Proiecte selectate</p>
                  <p className="text-xl font-semibold text-[var(--sg-accent)] mt-1">{selectedPropagationProjects.length}</p>
                </div>
                <div className="p-3 rounded-xl border border-rule bg-paper-sunk">
                  <p className="text-xs font-medium text-ink-soft">Faze</p>
                  <p className="text-xl font-semibold text-ink mt-1">{selectedPropagationTotals.phases}</p>
                </div>
                <div className="p-3 rounded-xl border border-rule bg-paper-sunk">
                  <p className="text-xs font-medium text-ink-soft">Activități</p>
                  <p className="text-xl font-semibold text-ink mt-1">{selectedPropagationTotals.activities}</p>
                </div>
                <div className="p-3 rounded-xl border border-rule bg-paper-sunk">
                  <p className="text-xs font-medium text-ink-soft">Cereri document</p>
                  <p className="text-xl font-semibold text-ink mt-1">{selectedPropagationTotals.document_requests}</p>
                </div>
              </div>

              {propagationError && <FeedbackMessage variant="error">{propagationError}</FeedbackMessage>}

              <section className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">Proiecte eligibile</h4>
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
                        className="w-4 h-4 rounded border-rule-strong text-[var(--sg-accent)]"
                      />
                      Selectează toate
                    </label>
                  )}
                </div>

                <div className="space-y-2">
                  {affectedPropagationProjects.length === 0 && (
                    <div className="p-4 rounded-xl border border-rule bg-paper-sunk">
                      <p className="text-sm font-medium text-ink">
                        Nu există proiecte eligibile pentru propagare automată.
                      </p>
                      <p className="text-xs text-ink-soft mt-1">
                        Verifică proiectele blocate de mai jos pentru motivul exact.
                      </p>
                    </div>
                  )}

                  {affectedPropagationProjects.map((project) => {
                    const checked = propagationSelectedProjectIds.includes(project.project_id)
                    return (
                      <label
                        key={project.project_id}
                        className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                          checked
                            ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]'
                            : 'border-rule bg-white hover:bg-paper-sunk'
                        } ${propagationApplying ? 'cursor-not-allowed opacity-70' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePropagationProject(project.project_id)}
                          disabled={propagationApplying}
                          className="w-4 h-4 rounded border-rule-strong text-[var(--sg-accent)] mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-ink break-words">{project.project_title}</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className="px-2 py-1 rounded-md bg-white border border-rule text-xs text-ink-soft">
                              {project.totals.phases} faze
                            </span>
                            <span className="px-2 py-1 rounded-md bg-white border border-rule text-xs text-ink-soft">
                              {project.totals.activities} activități
                            </span>
                            <span className="px-2 py-1 rounded-md bg-white border border-rule text-xs text-ink-soft">
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
                    <h4 className="text-sm font-semibold text-ink">Proiecte blocate</h4>
                    <p className="text-xs text-ink-soft">Nu vor fi modificate automat.</p>
                  </div>
                  <div className="space-y-2">
                    {(propagationPreview.ineligible ?? []).map((project) => (
                      <div key={project.project_id} className="p-4 rounded-xl border border-[var(--sg-warn)] bg-[var(--sg-warn-soft)]">
                        <p className="text-sm font-semibold text-[var(--sg-warn)] break-words">{project.project_title}</p>
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

            <div className="px-6 py-4 bg-paper-sunk border-t border-rule flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                onClick={closeTemplatePropagation}
                disabled={propagationApplying}
                className="sm:flex-1 px-4 py-2.5 border border-rule rounded-lg text-sm font-medium text-ink hover:bg-white disabled:opacity-50"
              >
                Mai târziu
              </button>
              <button
                type="button"
                onClick={applyTemplatePropagation}
                disabled={propagationApplying || propagationSelectedProjectIds.length === 0}
                className="sm:flex-1 px-4 py-2.5 bg-[var(--sg-accent)] text-white rounded-lg text-sm font-medium hover:bg-[var(--sg-accent-ink)] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {propagationApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {propagationApplying ? 'Se propagă...' : `Propagă în ${propagationSelectedProjectIds.length} proiect(e)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal document */}
      {addingDocTo && createPortal((
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-rule flex items-center justify-between flex-shrink-0">
              <h3 className="font-semibold text-ink">{editingDocId ? 'Modifică cererea de document' : 'Adaugă cerere document'}</h3>
              <button onClick={closeDocModal} className="p-1 text-ink-faint hover:text-ink-soft">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Nume document *</label>
                <input
                  type="text"
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="Ex: Certificat constatator"
                  className="w-full px-3 py-2 border border-rule rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Descriere</label>
                <textarea
                  value={newDocDescription}
                  onChange={(e) => setNewDocDescription(e.target.value)}
                  placeholder="Instrucțiuni pentru client..."
                  rows={3}
                  className="w-full px-3 py-2 border border-rule rounded-lg resize-none"
                />
              </div>
              <label className="flex items-start gap-2 rounded-lg border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newDocOutgoing}
                  onChange={(e) => {
                    setNewDocOutgoing(e.target.checked)
                    if (e.target.checked) setNewDocCategory('optional')
                  }}
                  className="w-4 h-4 mt-0.5 border-rule-strong text-[var(--sg-accent)]"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">Document de trimis (fără răspuns)</span>
                  <span className="block text-xs text-ink-soft">Clientul îl poate descărca, fără upload înapoi.</span>
                </span>
              </label>
              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  {newDocOutgoing ? 'Documente atașate *' : 'Modele / template-uri (opțional)'}
                </label>
                <input
                  ref={newDocFileInputRef}
                  type="file"
                  onChange={(e) => {
                    addNewDocTemplateFiles(e.currentTarget.files)
                    e.currentTarget.value = ''
                  }}
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                  multiple
                />
                {(newDocAttachments.length > 0 || newDocTemplates.length > 0) ? (
                  <div className="p-3 bg-[var(--sg-accent-soft)] border border-[var(--sg-accent)] rounded-lg space-y-2">
                    {newDocAttachments.map(attachment => (
                      <div key={attachment.id} className="flex items-center gap-3">
                        {attachment.missing_at ? (
                          <AlertCircle className="w-4 h-4 text-[var(--sg-warn)] flex-shrink-0" />
                        ) : (
                          <Paperclip className="w-4 h-4 text-[var(--sg-accent)] flex-shrink-0" />
                        )}
                        <p className={`text-sm font-medium truncate flex-1 ${attachment.missing_at ? 'text-[var(--sg-warn)]' : 'text-[var(--sg-accent)]'}`}>
                          {attachment.original_name || attachment.storage_path.split('/').pop() || 'fișier atașat'}
                          {attachment.missing_at && <span className="ml-1 text-xs">(indisponibil)</span>}
                        </p>
                        <button
                          type="button"
                          onClick={() => setNewDocAttachments(current => current.filter(item => item.id !== attachment.id))}
                          className="text-xs text-[var(--sg-danger)] hover:brightness-90"
                        >
                          Elimină
                        </button>
                      </div>
                    ))}
                    {newDocTemplates.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-3">
                        <Paperclip className="w-4 h-4 text-[var(--sg-accent)] flex-shrink-0" />
                        <p className="text-sm font-medium text-[var(--sg-accent)] truncate flex-1">{file.name}</p>
                        <p className="text-xs text-[var(--sg-accent)]">{(file.size / 1024).toFixed(1)} KB</p>
                        <button
                          type="button"
                          onClick={() => setNewDocTemplates(current => current.filter((_, fileIndex) => fileIndex !== index))}
                          className="text-xs text-[var(--sg-danger)] hover:brightness-90"
                        >
                          Elimină
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => newDocFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1 text-xs text-[var(--sg-accent)] hover:text-[var(--sg-accent-ink)]"
                    >
                      <Upload className="w-3 h-3" />
                      Adaugă fișiere
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => newDocFileInputRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-rule rounded-xl cursor-pointer hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)] transition-colors"
                  >
                    <Upload className="w-8 h-8 text-ink-faint" />
                    <span className="text-sm text-ink-soft font-medium">Click pentru a adăuga fișiere</span>
                    <span className="text-xs text-ink-faint">PDF, DOC, DOCX, XLS, XLSX, CSV, imagini</span>
                  </button>
                )}
                {newDocOutgoing && !docModalHasTemplate && (
                  <p className="mt-1 text-xs text-[var(--sg-danger)]">Documentul de trimis are nevoie de fișier atașat.</p>
                )}
              </div>
              {!newDocOutgoing && (
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Tip cerință</label>
                <div className="space-y-2">
                  {REQUIREMENT_TYPES.map(rt => (
                    <label key={rt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="newDocCategoryTemplate"
                        value={rt}
                        checked={newDocCategory === rt}
                        onChange={() => setNewDocCategory(rt)}
                        className="w-4 h-4 border-rule-strong text-[var(--sg-accent)]"
                      />
                      <span className="text-sm text-ink">{REQUIREMENT_LABELS[rt]}</span>
                    </label>
                  ))}
                </div>
              </div>
              )}
            </div>
            <div className="px-6 py-4 bg-paper-sunk border-t border-rule flex gap-3 flex-shrink-0">
              <button
                onClick={closeDocModal}
                className="flex-1 px-4 py-2.5 border border-rule rounded-lg text-sm font-medium text-ink hover:bg-white"
              >
                Anulează
              </button>
              <button
                onClick={confirmAddDoc}
                disabled={!newDocName.trim() || (newDocOutgoing && !docModalHasTemplate)}
                className="flex-1 px-4 py-2.5 bg-[var(--sg-accent)] text-white rounded-lg text-sm font-medium hover:bg-[var(--sg-accent-ink)] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> {editingDocId ? 'Salvează' : 'Adaugă'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
