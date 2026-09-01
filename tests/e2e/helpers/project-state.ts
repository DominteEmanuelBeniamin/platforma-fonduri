import fs from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'project-files'

/** Citește un fișier `.env` simplu, fără dependențe. */
export function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .filter(line => line.includes('=') && !line.trim().startsWith('#'))
      .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()] })
  )
}

/**
 * Client cu cheia de service, folosit exclusiv la curățarea de după teste:
 * testele scriu prin interfață, dar ștergerea din interfață mută cererile la
 * „Cereri generale” în loc să le șteargă, deci ar lăsa gunoi în proiect.
 */
export function serviceClient(): SupabaseClient | null {
  const env = { ...readEnvFile('.env.local'), ...process.env } as Record<string, string>
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export type ProjectSnapshot = {
  phases: { id: string; order_index: number }[]
  activityIds: string[]
}

/** Starea de dinaintea testului: ce faze există, în ce ordine, și ce activități. */
export async function snapshotProject(admin: SupabaseClient, projectId: string): Promise<ProjectSnapshot> {
  const { data: phases } = await admin
    .from('project_phases').select('id, order_index').eq('project_id', projectId).order('order_index')
  const { data: activities } = await admin
    .from('project_activities').select('id').in('phase_id', (phases ?? []).map(p => p.id))
  return {
    phases: (phases ?? []).map(p => ({ id: p.id, order_index: p.order_index })),
    activityIds: (activities ?? []).map(a => a.id),
  }
}

async function purgeActivities(admin: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return
  const { data: requests } = await admin
    .from('document_requirements').select('id, attachment_path').in('activity_id', ids)
  const requestIds = (requests ?? []).map(r => r.id)
  const { data: attachments } = await admin
    .from('document_requirement_attachments').select('storage_path').in('document_requirement_id', requestIds)

  const paths = [...new Set([
    ...(attachments ?? []).map(a => a.storage_path),
    ...(requests ?? []).map(r => r.attachment_path),
  ].filter(Boolean))] as string[]
  if (paths.length) await admin.storage.from(BUCKET).remove(paths)

  if (requestIds.length) {
    await admin.from('document_requirement_attachments').delete().in('document_requirement_id', requestIds)
    await admin.from('files').delete().in('requirement_id', requestIds)
    await admin.from('document_requirements').delete().in('id', requestIds)
  }
  await admin.from('project_activities').delete().in('id', ids)
  await admin.from('audit_logs').delete().in('entity_id', ids)
}

/**
 * Aduce proiectul exact la starea din snapshot: șterge fazele și activitățile
 * apărute în timpul testului, cu tot cu cererile și obiectele lor din storage,
 * apoi pune la loc ordinea fazelor, deplasată de inserarea copiilor.
 */
export async function restoreProject(admin: SupabaseClient, projectId: string, snapshot: ProjectSnapshot) {
  const keep = new Set(snapshot.phases.map(p => p.id))

  const { data: phases } = await admin.from('project_phases').select('id').eq('project_id', projectId)
  for (const phase of (phases ?? []).filter(p => !keep.has(p.id))) {
    const { data: activities } = await admin.from('project_activities').select('id').eq('phase_id', phase.id)
    await purgeActivities(admin, (activities ?? []).map(a => a.id))
    await admin.from('project_phases').delete().eq('id', phase.id)
    await admin.from('audit_logs').delete().eq('entity_id', phase.id)
  }

  const { data: remaining } = await admin.from('project_activities').select('id').in('phase_id', [...keep])
  const known = new Set(snapshot.activityIds)
  await purgeActivities(admin, (remaining ?? []).map(a => a.id).filter(id => !known.has(id)))

  for (const phase of snapshot.phases) {
    await admin.from('project_phases').update({ order_index: phase.order_index }).eq('id', phase.id)
  }
}

/** O fază din proiect care are cel puțin o activitate, ca testele să nu fixeze un nume. */
export async function phaseWithActivities(admin: SupabaseClient, projectId: string) {
  const { data: phases } = await admin
    .from('project_phases').select('id, name').eq('project_id', projectId).order('order_index')
  for (const phase of phases ?? []) {
    const { data: activities } = await admin
      .from('project_activities').select('id, name').eq('phase_id', phase.id).order('order_index')
    if (activities && activities.length > 0) {
      return { phaseId: phase.id, phaseName: phase.name, activity: activities[0] }
    }
  }
  return null
}
