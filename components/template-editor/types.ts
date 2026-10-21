import type { RequirementType } from '@/lib/requirement-type'
import type { TemplateDuplication } from '@/app/api/_utils/template-duplication'

/** Starea editorului de șabloane, comună paginii și componentelor lui. */

export interface TemplateAttachment {
  id: string
  storage_path: string
  original_name: string | null
  mime_type?: string | null
  file_size?: number | null
  order_index?: number
  missing_at?: string | null
  missing_checked_at?: string | null
}

export interface DocumentRequirement {
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

export interface Consultant {
  id: string
  full_name: string | null
  email: string
  is_active?: boolean | null
}

export interface TemplateActivity {
  id: string
  name: string
  document_requirements: DocumentRequirement[]
  expanded: boolean
  default_consultant_id?: string
  duplication?: TemplateDuplication
  sourceLocalId?: string
}

export interface TemplatePhase {
  id: string
  name: string
  project_status_id: string | null
  activities: TemplateActivity[]
  expanded: boolean
  duplication?: TemplateDuplication
  sourceLocalId?: string
}

export type DragKind = 'phase' | 'activity' | 'doc'

/**
 * Tot ce poate face un rând al editorului. Funcțiile sunt stabile (create o
 * dată în pagină), ca fazele, activitățile și cererile să fie `memo`: o
 * tastare în numele șablonului nu mai re-randează sute de rânduri (S-26).
 */
export interface EditorActions {
  togglePhase: (phaseId: string) => void
  toggleActivity: (phaseId: string, activityId: string) => void
  renamePhase: (phase: TemplatePhase) => void
  renameActivity: (phaseId: string, activity: TemplateActivity) => void
  duplicatePhase: (phaseId: string) => void
  duplicateActivity: (phaseId: string, activityId: string) => void
  movePhase: (phaseId: string, direction: -1 | 1) => void
  moveActivity: (phaseId: string, activityId: string, direction: -1 | 1) => void
  moveDoc: (phaseId: string, activityId: string, docId: string, direction: -1 | 1) => void
  deletePhase: (phase: TemplatePhase) => void
  deleteActivity: (phaseId: string, activity: TemplateActivity) => void
  deleteDoc: (phaseId: string, activityId: string, doc: DocumentRequirement) => void
  addActivity: (phaseId: string) => void
  addDoc: (phaseId: string, activityId: string) => void
  editDoc: (phaseId: string, activityId: string, doc: DocumentRequirement) => void
  setConsultant: (phaseId: string, activityId: string, consultantId: string | undefined) => void
  attachFiles: (phaseId: string, activityId: string, docId: string, files: File[]) => void
  dragStart: (kind: DragKind, parentKey: string, id: string) => void
  dragEnd: () => void
  dragOver: (event: React.DragEvent, kind: DragKind, parentKey: string, id: string) => void
}
