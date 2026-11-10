import { guardToResponse, requireProjectAccess } from './auth'
import { createSupabaseServiceClient } from './supabase'
import type { Database } from '@/lib/database.types'
import { isInternalEntryUuid } from '@/lib/internal-entry-security'

export const INTERNAL_ATTACHMENT_BUCKET = 'project-internal'
export const INTERNAL_DOWNLOAD_TTL_SECONDS = 60

type EntryRow = Database['public']['Tables']['project_internal_entries']['Row']
type AttachmentRow = Database['public']['Tables']['project_internal_attachments']['Row']
type ServiceClient = ReturnType<typeof createSupabaseServiceClient>

export type InternalAttachmentResponse = Pick<
  AttachmentRow,
  'id' | 'original_name' | 'mime_type' | 'file_size' | 'created_at' | 'uploaded_by'
>

export type InternalEntryResponse = EntryRow & {
  author: { id: string | null; full_name: string }
  context: { type: 'phase' | 'activity' | 'requirement'; id: string; label: string } | null
  attachments: InternalAttachmentResponse[]
}

export async function requireInternalProjectAccess(request: Request, projectId: string, write = false) {
  const access = await requireProjectAccess(request, projectId)
  if (!access.ok) return { ok: false as const, response: guardToResponse(access) }
  if (access.profile.role === 'client') {
    return { ok: false as const, response: Response.json({ error: 'Internal dossier is unavailable' }, { status: 403 }) }
  }
  if (!isInternalEntryUuid(projectId)) {
    return { ok: false as const, response: Response.json({ error: 'Project not found' }, { status: 404 }) }
  }
  if (!write) return { ok: true as const, user: access.user, profile: access.profile, access: access.access }

  const writable = await requireProjectAccess(request, projectId, { write: true })
  if (!writable.ok) return { ok: false as const, response: guardToResponse(writable) }
  return { ok: true as const, user: writable.user, profile: writable.profile, access: writable.access }
}

export async function loadInternalEntry(
  admin: ServiceClient,
  projectId: string,
  entryId: string,
): Promise<{ entry: EntryRow | null; error: unknown | null }> {
  const { data, error } = await admin
    .from('project_internal_entries')
    .select('*')
    .eq('project_id', projectId)
    .eq('id', entryId)
    .is('deleted_at', null)
    .maybeSingle()
  return { entry: data, error }
}

