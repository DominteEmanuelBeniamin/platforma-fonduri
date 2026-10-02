/* eslint-disable @typescript-eslint/no-explicit-any */

// Planul unei salvări de șablon: editorul trimite tot arborele într-o singură
// cerere, iar aici se compară cu ce e în baza de date și rezultă, pe niveluri,
// ce se inserează, ce se modifică și ce se scoate. Înainte, editorul trimitea
// câte o cerere HTTP per element, una după alta, fiecare cu autentificarea și
// auditul ei. Modulul e pur (fără I/O), ca să poată fi testat direct.

import { normalizeRequirementType, requirementTypeToMandatory } from './requirement-type.ts'
import {
  isPersistentTemplateId,
  parseTemplateDuplication,
  type TemplateDuplication,
  type TemplateDuplicationEntity,
} from '../app/api/_utils/template-duplication.ts'

export interface SaveAttachmentInput {
  id?: string | null
  storage_path: string
  original_name?: string | null
  mime_type?: string | null
  file_size?: number | null
  missing_at?: string | null
  missing_checked_at?: string | null
}

export interface SaveDocInput {
  id: string
  name: string
  description?: string | null
  is_outgoing?: boolean
  requirement_type?: string | null
  attachments?: SaveAttachmentInput[]
  duplication?: unknown
  source_local_id?: string
}

export interface SaveActivityInput {
  id: string
  name: string
  default_consultant_id?: string | null
  duplication?: unknown
  source_local_id?: string
  document_requirements?: SaveDocInput[]
}

export interface SavePhaseInput {
  id: string
  name: string
  project_status_id: string
  duplication?: unknown
  source_local_id?: string
  activities?: SaveActivityInput[]
}

export interface SaveTreeInput {
  name: string
  description?: string | null
  phases: SavePhaseInput[]
}

type Removal = { before: any; parentName: string; grandparentName?: string }
type Update = { id: string; before: any; update: Record<string, any> }

export interface PlannedDoc {
  row: Record<string, any>
  attachments: SaveAttachmentInput[]
  duplication?: TemplateDuplication
  activityName: string
  phaseName: string
}

export interface SavePlan {
  templateUpdate: Record<string, any> | null
  phaseInserts: Array<{ row: Record<string, any>; duplication?: TemplateDuplication }>
  activityInserts: Array<{ row: Record<string, any>; duplication?: TemplateDuplication; phaseName: string }>
  docInserts: PlannedDoc[]
  phaseUpdates: Update[]
  activityUpdates: Array<Update & { phaseName: string }>
  docUpdates: Array<Update & { attachments?: SaveAttachmentInput[]; activityName: string; phaseName: string }>
  phaseRemovals: Removal[]
  activityRemovals: Removal[]
  docRemovals: Removal[]
}

export type SavePlanResult = { ok: true; plan: SavePlan } | { ok: false; error: string }

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function cleanAttachments(items: unknown): SaveAttachmentInput[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((item: any) => item && typeof item.storage_path === 'string' && item.storage_path.trim())
    .map((item: any) => ({
      id: typeof item.id === 'string' ? item.id : null,
      storage_path: item.storage_path.trim(),
      original_name: typeof item.original_name === 'string' ? item.original_name : null,
      mime_type: typeof item.mime_type === 'string' ? item.mime_type : null,
      file_size: typeof item.file_size === 'number' ? item.file_size : null,
      missing_at: item.missing_at || null,
      missing_checked_at: item.missing_checked_at || null,
    }))
}

function storedAttachments(doc: any): SaveAttachmentInput[] {
  if (doc.attachments?.length) {
    return [...doc.attachments].sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
  }
  return doc.attachment_path
    ? [{ storage_path: doc.attachment_path, original_name: doc.attachment_original_name ?? null }]
    : []
}

const attachmentKey = (items: SaveAttachmentInput[]) =>
  JSON.stringify(items.map(item => [item.storage_path, item.original_name || null]))

/** Doar câmpurile care diferă de rândul existent. */
function changedFields(before: any, next: Record<string, any>) {
  const update: Record<string, any> = {}
  for (const [key, value] of Object.entries(next)) {
    if ((before[key] ?? null) !== (value ?? null)) update[key] = value
  }
  return update
}

/**
 * @param current arborele activ din DB (forma din `assembleTemplateTrees`)
 * @param takenSlugs toate slug-urile de fază ale șablonului, inclusiv ale
 *   fazelor scoase: unicitatea (template_id, slug) le include și pe ele
 * @param newId generatorul de UUID pentru rândurile noi; id-urile se stabilesc
 *   dinainte, ca fiecare nivel să intre într-un singur insert
 */
