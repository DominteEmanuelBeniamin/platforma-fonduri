/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Fragment, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Layers, Plus, Trash2,
  ChevronRight, ChevronsDownUp, ChevronsUpDown, Check, X,
  Loader2, Edit2, Copy,
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { countLabel } from '@/lib/count-label'
import { RequirementType, normalizeRequirementType } from '@/lib/requirement-type'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { useToast } from '@/app/providers/ToastProvider'
import { buildCopyName } from '@/lib/duplicate-name'
import type { Consultant, DocumentRequirement, DragKind, EditorActions, TemplateActivity, TemplateAttachment, TemplatePhase } from '@/components/template-editor/types'
import { PhaseList, countPhaseDocuments } from '@/components/template-editor/PhaseList'
import { NameDialog } from '@/components/template-editor/NameDialog'
import { DocDialog, type DocDialogValues } from '@/components/template-editor/DocDialog'
import { AutoGrowTextarea } from '@/components/template-editor/AutoGrowTextarea'
import { templateFormDirty, type TemplateFormState } from '@/lib/template-form'
import { serverMessage } from '@/lib/api-error'
import { mapWithConcurrency } from '@/lib/template-tree'
import {
  duplicationFromSource,
  isPersistentTemplateId,
} from '@/app/api/_utils/template-duplication'
import { Spinner } from '@/components/ui/Spinner'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button } from '@/components/ui/Button'
import RowActionsMenu from '@/components/RowActionsMenu'
import { PageHeader } from '@/components/ui/PageHeader'
import { IconButton } from '@/components/ui/IconButton'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { Plate } from '@/components/ui/Plate'
import { Signal } from '@/components/ui/Signal'
import { FloatingSurface, Scrim } from '@/components/ui/Surface'
import { bandFor, bandVar } from '@/lib/signage'
import { FoundIn, Highlight } from '@/components/ui/Highlight'
import { rangesOf, searchItems, type SearchField } from '@/lib/search'
import { programLabel } from '@/lib/search-fields'

interface ProjectStatus {
  id: string
  name: string
  slug: string
  color: string
}

