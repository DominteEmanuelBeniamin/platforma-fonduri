/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Layers, Activity, FileText, ArrowLeft, Plus, Trash2,
  ChevronDown, ChevronRight, Check, X, Paperclip, Upload,
  Loader2, Edit2, AlertCircle, GripVertical
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { RequirementType, REQUIREMENT_TYPES, REQUIREMENT_LABELS, REQUIREMENT_BADGE, normalizeRequirementType } from '@/lib/requirement-type'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'

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
  requirement_type: RequirementType
  templateFile: File | null
  templateFileName: string | null
  templateFileMissingAt?: string | null
  templateFileRemoved?: boolean
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
}

interface TemplatePhase {
  id: string
  name: string
  project_status_id: string
  activities: TemplateActivity[]
  expanded: boolean
}

interface Template {
  id: string
  name: string
  description: string | null
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
          requirement_type?: RequirementType | null
          attachment_path: string | null
          attachment_missing_at?: string | null
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
  return id.length === 36 && id.includes('-')
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

  const [addingDocTo, setAddingDocTo] = useState<{ phaseId: string, activityId: string } | null>(null)
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [newDocName, setNewDocName] = useState('')
  const [newDocDescription, setNewDocDescription] = useState('')
  const [newDocCategory, setNewDocCategory] = useState<RequirementType>('obligatoriu')
  const [newDocTemplate, setNewDocTemplate] = useState<File | null>(null)
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

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    if (profile && profile.role !== 'admin') { router.replace('/'); return }
    fetchData()
  }, [authLoading, token, profile, router])

  const fetchData = async () => {
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
  }

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
    setNewDocCategory('obligatoriu')
    setNewDocTemplate(null)
  }

  const openEditDocModal = (phaseId: string, activityId: string, doc: DocumentRequirement) => {
    setAddingDocTo({ phaseId, activityId })
    setEditingDocId(doc.id)
    setNewDocName(doc.name)
    setNewDocDescription(doc.description)
    setNewDocCategory(doc.requirement_type)
    setNewDocTemplate(doc.templateFile)
  }

  const closeDocModal = () => {
    setAddingDocTo(null)
    setEditingDocId(null)
    setNewDocName('')
    setNewDocDescription('')
    setNewDocCategory('obligatoriu')
    setNewDocTemplate(null)
  }

  const confirmAddDoc = () => {
    if (!addingDocTo || !newDocName.trim()) return
    const { phaseId, activityId } = addingDocTo

    if (editingDocId) {
      const updates: Partial<DocumentRequirement> = {
        name: newDocName.trim(),
        description: newDocDescription.trim(),
        requirement_type: newDocCategory,
      }
      // Modelul se actualizează doar dacă s-a ales un fișier nou în modal,
      // ca să nu pierdem modelul existent când editezi doar numele/descrierea.
      if (newDocTemplate) {
        updates.templateFile = newDocTemplate
        updates.templateFileName = newDocTemplate.name
        updates.templateFileMissingAt = null
        updates.templateFileRemoved = false
      }
      updateDocRequirement(phaseId, activityId, editingDocId, updates)
      closeDocModal()
      return
    }

    const newDoc: DocumentRequirement = {
      id: generateId(),
      name: newDocName.trim(),
      description: newDocDescription.trim(),
      requirement_type: newDocCategory,
      templateFile: newDocTemplate,
      templateFileName: newDocTemplate?.name || null,
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
                errors.has(`doc:${phase.id}:${activity.id}:${doc.id}:name`)
              )
            )

          return {
            ...phase,
            expanded: phase.expanded || phaseHasErrors,
            activities: phase.activities.map(activity => {
              const activityHasErrors =
                errors.has(`activity:${phase.id}:${activity.id}:name`) ||
                activity.document_requirements.some(doc =>
                  errors.has(`doc:${phase.id}:${activity.id}:${doc.id}:name`)
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
        body: JSON.stringify({ name: file.name, type: file.type })
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
      alert(previewData?.error || 'Preview-ul de propagare nu a putut fi încărcat')
      return
    }

    const preview = previewData as TemplatePropagationPreview
    const affectedEligible = (preview.eligible ?? []).filter(hasPropagationChanges)
    const ineligible = preview.ineligible ?? []

    if (affectedEligible.length === 0 && ineligible.length === 0) {
      alert('Nu există proiecte care necesită propagarea modificărilor.')
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

      alert('Modificările template-ului au fost propagate în proiectele eligibile.')
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
        try {
          const data = await res.json()
          return data.error || data.message || fallback
        } catch {
          return `${fallback} (${res.status})`
        }
      }

      let templateId: string

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
            })
          })
          if (!phaseRes.ok) throw new Error(await safeParseError(phaseRes, `Eroare la salvare faza "${phase.name}"`))
          const phaseData = await phaseRes.json()
          phaseId = phaseData.phase.id
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
              })
            })
            if (!actRes.ok) throw new Error(await safeParseError(actRes, `Eroare la salvare activitate "${activity.name}"`))
            const actData = await actRes.json()
            activityId = actData.activity.id
          }

          // Salvează documentele
          for (let dIdx = 0; dIdx < activity.document_requirements.length; dIdx++) {
            const doc = activity.document_requirements[dIdx]

            if (isDbId(doc.id)) {
              // PATCH document existent
              let attachmentPath: string | null | undefined = undefined
              if (doc.templateFile) {
                const uploaded = await uploadTemplateFile(doc.templateFile)
                if (uploaded) attachmentPath = uploaded
              } else if (doc.templateFileRemoved) {
                attachmentPath = null
              }
              const patchBody: any = {
                name: doc.name,
                description: doc.description || null,
                requirement_type: doc.requirement_type,
                order_index: dIdx + 1,
              }
              if (attachmentPath !== undefined) {
                patchBody.attachment_path = attachmentPath
                patchBody.attachment_original_name = attachmentPath ? doc.templateFileName : null
              }
              await apiFetch(`/api/admin/templates/documents/${doc.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patchBody)
              })
            } else {
              // POST document nou
              let attachmentPath = null
              if (doc.templateFile) {
                attachmentPath = await uploadTemplateFile(doc.templateFile)
              }
              const docRes = await apiFetch('/api/admin/templates/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  template_activity_id: activityId,
                  name: doc.name,
                  description: doc.description || null,
                  requirement_type: doc.requirement_type,
                  order_index: dIdx + 1,
                  attachment_path: attachmentPath,
                  attachment_original_name: attachmentPath ? doc.templateFileName : null,
                })
              })
              if (!docRes.ok) throw new Error(await safeParseError(docRes, `Eroare la salvare document "${doc.name}"`))
            }
          }
        }
      }

      if (editingTemplate) {
        await openTemplatePropagation(templateId)
      }

      resetForm()
      fetchData()
    } catch (error: any) {
      alert('Eroare: ' + error.message)
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
          requirement_type: normalizeRequirementType(d.requirement_type, d.is_mandatory),
          templateFile: null,
          templateFileName: d.attachment_original_name || (d.attachment_path ? d.attachment_path.split('/').pop() || null : null),
          templateFileMissingAt: d.attachment_missing_at || null,
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

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href="/admin" className="text-slate-400 hover:text-slate-600">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-2xl font-bold text-slate-900">Template-uri Proiecte</h1>
            </div>
            <p className="text-slate-500">Gestionează template-urile pentru crearea rapidă de proiecte</p>
          </div>
          {!showForm && (
            <button
              onClick={openCreateForm}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" /> Template nou
            </button>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
                {editingTemplate ? 'Editează Template' : 'Template Nou'}
              </h2>
              <button onClick={resetForm} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {formError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nume template *</label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => {
                      setTemplateName(e.target.value)
                      clearValidationError('template:name')
                    }}
                    placeholder="Ex: Proiect Standard"
                    className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                      hasValidationError('template:name') ? 'border-red-300 bg-red-50' : 'border-slate-200'
                    }`}
                  />
                  {hasValidationError('template:name') && (
                    <p className="mt-1 text-xs text-red-600">Numele template-ului este obligatoriu.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Descriere</label>
                  <input
                    type="text"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Descriere scurtă..."
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Faze */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">Faze și Activități</label>
                <div className="space-y-4">
                  {phases.map((phase, phaseIdx) => (
                    <div
                      key={phase.id}
                      className={`border border-slate-200 rounded-xl overflow-hidden ${
                        dragItem?.kind === 'phase' && dragItem.id === phase.id ? 'opacity-50' : ''
                      }`}
                    >
                      <div
                        className="px-4 py-3 bg-slate-50 flex items-center gap-3"
                        onDragOver={e => handleReorderDragOver(e, 'phase', '', phase.id)}
                      >
                        <span
                          draggable
                          onDragStart={e => { setDragItem({ kind: 'phase', parentKey: '', id: phase.id }); e.dataTransfer.effectAllowed = 'move' }}
                          onDragEnd={() => setDragItem(null)}
                          title="Trage pentru a reordona"
                          className="-ml-1 p-0.5 rounded text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <button onClick={() => updatePhase(phase.id, { expanded: !phase.expanded })} className="text-slate-400">
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
                            hasValidationError(`phase:${phase.id}:name`) ? 'border-red-300 bg-red-50' : 'border-slate-200'
                          }`}
                        />
                        <select
                          value={phase.project_status_id}
                          onChange={(e) => {
                            updatePhase(phase.id, { project_status_id: e.target.value })
                            clearValidationError(`phase:${phase.id}:project_status_id`)
                          }}
                          className={`px-3 py-1.5 border rounded-lg text-sm ${
                            hasValidationError(`phase:${phase.id}:project_status_id`) ? 'border-red-300 bg-red-50' : 'border-slate-200'
                          }`}
                        >
                          {statuses.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <button onClick={() => requestDeletePhase(phase)} className="p-1.5 text-slate-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {phase.expanded && (
                        <div className="p-4 space-y-3">
                          {(hasValidationError(`phase:${phase.id}:name`) || hasValidationError(`phase:${phase.id}:project_status_id`)) && (
                            <p className="text-xs text-red-600">
                              Completează numele fazei și statusul înainte de salvare.
                            </p>
                          )}

                          {phase.activities.map((activity) => (
                            <div
                              key={activity.id}
                              className={`pl-4 border-l-2 border-slate-200 ${
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
                                  className="-ml-1 p-0.5 rounded text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
                                >
                                  <GripVertical className="w-3.5 h-3.5" />
                                </span>
                                <Activity className="w-4 h-4 text-slate-400" />
                                <input
                                  type="text"
                                  value={activity.name}
                                  onChange={(e) => {
                                    updateActivity(phase.id, activity.id, { name: e.target.value })
                                    clearValidationError(`activity:${phase.id}:${activity.id}:name`)
                                  }}
                                  placeholder="Nume activitate..."
                                  className={`flex-1 px-3 py-1.5 border rounded-lg text-sm ${
                                    hasValidationError(`activity:${phase.id}:${activity.id}:name`) ? 'border-red-300 bg-red-50' : 'border-slate-200'
                                  }`}
                                />
                                <select
                                  value={activity.default_consultant_id ?? ''}
                                  onChange={e => updateActivity(phase.id, activity.id, { default_consultant_id: e.target.value || undefined })}
                                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 bg-white focus:border-indigo-400 outline-none min-w-[150px]"
                                >
                                  <option value="">Consultant implicit</option>
                                  {consultants.map(c => (
                                    <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                                  ))}
                                </select>
                                <button onClick={() => updateActivity(phase.id, activity.id, { expanded: !activity.expanded })} className="p-1 text-slate-400">
                                  {activity.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                </button>
                                <button onClick={() => requestDeleteActivity(phase.id, activity)} className="p-1 text-slate-400 hover:text-red-500">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>

                              {activity.expanded && (
                                <div className="ml-6 space-y-2">
                                  {hasValidationError(`activity:${phase.id}:${activity.id}:name`) && (
                                    <p className="text-xs text-red-600">Numele activității este obligatoriu.</p>
                                  )}

                                  {activity.document_requirements.map(doc => (
                                    <div
                                      key={doc.id}
                                      onDragOver={e => handleReorderDragOver(e, 'doc', `${phase.id}:${activity.id}`, doc.id)}
                                      className={`flex items-start gap-2 p-3 rounded-lg border ${
                                        hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:name`)
                                          ? 'bg-red-50 border-red-200'
                                          : 'bg-slate-50 border-slate-100'
                                      } ${dragItem?.kind === 'doc' && dragItem.id === doc.id ? 'opacity-50' : ''}`}
                                    >
                                      <span
                                        draggable
                                        onDragStart={e => { setDragItem({ kind: 'doc', parentKey: `${phase.id}:${activity.id}`, id: doc.id }); e.dataTransfer.effectAllowed = 'move' }}
                                        onDragEnd={() => setDragItem(null)}
                                        title="Trage pentru a reordona"
                                        className="-ml-1 mt-0.5 p-0.5 rounded text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
                                      >
                                        <GripVertical className="w-3.5 h-3.5" />
                                      </span>
                                      <FileText className="w-4 h-4 text-slate-400 mt-0.5" />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-medium text-sm text-slate-900">{doc.name || 'Document fără nume'}</span>
                                          {REQUIREMENT_BADGE[doc.requirement_type] && (
                                            <span className={`text-xs px-1.5 py-0.5 rounded border ${REQUIREMENT_BADGE[doc.requirement_type].bg} ${REQUIREMENT_BADGE[doc.requirement_type].text} ${REQUIREMENT_BADGE[doc.requirement_type].border}`}>
                                              {REQUIREMENT_LABELS[doc.requirement_type]}
                                            </span>
                                          )}
                                        </div>
                                        {hasValidationError(`doc:${phase.id}:${activity.id}:${doc.id}:name`) && (
                                          <p className="text-xs text-red-600 mt-0.5">Numele documentului este obligatoriu.</p>
                                        )}
                                        {doc.description && (
                                          <p className="text-xs text-slate-500 mt-0.5">{doc.description}</p>
                                        )}
                                        {doc.templateFileName && (
                                          <div className={`flex items-center gap-1 mt-1 text-xs ${doc.templateFileMissingAt ? 'text-amber-700' : 'text-indigo-600'}`}>
                                            {doc.templateFileMissingAt ? <AlertCircle className="w-3 h-3" /> : <Paperclip className="w-3 h-3" />}
                                            <span>{doc.templateFileName}</span>
                                            {doc.templateFileMissingAt && <span className="font-semibold">(indisponibil)</span>}
                                          </div>
                                        )}
                                        <div className="flex items-center gap-2 mt-2">
                                          <label className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-xs text-slate-600 hover:text-indigo-700 hover:border-indigo-200 cursor-pointer">
                                            <Upload className="w-3 h-3" />
                                            {doc.templateFileName ? 'Înlocuiește model' : 'Atașează model'}
                                            <input
                                              type="file"
                                              className="hidden"
                                              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                                              onChange={(e) => {
                                                const file = e.currentTarget.files?.[0] || null
                                                if (!file) return
                                                updateDocRequirement(phase.id, activity.id, doc.id, {
                                                  templateFile: file,
                                                  templateFileName: file.name,
                                                  templateFileMissingAt: null,
                                                  templateFileRemoved: false,
                                                })
                                                e.currentTarget.value = ''
                                              }}
                                            />
                                          </label>
                                          {doc.templateFileName && (
                                            <button
                                              type="button"
                                              onClick={() => updateDocRequirement(phase.id, activity.id, doc.id, {
                                                templateFile: null,
                                                templateFileName: null,
                                                templateFileMissingAt: null,
                                                templateFileRemoved: true,
                                              })}
                                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-100 bg-white text-xs text-red-600 hover:bg-red-50"
                                            >
                                              <X className="w-3 h-3" />
                                              Elimină model
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      <button onClick={() => openEditDocModal(phase.id, activity.id, doc)} className="p-1 text-slate-400 hover:text-indigo-600" title="Modifică cererea">
                                        <Edit2 className="w-4 h-4" />
                                      </button>
                                      <button onClick={() => requestDeleteDocRequirement(phase.id, activity.id, doc)} className="p-1 text-slate-400 hover:text-red-500" title="Șterge cererea">
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => openAddDocModal(phase.id, activity.id)}
                                    className="flex items-center gap-1 py-2 px-3 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg"
                                  >
                                    <Plus className="w-3 h-3" /> Adaugă cerere document
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={() => addActivity(phase.id)}
                            className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1 ml-4"
                          >
                            <Plus className="w-4 h-4" /> Adaugă activitate
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    onClick={addPhase}
                    className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-indigo-400 hover:text-indigo-600 flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" /> Adaugă fază nouă
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button
                  onClick={resetForm}
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-slate-700 font-medium hover:bg-slate-50"
                >
                  Anulează
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !templateName.trim()}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
          <div className="space-y-4">
            {templates.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <Layers className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Niciun template creat</h3>
                <p className="text-slate-500 mb-4">Creează primul template pentru a genera proiecte rapid</p>
                <button
                  onClick={openCreateForm}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                >
                  <Plus className="w-4 h-4" /> Creează template
                </button>
              </div>
            ) : (
              templates.map((template) => (
                <div key={template.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                        <Layers className="w-6 h-6 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">{template.name}</h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                          <span>{template.phases?.length || 0} faze</span>
                          <span>{template.phases?.reduce((sum, p) => sum + (p.activities?.length || 0), 0) || 0} activități</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(template)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => requestDeleteTemplate(template)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {template.phases && template.phases.length > 0 && (
                    <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
                      <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
                                <ChevronRight className="w-4 h-4 text-slate-300 mx-1" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
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
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-2">
            {deleteTarget.type === 'template' && (
              <>
                <p className="font-semibold text-slate-900">{deleteTarget.templateName}</p>
                <p>
                  Conține {deleteTarget.phaseCount} faze, {deleteTarget.activityCount} activități și {deleteTarget.documentCount} cereri de document.
                </p>
                <p className="text-red-700">
                  Dacă template-ul este folosit de proiecte existente, ștergerea va fi blocată.
                </p>
              </>
            )}

            {deleteTarget.type === 'phase' && (
              <>
                <p className="font-semibold text-slate-900">{deleteTarget.phaseName}</p>
                <p>
                  Include {deleteTarget.activityCount} activități și {deleteTarget.documentCount} cereri de document.
                </p>
              </>
            )}

            {deleteTarget.type === 'activity' && (
              <>
                <p className="font-semibold text-slate-900">{deleteTarget.activityName}</p>
                <p>Include {deleteTarget.documentCount} cereri de document.</p>
              </>
            )}

            {deleteTarget.type === 'document' && (
              <p className="font-semibold text-slate-900">{deleteTarget.documentName}</p>
            )}
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
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <Layers className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0 pr-10">
                <h3 id="template-propagation-title" className="text-lg font-semibold text-slate-900">
                  Propagă modificările template-ului
                </h3>
                <p className="text-sm text-slate-500 mt-1 truncate">
                  {propagationPreview.template?.name || 'Template editat'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeTemplatePropagation}
                disabled={propagationApplying}
                aria-label="Închide"
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl border border-indigo-100 bg-indigo-50">
                  <p className="text-xs font-medium text-indigo-600">Proiecte selectate</p>
                  <p className="text-xl font-semibold text-indigo-950 mt-1">{selectedPropagationProjects.length}</p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <p className="text-xs font-medium text-slate-500">Faze</p>
                  <p className="text-xl font-semibold text-slate-900 mt-1">{selectedPropagationTotals.phases}</p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <p className="text-xs font-medium text-slate-500">Activități</p>
                  <p className="text-xl font-semibold text-slate-900 mt-1">{selectedPropagationTotals.activities}</p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <p className="text-xs font-medium text-slate-500">Cereri document</p>
                  <p className="text-xl font-semibold text-slate-900 mt-1">{selectedPropagationTotals.document_requests}</p>
                </div>
              </div>

              {propagationError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{propagationError}</span>
                </div>
              )}

              <section className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Proiecte eligibile</h4>
                    <p className="text-xs text-slate-500">{affectedPropagationProjects.length} proiect(e) cu modificări</p>
                  </div>
                  {affectedPropagationProjects.length > 0 && (
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={allPropagationProjectsSelected}
                        onChange={(e) => setPropagationSelectedProjectIds(
                          e.target.checked ? affectedPropagationProjects.map(project => project.project_id) : []
                        )}
                        disabled={propagationApplying}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600"
                      />
                      Selectează toate
                    </label>
                  )}
                </div>

                <div className="space-y-2">
                  {affectedPropagationProjects.length === 0 && (
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                      <p className="text-sm font-medium text-slate-700">
                        Nu există proiecte eligibile pentru propagare automată.
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
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
                            ? 'border-indigo-200 bg-indigo-50/70'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        } ${propagationApplying ? 'cursor-not-allowed opacity-70' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePropagationProject(project.project_id)}
                          disabled={propagationApplying}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 break-words">{project.project_title}</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className="px-2 py-1 rounded-md bg-white border border-slate-200 text-xs text-slate-600">
                              {project.totals.phases} faze
                            </span>
                            <span className="px-2 py-1 rounded-md bg-white border border-slate-200 text-xs text-slate-600">
                              {project.totals.activities} activități
                            </span>
                            <span className="px-2 py-1 rounded-md bg-white border border-slate-200 text-xs text-slate-600">
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
                    <h4 className="text-sm font-semibold text-slate-900">Proiecte blocate</h4>
                    <p className="text-xs text-slate-500">Nu vor fi modificate automat.</p>
                  </div>
                  <div className="space-y-2">
                    {(propagationPreview.ineligible ?? []).map((project) => (
                      <div key={project.project_id} className="p-4 rounded-xl border border-amber-200 bg-amber-50/70">
                        <p className="text-sm font-semibold text-amber-950 break-words">{project.project_title}</p>
                        <ul className="mt-2 space-y-1 text-xs text-amber-800">
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

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                onClick={closeTemplatePropagation}
                disabled={propagationApplying}
                className="sm:flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50"
              >
                Mai târziu
              </button>
              <button
                type="button"
                onClick={applyTemplatePropagation}
                disabled={propagationApplying || propagationSelectedProjectIds.length === 0}
                className="sm:flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {propagationApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {propagationApplying ? 'Se propagă...' : `Propagă în ${propagationSelectedProjectIds.length} proiect(e)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal document */}
      {addingDocTo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">{editingDocId ? 'Modifică cererea de document' : 'Adaugă cerere document'}</h3>
              <button onClick={closeDocModal} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nume document *</label>
                <input
                  type="text"
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="Ex: Certificat constatator"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Descriere</label>
                <textarea
                  value={newDocDescription}
                  onChange={(e) => setNewDocDescription(e.target.value)}
                  placeholder="Instrucțiuni pentru client..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Model / Template (opțional)</label>
                {newDocTemplate ? (
                  <div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <Paperclip className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-indigo-900 truncate">{newDocTemplate.name}</p>
                      <p className="text-xs text-indigo-600">{(newDocTemplate.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button onClick={() => setNewDocTemplate(null)} className="p-1 text-indigo-600 hover:text-indigo-800">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors">
                    <Upload className="w-8 h-8 text-slate-400" />
                    <span className="text-sm text-slate-600 font-medium">Click pentru a încărca</span>
                    <span className="text-xs text-slate-400">PDF, DOC, DOCX, XLS, XLSX, imagini</span>
                    <input
                      type="file"
                      onChange={(e) => setNewDocTemplate(e.target.files?.[0] || null)}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                    />
                  </label>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tip cerință</label>
                <div className="space-y-2">
                  {REQUIREMENT_TYPES.map(rt => (
                    <label key={rt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="newDocCategoryTemplate"
                        value={rt}
                        checked={newDocCategory === rt}
                        onChange={() => setNewDocCategory(rt)}
                        className="w-4 h-4 border-slate-300 text-indigo-600"
                      />
                      <span className="text-sm text-slate-700">{REQUIREMENT_LABELS[rt]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button
                onClick={closeDocModal}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-white"
              >
                Anulează
              </button>
              <button
                onClick={confirmAddDoc}
                disabled={!newDocName.trim()}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> {editingDocId ? 'Salvează' : 'Adaugă'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