export function planTemplateSave(
  current: any,
  input: SaveTreeInput,
  takenSlugs: Iterable<string>,
  newId: () => string,
): SavePlanResult {
  const templateId = current.id
  const templateName = input.name?.trim()
  if (!templateName) return { ok: false, error: 'Numele șablonului este obligatoriu.' }
  if (!Array.isArray(input.phases)) return { ok: false, error: 'Structura șablonului lipsește.' }

  const plan: SavePlan = {
    templateUpdate: null,
    phaseInserts: [],
    activityInserts: [],
    docInserts: [],
    phaseUpdates: [],
    activityUpdates: [],
    docUpdates: [],
    phaseRemovals: [],
    activityRemovals: [],
    docRemovals: [],
  }

  const templateUpdate = changedFields(current, {
    name: templateName,
    description: input.description?.trim() || null,
  })
  if (Object.keys(templateUpdate).length > 0) plan.templateUpdate = templateUpdate

  // Indexul arborelui existent, pe niveluri, cu părintele fiecărui element.
  const phasesById = new Map<string, any>()
  const activitiesById = new Map<string, { row: any; phaseId: string }>()
  const docsById = new Map<string, { row: any; activityId: string }>()
  for (const phase of current.phases ?? []) {
    phasesById.set(phase.id, phase)
    for (const activity of phase.activities ?? []) {
      activitiesById.set(activity.id, { row: activity, phaseId: phase.id })
      for (const doc of activity.document_requirements ?? []) {
        docsById.set(doc.id, { row: doc, activityId: activity.id })
      }
    }
  }

  // Id-urile locale (din editor) primesc aici UUID-ul final. O duplicare
  // dintr-un element nou salvat în aceeași cerere devine astfel persistentă.
  const seen = new Set<string>()
  const localIds = new Map<string, string>()
  for (const phase of input.phases) {
    for (const node of [phase, ...(phase.activities ?? []), ...(phase.activities ?? []).flatMap(a => a.document_requirements ?? [])]) {
      if (typeof node?.id !== 'string' || !node.id) return { ok: false, error: 'Element fără identificator.' }
      if (seen.has(node.id)) return { ok: false, error: 'Același element apare de două ori în șablon.' }
      seen.add(node.id)
      if (!isPersistentTemplateId(node.id)) localIds.set(node.id, newId())
    }
  }

  const sourceNames: Record<TemplateDuplicationEntity, (id: string) => string | undefined> = {
    template_phase: id => phasesById.get(id)?.name,
    template_activity: id => activitiesById.get(id)?.row.name,
    template_document: id => docsById.get(id)?.row.name,
  }
  const resolveDuplication = (
    node: { duplication?: unknown; source_local_id?: string },
    entity: TemplateDuplicationEntity,
  ): { ok: true; value?: TemplateDuplication } | { ok: false; error: string } => {
    if (node.duplication === undefined || node.duplication === null) return { ok: true }
    const parsed = parseTemplateDuplication(node.duplication, entity)
    if (!parsed.ok) return parsed
    const duplication = parsed.value
    if (duplication.source_kind === 'persistent') {
      const sourceName = sourceNames[entity](duplication.source_id as string)
      if (sourceName === undefined) return { ok: false, error: 'Sursa duplicării nu aparține acestui template.' }
      return { ok: true, value: { ...duplication, source_name: sourceName } }
    }
    const savedId = node.source_local_id ? localIds.get(node.source_local_id) : undefined
    return {
      ok: true,
      value: savedId ? { ...duplication, source_kind: 'persistent', source_id: savedId } : duplication,
    }
  }

  // Slug-urile se aleg fără să elibereze vreunul existent: actualizările rulează
  // în paralel și n-au voie să se ciocnească trecător pe (template_id, slug).
  const taken = new Set(takenSlugs)
  const uniqueSlug = (base: string, fallback: string) => {
    const root = base || fallback
    let slug = root
    for (let n = 2; taken.has(slug); n++) slug = `${root}-${n}`
    taken.add(slug)
    return slug
  }

  const keptPhases = new Set<string>()
  const keptActivities = new Set<string>()
  const keptDocs = new Set<string>()

  for (let pIdx = 0; pIdx < input.phases.length; pIdx++) {
    const phase = input.phases[pIdx]
    const phaseName = phase.name?.trim()
    if (!phaseName) return { ok: false, error: 'Fiecare fază trebuie să aibă un nume.' }
    // Fiecare fază are un status de proiect: îl primește proiectul la import.
    const statusId = phase.project_status_id
    if (!statusId) return { ok: false, error: `Faza "${phaseName}" nu are status.` }

    let phaseId: string
    if (isPersistentTemplateId(phase.id)) {
      const before = phasesById.get(phase.id)
      if (!before) return { ok: false, error: `Faza "${phaseName}" nu aparține acestui șablon.` }
      phaseId = phase.id
      keptPhases.add(phaseId)
      const update = changedFields(before, {
        name: phaseName,
        project_status_id: statusId,
        order_index: pIdx + 1,
      })
      if (update.name !== undefined) {
        const base = slugify(phaseName)
        if (base !== before.slug) update.slug = uniqueSlug(base, `faza-${pIdx + 1}`)
      }
      if (Object.keys(update).length > 0) plan.phaseUpdates.push({ id: phaseId, before, update })
    } else {
      const duplication = resolveDuplication(phase, 'template_phase')
      if (!duplication.ok) return duplication
      phaseId = localIds.get(phase.id)!
      plan.phaseInserts.push({
        duplication: duplication.value,
        row: {
          id: phaseId,
          template_id: templateId,
          project_status_id: statusId,
          name: phaseName,
          slug: uniqueSlug(slugify(phaseName), `faza-${pIdx + 1}`),
          order_index: pIdx + 1,
          is_active: true,
        },
      })
    }

    const activities = phase.activities ?? []
    for (let aIdx = 0; aIdx < activities.length; aIdx++) {
      const activity = activities[aIdx]
      const activityName = activity.name?.trim()
      if (!activityName) return { ok: false, error: `O activitate din faza "${phaseName}" nu are nume.` }
      const consultantId = activity.default_consultant_id || null

      let activityId: string
      if (isPersistentTemplateId(activity.id)) {
        const existing = activitiesById.get(activity.id)
        if (!existing || existing.phaseId !== phaseId) {
          return { ok: false, error: `Activitatea "${activityName}" nu aparține fazei "${phaseName}".` }
        }
        activityId = activity.id
        keptActivities.add(activityId)
        const update = changedFields(existing.row, {
          name: activityName,
          order_index: aIdx + 1,
          default_consultant_id: consultantId,
        })
        if (Object.keys(update).length > 0) {
          plan.activityUpdates.push({ id: activityId, before: existing.row, update, phaseName })
        }
      } else {
        const duplication = resolveDuplication(activity, 'template_activity')
        if (!duplication.ok) return duplication
        activityId = localIds.get(activity.id)!
        plan.activityInserts.push({
          duplication: duplication.value,
          phaseName,
          row: {
            id: activityId,
            template_phase_id: phaseId,
            name: activityName,
            order_index: aIdx + 1,
            default_consultant_id: consultantId,
            is_active: true,
          },
        })
      }

      const docs = activity.document_requirements ?? []
      for (let dIdx = 0; dIdx < docs.length; dIdx++) {
        const doc = docs[dIdx]
        const docName = doc.name?.trim()
        if (!docName) return { ok: false, error: `Un document din activitatea "${activityName}" nu are nume.` }
        const isOutgoing = doc.is_outgoing === true
        const requirementType = isOutgoing ? 'optional' : normalizeRequirementType(doc.requirement_type)
        const attachments = cleanAttachments(doc.attachments)
        if (isOutgoing && attachments.length === 0) {
          return { ok: false, error: `Documentul "${docName}" e trimis clientului, deci trebuie să aibă un fișier atașat.` }
        }
        const fields = {
          name: docName,
          description: doc.description?.trim() || null,
          is_outgoing: isOutgoing,
          requirement_type: requirementType,
          is_mandatory: requirementTypeToMandatory(requirementType),
          order_index: dIdx + 1,
        }

        if (isPersistentTemplateId(doc.id)) {
          const existing = docsById.get(doc.id)
          if (!existing || existing.activityId !== activityId) {
            return { ok: false, error: `Documentul "${docName}" nu aparține activității "${activityName}".` }
          }
          keptDocs.add(doc.id)
          const before = {
            ...existing.row,
            description: existing.row.description || null,
            is_outgoing: existing.row.is_outgoing === true,
            requirement_type: normalizeRequirementType(existing.row.requirement_type, existing.row.is_mandatory),
          }
          const update = changedFields(before, fields)
          const attachmentsChanged = attachmentKey(attachments) !== attachmentKey(storedAttachments(existing.row))
          if (attachmentsChanged) {
            const first = attachments[0]
            update.attachment_path = first?.storage_path ?? null
            update.attachment_original_name = first ? first.original_name ?? null : null
            update.attachment_missing_at = null
            update.attachment_missing_checked_at = null
          }
          if (Object.keys(update).length > 0) {
            plan.docUpdates.push({
              id: doc.id,
              before: existing.row,
              update,
              attachments: attachmentsChanged ? attachments : undefined,
              activityName,
              phaseName,
            })
          }
        } else {
          const duplication = resolveDuplication(doc, 'template_document')
          if (!duplication.ok) return duplication
          plan.docInserts.push({
            duplication: duplication.value,
            attachments,
            activityName,
            phaseName,
            row: {
              id: localIds.get(doc.id)!,
              template_activity_id: activityId,
              ...fields,
              is_active: true,
            },
          })
        }
      }
    }
  }

  // Se scoate doar elementul cel mai de sus eliminat: copiii unei faze scoase
  // dispar oricum din arbore, ca înainte.
  for (const phase of current.phases ?? []) {
    if (!keptPhases.has(phase.id)) {
      plan.phaseRemovals.push({ before: phase, parentName: current.name })
      continue
    }
    for (const activity of phase.activities ?? []) {
      if (!keptActivities.has(activity.id)) {
        plan.activityRemovals.push({ before: activity, parentName: phase.name, grandparentName: current.name })
        continue
      }
      for (const doc of activity.document_requirements ?? []) {
        if (!keptDocs.has(doc.id)) {
          plan.docRemovals.push({ before: doc, parentName: activity.name, grandparentName: phase.name })
        }
      }
    }
  }

  return { ok: true, plan }
}