interface Template {
  id: string
  name: string
  description: string | null
  status: 'draft' | 'published'
  is_active?: boolean | null
  /** Setat când conținutul unui șablon publicat s-a schimbat după ultima aplicare în proiecte. */
  unpropagated_changes_at?: string | null
  measure?: { name?: string | null; program?: { name?: string | null } | null } | null
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

/** Tooltip-ul statutului: se poate sau nu alege la crearea unui proiect (S-22). */
function templateStatusHint(template: { status: 'draft' | 'published'; is_active?: boolean | null }) {
  if (template.status === 'draft') return 'Ciornă: nu apare la crearea unui proiect până nu o publică un administrator.'
  if (template.is_active === false) return 'Publicat, dar dezactivat: nu apare la crearea unui proiect nou.'
  return 'Publicat: se poate alege la crearea unui proiect nou.'
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
  const [nameError, setNameError] = useState<string | null>(null)
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

  // Dialogurile editorului își țin câmpurile în ele; aici stă doar ce e deschis.
  const [docDialog, setDocDialog] = useState<{ phaseId: string; activityId: string; doc: DocumentRequirement | null } | null>(null)
  const [nameDialog, setNameDialog] = useState<
    | { kind: 'new-phase' }
    | { kind: 'new-activity'; phaseId: string }
    | { kind: 'rename-phase'; phaseId: string; name: string }
    | { kind: 'rename-activity'; phaseId: string; activityId: string; name: string }
    | null
  >(null)
  const [propagationTemplateId, setPropagationTemplateId] = useState<string | null>(null)
  const [propagationPreview, setPropagationPreview] = useState<TemplatePropagationPreview | null>(null)
  const [propagationSelectedProjectIds, setPropagationSelectedProjectIds] = useState<string[]>([])
  const [propagationApplying, setPropagationApplying] = useState(false)
  const [propagationError, setPropagationError] = useState<string | null>(null)

  // Drag & drop reorder — doar în array-urile locale; handleSave persistă
  // order_index = index + 1. Elementul tras stă într-un ref, ca funcțiile de
  // tras să rămână stabile pentru rândurile `memo`; `dragId` doar îl estompează.
  const dragRef = useRef<{ kind: DragKind; parentKey: string; id: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

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
  // ca importul în proiect să meargă ca înainte. Numele vine din dialog (D9):
  // din interfață nu se mai poate crea o fază sau o activitate fără nume.
  const addPhase = (name: string) => {
    setPhases(current => [...current, {
      id: generateId(),
      name,
      project_status_id: statuses[0]?.id || null,
      activities: [],
      expanded: true,
    }])
  }

  const removePhase = (phaseId: string) => {
    setPhases(current => current.filter(p => p.id !== phaseId))
  }

  const allPhasesExpanded = phases.length > 0 && phases.every(p => p.expanded)
  const setAllPhasesExpanded = (expanded: boolean) => {
    setPhases(current => current.map(p => ({ ...p, expanded })))
  }

  const removeActivity = (phaseId: string, activityId: string) => {
    setPhases(current => current.map(p =>
      p.id === phaseId ? { ...p, activities: p.activities.filter(a => a.id !== activityId) } : p))
  }

  const removeDocRequirement = (phaseId: string, activityId: string, docId: string) => {
    setPhases(current => current.map(p => p.id === phaseId
      ? { ...p, activities: p.activities.map(a => a.id === activityId
          ? { ...a, document_requirements: a.document_requirements.filter(d => d.id !== docId) }
          : a) }
      : p))
  }

  /** Schimbă o activitate, fără să atingă restul arborelui (referințele rămân, deci și `memo`). */
  const patchActivity = useCallback((phaseId: string, activityId: string, patch: (activity: TemplateActivity) => TemplateActivity) => {
    setPhases(current => current.map(p => p.id === phaseId
      ? { ...p, activities: p.activities.map(a => a.id === activityId ? patch(a) : a) }
      : p))
  }, [])

  const dropError = useCallback((key: string) => {
    setValidationErrors(prev => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const saveDocDialog = (values: DocDialogValues) => {
    if (!docDialog) return
    const { phaseId, activityId, doc } = docDialog
    const firstAttachmentName = values.templateAttachments[0]?.original_name || values.templateAttachments[0]?.storage_path.split('/').pop()
    const fields: Partial<DocumentRequirement> = {
      name: values.name,
      description: values.description,
      is_outgoing: values.is_outgoing,
      requirement_type: values.requirement_type,
      templateFiles: values.templateFiles,
      templateAttachments: values.templateAttachments,
      templateFileName: firstAttachmentName || values.templateFiles[0]?.name || null,
      templateFileMissingAt: values.templateAttachments.find(attachment => attachment.missing_at)?.missing_at || null,
      templateFileRemoved: values.templateAttachments.length === 0 && values.templateFiles.length === 0,
    }
    patchActivity(phaseId, activityId, a => ({
      ...a,
      document_requirements: doc
        ? a.document_requirements.map(d => d.id === doc.id ? { ...d, ...fields } : d)
        : [...a.document_requirements, { id: generateId(), ...fields, templateFileRemoved: false } as DocumentRequirement],
    }))
    if (doc) {
      dropError(`doc:${phaseId}:${activityId}:${doc.id}:name`)
      dropError(`doc:${phaseId}:${activityId}:${doc.id}:templateFile`)
    }
    setDocDialog(null)
  }

  const saveNameDialog = (name: string) => {
    if (!nameDialog) return
    if (nameDialog.kind === 'new-phase') addPhase(name)
    else if (nameDialog.kind === 'new-activity') {
      const { phaseId } = nameDialog
      setPhases(current => current.map(p => p.id === phaseId
        ? { ...p, expanded: true, activities: [...p.activities, { id: generateId(), name, document_requirements: [], expanded: true }] }
        : p))
    } else if (nameDialog.kind === 'rename-phase') {
      const { phaseId } = nameDialog
      setPhases(current => current.map(p => p.id === phaseId ? { ...p, name } : p))
      dropError(`phase:${phaseId}:name`)
    } else {
      const { phaseId, activityId } = nameDialog
      patchActivity(phaseId, activityId, a => ({ ...a, name }))
      dropError(`activity:${phaseId}:${activityId}:name`)
    }
    setFormError(null)
    setNameDialog(null)
  }

  // Duplicare (#15). Copia primește id-uri locale noi, deci salvarea o creează
  // ca element nou, cu tot cu cererile de documente și fișierele-model.
  const editorActions = useMemo<EditorActions>(() => {
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
    const reorderList = <T extends { id: string }>(list: T[], draggedId: string, targetId: string): T[] => {
      const from = list.findIndex(item => item.id === draggedId)
      const to = list.findIndex(item => item.id === targetId)
      if (from === -1 || to === -1 || from === to) return list
      const next = [...list]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    }
    const patchDocs = (phaseId: string, activityId: string, patch: (docs: DocumentRequirement[]) => DocumentRequirement[]) =>
      patchActivity(phaseId, activityId, a => ({ ...a, document_requirements: patch(a.document_requirements) }))

    return {
      togglePhase: phaseId => setPhases(current => current.map(p => p.id === phaseId ? { ...p, expanded: !p.expanded } : p)),
      toggleActivity: (phaseId, activityId) => patchActivity(phaseId, activityId, a => ({ ...a, expanded: !a.expanded })),
      renamePhase: phase => setNameDialog({ kind: 'rename-phase', phaseId: phase.id, name: phase.name }),
      renameActivity: (phaseId, activity) => setNameDialog({ kind: 'rename-activity', phaseId, activityId: activity.id, name: activity.name }),
      duplicatePhase: phaseId => setPhases(current => {
        const index = current.findIndex(p => p.id === phaseId)
        if (index === -1) return current
        const source = current[index]
        const copy: TemplatePhase = {
          ...source,
          id: generateId(),
          name: buildCopyName(source.name, current.map(p => p.name)),
          expanded: true,
          activities: source.activities.map(activity => cloneActivity(activity, activity.name)),
          ...duplicationFromSource(source, 'template_phase'),
        }
        return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]
      }),
      duplicateActivity: (phaseId, activityId) => setPhases(current => current.map(p => {
        if (p.id !== phaseId) return p
        const index = p.activities.findIndex(a => a.id === activityId)
        if (index === -1) return p
        const source = p.activities[index]
        const copy = cloneActivity(source, buildCopyName(source.name, p.activities.map(a => a.name)))
        return { ...p, activities: [...p.activities.slice(0, index + 1), copy, ...p.activities.slice(index + 1)] }
      })),
      movePhase: (phaseId, direction) => setPhases(current => moveInArray(current, phaseId, direction)),
      moveActivity: (phaseId, activityId, direction) => setPhases(current => current.map(p => p.id === phaseId
        ? { ...p, activities: moveInArray(p.activities, activityId, direction) }
        : p)),
      moveDoc: (phaseId, activityId, docId, direction) => patchDocs(phaseId, activityId, docs => moveInArray(docs, docId, direction)),
      deletePhase: phase => {
        setDeleteError(null)
        setDeleteTarget({
          type: 'phase',
          phaseId: phase.id,
          phaseName: phase.name.trim() || 'Fază fără nume',
          activityCount: phase.activities.length,
          documentCount: countPhaseDocuments(phase),
          persisted: isDbId(phase.id),
        })
      },
      deleteActivity: (phaseId, activity) => {
        setDeleteError(null)
        setDeleteTarget({
          type: 'activity',
          phaseId,
          activityId: activity.id,
          activityName: activity.name.trim() || 'Activitate fără nume',
          documentCount: activity.document_requirements.length,
          persisted: isDbId(activity.id),
        })
      },
      deleteDoc: (phaseId, activityId, doc) => {
        setDeleteError(null)
        setDeleteTarget({
          type: 'document',
          phaseId,
          activityId,
          documentId: doc.id,
          documentName: doc.name.trim() || 'Document fără nume',
          persisted: isDbId(doc.id),
        })
      },
      addActivity: phaseId => setNameDialog({ kind: 'new-activity', phaseId }),
      addDoc: (phaseId, activityId) => setDocDialog({ phaseId, activityId, doc: null }),
      editDoc: (phaseId, activityId, doc) => setDocDialog({ phaseId, activityId, doc }),
      setConsultant: (phaseId, activityId, consultantId) => patchActivity(phaseId, activityId, a => ({ ...a, default_consultant_id: consultantId })),
      attachFiles: (phaseId, activityId, docId, files) => {
        patchDocs(phaseId, activityId, docs => docs.map(d => d.id === docId
          ? {
              ...d,
              templateFiles: [...d.templateFiles, ...files],
              templateFileName: files[0].name,
              templateFileMissingAt: d.templateAttachments.find(attachment => attachment.missing_at)?.missing_at || null,
              templateFileRemoved: false,
            }
          : d))
        dropError(`doc:${phaseId}:${activityId}:${docId}:templateFile`)
      },
      dragStart: (kind, parentKey, id) => { dragRef.current = { kind, parentKey, id }; setDragId(id) },
      dragEnd: () => { dragRef.current = null; setDragId(null) },
      dragOver: (event, kind, parentKey, targetId) => {
        const drag = dragRef.current
        // Doar în aceeași listă: același nivel și același părinte.
        if (!drag || drag.kind !== kind || drag.parentKey !== parentKey) return
        event.preventDefault()
        if (drag.id === targetId) return
        if (kind === 'phase') setPhases(current => reorderList(current, drag.id, targetId))
        else if (kind === 'activity') {
          setPhases(current => current.map(p => p.id === parentKey ? { ...p, activities: reorderList(p.activities, drag.id, targetId) } : p))
        } else {
          const [phaseId, activityId] = parentKey.split(':')
          patchDocs(phaseId, activityId, docs => reorderList(docs, drag.id, targetId))
        }
      },
    }
  }, [patchActivity, dropError])

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
    setNameError(null)
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
      if (res.status === 409) {
        // Numele e al altui șablon (D10): mesajul stă sub „Nume șablon”.
        setNameError(await serverMessage(res, 'Există deja un șablon cu acest nume. Alege alt nume.'))
        return
      }
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
    // Copierea durează câteva secunde, deci întâi o confirmare (S-23).
    const phaseCount = template.phases?.length ?? 0
    const activityCount = template.phases?.reduce((sum, phase) => sum + (phase.activities?.length ?? 0), 0) ?? 0
    if (!(await confirm({
      title: `Duplici șablonul «${template.name}»?`,
      description: `Se copiază ${countLabel(phaseCount, 'fază', 'faze')}, ${countLabel(activityCount, 'activitate', 'activități')}, ${countLabel(countTemplateDocuments(template), 'cerere', 'cereri')} și fișierele-model. Durează câteva secunde.`,
      confirmText: 'Duplică',
    }))) return
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
      // Strânse la deschidere (S-24): un șablon mare se citește întâi pe faze.
      // Erorile de validare deschid ce e greșit; o fază nouă se deschide.
      expanded: false,
      activities: p.activities?.map((a: any) => ({
        id: a.id,
        name: a.name,
        expanded: false,
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

  // Căutarea (#112): numele, descrierea, programul și fazele și activitățile din șablon.
  const templateHits = useMemo(() => searchItems(templates, templateSearch, (t): SearchField[] => [
    { key: 'name', label: 'Nume', value: t.name },
    { key: 'description', label: 'Descriere', value: t.description },
    { key: 'program', label: 'Program', value: programLabel(t.measure), shown: false },
    { key: 'phases', label: 'Faze', value: (t.phases ?? []).map(phase => phase.name).join(', '), shown: false },
    {
      key: 'activities',
      label: 'Activități',
      value: (t.phases ?? []).flatMap(phase => (phase.activities ?? []).map(activity => activity.name)).join(', '),
      shown: false,
    },
  ]), [templates, templateSearch])
  const filteredTemplates = useMemo(() => templateHits.map(hit => hit.item), [templateHits])

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
                        <th scope="col" className="w-14 px-3 py-2"><span className="sr-only">Acțiuni</span></th>
                      </tr>
                    </thead>
                    <tbody className="block lg:table-row-group">
                      {templateHits.map(({ item: template, matches }) => {
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
                                    <span className="block font-medium text-ink"><Highlight text={template.name} ranges={rangesOf(matches, 'name')} /></span>
                                    {template.description && (
                                      <span className="mt-0.5 text-xs leading-5 text-ink-soft line-clamp-1" title={template.description}><Highlight text={template.description} ranges={rangesOf(matches, 'description')} /></span>
                                    )}
                                    <FoundIn matches={matches} className="mt-0.5" />
                                    <span className="mt-0.5 block text-xs text-ink-faint lg:hidden">
                                      {countLabel(phaseCount, 'fază', 'faze')} · {countLabel(activityCount, 'activitate', 'activități')} · {countLabel(countTemplateDocuments(template), 'document', 'documente')}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="max-w-full px-3 pb-2 lg:py-2">
                                <div className="flex flex-col items-start gap-1">
                                  {/* Ce înseamnă statutul la crearea unui proiect (S-22): acolo
                                      apar doar șabloanele publicate și active (TemplateSelector). */}
                                  <span data-tooltip={templateStatusHint(template)} className="inline-flex">
                                    <Signal tone={template.status === 'draft' ? 'draft' : 'ok'}>
                                      {template.status === 'draft' ? 'Ciornă' : 'Publicat'}
                                    </Signal>
                                  </span>
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
                                {/* Toate acțiunile într-un singur „⋯”: patru iconițe una lângă
                                    alta se apăsau din greșeală (S-30). */}
                                <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                                  <RowActionsMenu
                                    label={`Acțiuni pentru șablonul ${template.name}`}
                                    tooltip="Acțiuni șablon"
                                    busy={duplicatingId === template.id}
                                    triggerClassName="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink disabled:opacity-60 pointer-fine:h-8 pointer-fine:w-8"
                                    actions={[
                                      { label: 'Editează', icon: <Edit2 className="h-4 w-4" />, hidden: !editable, onSelect: () => handleEdit(template) },
                                      { label: 'Publică', icon: <Check className="h-4 w-4" />, hidden: !(isAdmin && template.status === 'draft'), onSelect: () => requestPublishTemplate(template) },
                                      { label: 'Duplică', icon: <Copy className="h-4 w-4" />, hidden: !canManageTemplates || duplicatingId !== null, onSelect: () => { void duplicateTemplate(template) } },
                                      { label: 'Șterge', icon: <Trash2 className="h-4 w-4" />, danger: true, hidden: !canManageTemplates, onSelect: () => requestDeleteTemplate(template) },
                                    ]}
                                  />
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
                                        <span className="min-w-0 flex-1 font-medium text-ink"><Highlight text={phase.name} query={templateSearch} /></span>
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
                <Camp label="Nume șablon" required error={nameError ?? (hasValidationError('template:name') ? 'Numele șablonului este obligatoriu.' : null)}>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => {
                      setTemplateName(e.target.value)
                      setNameError(null)
                      clearValidationError('template:name')
                    }}
                    placeholder="Ex: Proiect Standard"
                    className={hasValidationError('template:name') ? inputErrorClass : inputClass}
                  />
                </Camp>
                {/* Pe toată lățimea, crește cu textul până la 8 rânduri (S-25). */}
                <div className="md:col-span-2">
                  <Camp label="Descriere">
                    <AutoGrowTextarea
                      value={templateDescription}
                      onChange={setTemplateDescription}
                      placeholder="Descriere scurtă…"
                    />
                  </Camp>
                </div>
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
                <PhaseList
                  phases={phases}
                  consultants={consultants}
                  errors={validationErrors}
                  dragId={dragId}
                  actions={editorActions}
                />
              )}

              <button data-tooltip="Adaugă o fază nouă la sfârșitul șablonului"
                type="button"
                onClick={() => setNameDialog({ kind: 'new-phase' })}
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

      {docDialog && (
        <DocDialog
          key={docDialog.doc?.id ?? 'nou'}
          editing={docDialog.doc}
          onSave={saveDocDialog}
          onClose={() => setDocDialog(null)}
        />
      )}

      {nameDialog && (
        <NameDialog
          title={{
            'new-phase': 'Fază nouă',
            'new-activity': 'Activitate nouă',
            'rename-phase': 'Redenumește faza',
            'rename-activity': 'Redenumește activitatea',
          }[nameDialog.kind]}
          label={nameDialog.kind.endsWith('phase') ? 'Numele fazei' : 'Numele activității'}
          initialValue={'name' in nameDialog ? nameDialog.name : ''}
          confirmText={nameDialog.kind.startsWith('new') ? 'Adaugă' : 'Salvează'}
          onConfirm={saveNameDialog}
          onClose={() => setNameDialog(null)}
        />
      )}
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