export async function formatInternalEntries(
  admin: ServiceClient,
  projectId: string,
  rows: EntryRow[],
): Promise<InternalEntryResponse[]> {
  if (rows.length === 0) return []
  const entryIds = rows.map(row => row.id)
  const authorIds = [...new Set(rows.map(row => row.created_by).filter((id): id is string => Boolean(id)))]
  const phaseIds = [...new Set(rows.map(row => row.phase_id).filter((id): id is string => Boolean(id)))]
  const activityIds = [...new Set(rows.map(row => row.activity_id).filter((id): id is string => Boolean(id)))]
  const requirementIds = [...new Set(rows.map(row => row.document_requirement_id).filter((id): id is string => Boolean(id)))]

  const [attachmentsResult, authorsResult, phasesResult, activitiesResult, requirementsResult] = await Promise.all([
    admin.from('project_internal_attachments')
      .select('id, entry_id, original_name, mime_type, file_size, created_at, uploaded_by')
      .in('entry_id', entryIds)
      .is('deleted_at', null)
      .not('uploaded_at', 'is', null)
      .order('created_at', { ascending: true }),
    authorIds.length
      ? admin.from('profiles').select('id, full_name').in('id', authorIds)
      : Promise.resolve({ data: [], error: null }),
    phaseIds.length
      ? admin.from('project_phases').select('id, name').eq('project_id', projectId).in('id', phaseIds)
      : Promise.resolve({ data: [], error: null }),
    activityIds.length
      ? admin.from('project_activities').select('id, name, phase_id').in('id', activityIds)
      : Promise.resolve({ data: [], error: null }),
    requirementIds.length
      ? admin.from('document_requirements').select('id, name').eq('project_id', projectId).in('id', requirementIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  const queryError = attachmentsResult.error || authorsResult.error || phasesResult.error || activitiesResult.error || requirementsResult.error
  if (queryError) throw queryError

  const activities = activitiesResult.data ?? []
  const activityPhaseIds = [...new Set(activities.map(row => row.phase_id))]
  const activityPhasesResult = activityPhaseIds.length
    ? await admin.from('project_phases').select('id').eq('project_id', projectId).in('id', activityPhaseIds)
    : { data: [], error: null }
  if (activityPhasesResult.error) throw activityPhasesResult.error

  const authors = new Map((authorsResult.data ?? []).map(author => [author.id, author.full_name]))
  const phases = new Map((phasesResult.data ?? []).map(phase => [phase.id, phase.name]))
  const projectPhaseIds = new Set((activityPhasesResult.data ?? []).map(phase => phase.id))
  const activityNames = new Map(activities
    .filter(activity => projectPhaseIds.has(activity.phase_id))
    .map(activity => [activity.id, activity.name]))
  const requirements = new Map((requirementsResult.data ?? []).map(requirement => [requirement.id, requirement.name]))
  const attachmentsByEntry = new Map<string, InternalAttachmentResponse[]>()
  for (const row of attachmentsResult.data ?? []) {
    const list = attachmentsByEntry.get(row.entry_id) ?? []
    list.push({
      id: row.id,
      original_name: row.original_name,
      mime_type: row.mime_type,
      file_size: row.file_size,
      created_at: row.created_at,
      uploaded_by: row.uploaded_by,
    })
    attachmentsByEntry.set(row.entry_id, list)
  }

  return rows.map(row => {
    let context: InternalEntryResponse['context'] = null
    if (row.phase_id && phases.has(row.phase_id)) {
      context = { type: 'phase', id: row.phase_id, label: phases.get(row.phase_id)! }
    } else if (row.activity_id && activityNames.has(row.activity_id)) {
      context = { type: 'activity', id: row.activity_id, label: activityNames.get(row.activity_id)! }
    } else if (row.document_requirement_id && requirements.has(row.document_requirement_id)) {
      context = { type: 'requirement', id: row.document_requirement_id, label: requirements.get(row.document_requirement_id)! }
    }
    return {
      ...row,
      author: {
        id: row.created_by,
        full_name: row.created_by ? authors.get(row.created_by) ?? 'Cont indisponibil' : 'Cont indisponibil',
      },
      context,
      attachments: attachmentsByEntry.get(row.id) ?? [],
    }
  })
}

export async function validateInternalEntryContext(
  admin: ServiceClient,
  projectId: string,
  context: { phase_id: string | null; activity_id: string | null; document_requirement_id: string | null },
) {
  if (context.phase_id) {
    const { data, error } = await admin.from('project_phases')
      .select('id').eq('id', context.phase_id).eq('project_id', projectId).maybeSingle()
    if (error) throw error
    return Boolean(data)
  }
  if (context.activity_id) {
    const { data: activity, error } = await admin.from('project_activities')
      .select('id, phase_id').eq('id', context.activity_id).maybeSingle()
    if (error) throw error
    if (!activity) return false
    const { data: phase, error: phaseError } = await admin.from('project_phases')
      .select('id').eq('id', activity.phase_id).eq('project_id', projectId).maybeSingle()
    if (phaseError) throw phaseError
    return Boolean(phase)
  }
  if (context.document_requirement_id) {
    const { data, error } = await admin.from('document_requirements')
      .select('id').eq('id', context.document_requirement_id).eq('project_id', projectId).maybeSingle()
    if (error) throw error
    return Boolean(data)
  }
  return true
}

export function internalAttachmentNotFound() {
  return Response.json({ error: 'Attachment not found' }, { status: 404 })
}

export function internalEntryNotFound() {
  return Response.json({ error: 'Internal entry not found' }, { status: 404 })
}
