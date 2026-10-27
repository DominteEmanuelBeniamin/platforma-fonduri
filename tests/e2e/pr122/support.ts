// Infrastructura comună pentru E2E-ul PR #122 (șabloane compacte, tabelul proiectului,
// calendar, alegătorul de responsabil, încărcarea clientului, tooltip-uri).
// Totul rulează local: Next pe loopback, Supabase local și simulatorul Resend
// (tests/e2e/helpers/resend-mock.mjs), pornit separat, ca și serverul.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { BUCKET, e2eEnv, requireE2EConfig } from '../helpers/project-state'

export const env = e2eEnv()
export const config = requireE2EConfig(env)

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
for (const value of [config.baseUrl, config.supabaseUrl]) {
  if (!LOOPBACK.has(new URL(value).hostname)) {
    throw new Error('Testele #122 rulează numai pe loopback; ' + value + ' nu e local')
  }
}

/** Tot ce creează testele poartă prefixul ăsta; curățarea finală îl caută. */
export const PREFIX = 'E2E122'
export const ACCOUNT_PREFIX = 'e2e122.'
export const REPORT_DIR = path.join('playwright-report', 'pr122')
/** Jurnalul simulatorului Resend, scris de resend-mock.mjs. */
export const RESEND_LOG = env.E2E_RESEND_LOG || path.join(REPORT_DIR, 'resend.jsonl')

const authOptions = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
export const service: SupabaseClient = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: authOptions })
export const anon = () => createClient(config.supabaseUrl, config.anonKey, { auth: authOptions })

export const q = (value: string) => "'" + value.replaceAll("'", "''") + "'"

/** SQL pe baza locală; folosit numai pentru seed înainte de acțiune și pentru verificări după ea. */
export function sql(query: string): string {
  try {
    return execFileSync('docker', ['exec', '-i', process.env.E2E_DB_CONTAINER || 'supabase_db_platforma-fonduri', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'], {
      input: "set statement_timeout='15s'; " + query,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '')
    throw new Error('SQL local eșuat: ' + (stderr.match(/ERROR:.*$/m)?.[0] ?? 'eroare necunoscută'))
  }
}

export function sqlJson<T>(query: string): T {
  return JSON.parse(sql(query) || 'null') as T
}

export function ensureReportDir(...parts: string[]) {
  const dir = path.join(REPORT_DIR, ...parts)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const tag = () => randomUUID().slice(0, 8)

// ── Conturile efemere ───────────────────────────────────────────────────────────

export type Role = 'admin' | 'senior' | 'junior' | 'client'

export type Account = {
  id: string
  email: string
  password: string
  fullName: string
  role: Role
}

function seedAdminId(): string {
  const id = sql('select id from public.profiles where email=' + q(env.E2E_ADMIN_EMAIL ?? '') + " and role='admin' and is_active")
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Adminul seed (E2E_ADMIN_EMAIL) lipsește sau nu e admin activ; e necesar pentru curățare')
  return id
}

/** Conturile unui worker sau ale unui test; curățarea le șterge sau, cu istoric, le dezactivează. */
export class AccountRegistry {
  readonly created: Account[] = []
  constructor(private readonly label: string) {}

  async create(role: Role, fullName: string): Promise<Account> {
    const n = this.created.length + 1
    const email = `${ACCOUNT_PREFIX}${this.label}.${tag()}.${n}@example.invalid`
    const password = 'Pr122-' + randomUUID()
    const made = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (made.error || !made.data.user) throw new Error('Nu am putut crea contul de test: ' + made.error?.message)
    const account: Account = { id: made.data.user.id, email, password, fullName, role }
    this.created.push(account)
    const profile = await service.from('profiles').update({
      role: role === 'senior' || role === 'junior' ? 'consultant' : role,
      consultant_level: role === 'senior' ? 'senior' : 'junior',
      full_name: fullName,
    }).eq('id', account.id)
    if (profile.error) throw new Error('Nu am putut pregăti profilul de test: ' + profile.error.message)
    return account
  }

  /** Conturile fără istoric se șterg; cele cu audit de autor rămân, dar dezactivate (audit append-only). */
  async cleanup() {
    const actor = seedAdminId()
    for (const account of [...this.created].reverse()) {
      const deleted = await service.rpc('delete_empty_user_account', { p_actor_id: actor, p_target_id: account.id })
      if (deleted.error || deleted.data?.deleted !== true) {
        const inactive = await service.rpc('set_user_account_active', { p_actor_id: actor, p_target_id: account.id, p_active: false })
        if (inactive.error && sql('select is_active from public.profiles where id=' + q(account.id)) === 't') {
          throw new Error('Contul de test ' + account.email + ' a rămas activ: ' + inactive.error.message)
        }
      }
    }
    this.created.length = 0
  }
}

export function activeTestAccounts(): number {
  return Number(sql(`select count(*) from public.profiles where email like '${ACCOUNT_PREFIX}%' and is_active`))
}

// ── Seed: proiecte și șabloane ──────────────────────────────────────────────────

export type RequestSeed = {
  name: string
  status?: 'pending' | 'review' | 'approved' | 'rejected' | 'closed'
  deadline?: string | null
  visibility?: 'draft' | 'published'
  outgoing?: boolean
  assignedTo?: string | null
}

export type ActivitySeed = {
  name: string
  assignedTo?: string | null
  deadline?: string | null
  visibility?: 'draft' | 'published'
  status?: 'pending' | 'in_progress' | 'completed'
  requests?: RequestSeed[]
}

export type PhaseSeed = {
  name: string
  visibility?: 'draft' | 'published'
  projectStatusId?: string | null
  activities?: ActivitySeed[]
}

export type ProjectSeed = {
  label: string
  client: Account
  /** Consultanții membri; adminul vede orice proiect fără să fie membru. */
  members: Account[]
  generalConsultant?: Account | null
  phases: PhaseSeed[]
  /** Cereri fără activitate („Cereri generale”) și documente trimise. */
  general?: RequestSeed[]
}

export type SeededProject = {
  id: string
  title: string
  phases: Map<string, string>
  activities: Map<string, string>
  requests: Map<string, string>
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) throw new Error(`${what}: ${result.error?.message ?? 'fără rând'}`)
  return result.data
}

/** Proiectul de test, scris direct în bază: e starea de pornire, nu ce verifică testul. */
export async function seedProject(seed: ProjectSeed): Promise<SeededProject> {
  const id = randomUUID()
  const title = `${PREFIX} ${seed.label} ${id.slice(0, 6)}`
  const actor = seed.members[0]?.id ?? null
  must(await service.from('projects').insert({
    id,
    title,
    client_id: seed.client.id,
    status: 'contractare',
    general_consultant_id: seed.generalConsultant?.id ?? null,
  }).select('id').single(), 'crearea proiectului de test')
  const out: SeededProject = { id, title, phases: new Map(), activities: new Map(), requests: new Map() }
  if (seed.members.length) {
    const r = await service.from('project_members').insert(seed.members.map(m => ({ project_id: id, consultant_id: m.id, role_in_project: 'member' })))
    if (r.error) throw new Error('membrii proiectului de test: ' + r.error.message)
  }

  let requestOrder = 0
  const insertRequests = async (activityId: string | null, requests: RequestSeed[] = []) => {
    for (const r of requests) {
      const rid = randomUUID()
      const status = r.status ?? 'pending'
      const closed = status === 'closed'
      must(await service.from('document_requirements').insert({
        id: rid,
        project_id: id,
        activity_id: activityId,
        name: r.name,
        order_index: ++requestOrder,
        requirement_type: r.outgoing ? 'optional' : 'obligatoriu',
        is_mandatory: !r.outgoing,
        is_outgoing: r.outgoing ?? false,
        deadline_at: r.deadline ?? null,
        status: closed ? 'closed' : status,
        status_before_close: closed ? 'pending' : null,
        closed_at: closed ? new Date().toISOString() : null,
        visibility: r.visibility ?? 'published',
        is_locked: false,
        assigned_to: r.assignedTo ?? null,
        created_by: actor,
      }).select('id').single(), `cererea ${r.name}`)
      out.requests.set(r.name, rid)
    }
  }

  for (const [pi, phase] of seed.phases.entries()) {
    const pid = randomUUID()
    must(await service.from('project_phases').insert({
      id: pid,
      project_id: id,
      name: phase.name,
      slug: `e2e122-${pid.slice(0, 8)}`,
      order_index: pi + 1,
      status: 'pending',
      visibility: phase.visibility ?? 'published',
      project_status_id: phase.projectStatusId ?? null,
    }).select('id').single(), `faza ${phase.name}`)
    out.phases.set(phase.name, pid)
    for (const [ai, activity] of (phase.activities ?? []).entries()) {
      const aid = randomUUID()
      const completed = activity.status === 'completed'
      must(await service.from('project_activities').insert({
        id: aid,
        phase_id: pid,
        name: activity.name,
        order_index: ai + 1,
        status: activity.status ?? 'pending',
        completed_at: completed ? new Date().toISOString() : null,
        visibility: activity.visibility ?? 'published',
        assigned_to: activity.assignedTo ?? null,
        assigned_by: activity.assignedTo ? actor : null,
        deadline_at: activity.deadline ?? null,
      }).select('id').single(), `activitatea ${activity.name}`)
      out.activities.set(activity.name, aid)
      await insertRequests(aid, activity.requests)
    }
  }
  await insertRequests(null, seed.general)
  return out
}

/** Căile din Storage legate de cererile unui proiect: fișierele clientului și modelele. */
export function projectStoragePaths(projectId: string): string[] {
  const raw = sql(`select coalesce(json_agg(p), '[]') from (
      select f.storage_path p from files f join document_requirements d on d.id=f.requirement_id where d.project_id=${q(projectId)}
      union select a.storage_path from document_requirement_attachments a join document_requirements d on d.id=a.document_requirement_id where d.project_id=${q(projectId)}
      union select attachment_path from document_requirements where project_id=${q(projectId)} and attachment_path is not null
    ) x where p is not null`)
  return JSON.parse(raw) as string[]
}

/**
 * Șterge proiectul cu tot ce ține de el. Fișierele-model importate dintr-un
 * șablon împart calea cu șablonul, deci nu se șterg aici: le șterge
 * `destroyTemplate`, după ce proiectele care le folosesc au plecat.
 */
export async function destroyProject(projectId: string) {
  const shared = new Set(JSON.parse(sql(`select coalesce(json_agg(storage_path), '[]') from document_requirement_attachments where template_document_requirement_id is not null`)) as string[])
  const paths = projectStoragePaths(projectId).filter(p => !shared.has(p))
  if (paths.length) {
    const removed = await service.storage.from(BUCKET).remove(paths)
    if (removed.error) throw new Error('ștergerea fișierelor proiectului: ' + removed.error.message)
  }
  const r = await service.from('projects').delete().eq('id', projectId)
  if (r.error) throw new Error('ștergerea proiectului de test: ' + r.error.message)
}

/** Șablonul și fișierele lui model. Proiectele care îl folosesc trebuie șterse înainte. */
export async function destroyTemplate(templateId: string) {
  const paths = JSON.parse(sql(`select coalesce(json_agg(p), '[]') from (
      select a.storage_path p from document_requirement_attachments a
        join template_document_requirements d on d.id=a.template_document_requirement_id
        join template_activities ta on ta.id=d.template_activity_id
        join template_phases tp on tp.id=ta.template_phase_id where tp.template_id=${q(templateId)}
      union select d.attachment_path from template_document_requirements d
        join template_activities ta on ta.id=d.template_activity_id
        join template_phases tp on tp.id=ta.template_phase_id where tp.template_id=${q(templateId)} and d.attachment_path is not null
    ) x where p is not null`)) as string[]
  const r = await service.from('project_templates').delete().eq('id', templateId)
  if (r.error) throw new Error('ștergerea șablonului de test: ' + r.error.message)
  if (paths.length) {
    const removed = await service.storage.from(BUCKET).remove(paths)
    if (removed.error) throw new Error('ștergerea fișierelor-model: ' + removed.error.message)
  }
}

export type TemplateSeed = {
  label: string
  status?: 'draft' | 'published'
  phases: { name: string; projectStatusId?: string | null; activities?: { name: string; requests?: string[] }[] }[]
}

/** Un șablon scris direct în bază, cu fazele lui (inclusiv faze vechi fără status). */
export async function seedTemplate(seed: TemplateSeed): Promise<{ id: string; name: string }> {
  const id = randomUUID()
  const name = `${PREFIX} ${seed.label} ${id.slice(0, 6)}`
  must(await service.from('project_templates').insert({
    id, name, slug: `e2e122-${id.slice(0, 8)}`, status: seed.status ?? 'draft', is_active: true,
  }).select('id').single(), 'crearea șablonului de test')
  for (const [pi, phase] of seed.phases.entries()) {
    const pid = randomUUID()
    must(await service.from('template_phases').insert({
      id: pid, template_id: id, name: phase.name, slug: `e2e122-${pid.slice(0, 8)}`, order_index: pi + 1,
      project_status_id: phase.projectStatusId ?? null, is_active: true,
    }).select('id').single(), `faza de șablon ${phase.name}`)
    for (const [ai, activity] of (phase.activities ?? []).entries()) {
      const aid = randomUUID()
      must(await service.from('template_activities').insert({
        id: aid, template_phase_id: pid, name: activity.name, order_index: ai + 1, is_active: true,
      }).select('id').single(), `activitatea de șablon ${activity.name}`)
      for (const [di, doc] of (activity.requests ?? []).entries()) {
        must(await service.from('template_document_requirements').insert({
          template_activity_id: aid, name: doc, order_index: di + 1, is_active: true,
          requirement_type: 'obligatoriu', is_mandatory: true, is_outgoing: false,
        }).select('id').single(), `cererea de șablon ${doc}`)
      }
    }
  }
  return { id, name }
}

/** Statusurile de proiect active, în ordinea în care le dă API-ul editorului. */
export function projectStatuses(): { id: string; name: string }[] {
  return sqlJson(`select coalesce(json_agg(json_build_object('id', id, 'name', name) order by order_index, name), '[]') from project_statuses where is_active`)
}

/** Ce a rămas de la o rulare întreruptă: proiecte, șabloane, conturi. */
export async function cleanupLeftovers() {
  const projects = JSON.parse(sql(`select coalesce(json_agg(id), '[]') from projects where title like '${PREFIX} %'`)) as string[]
  for (const id of projects) await destroyProject(id)
  const templates = JSON.parse(sql(`select coalesce(json_agg(id), '[]') from project_templates where name like '${PREFIX} %'`)) as string[]
  for (const id of templates) await destroyTemplate(id)
  const rows = JSON.parse(sql(`select coalesce(json_agg(json_build_object('id',id,'email',email)), '[]') from profiles where email like '${ACCOUNT_PREFIX}%' and is_active`)) as { id: string; email: string }[]
  const registry = new AccountRegistry('leftover')
  for (const row of rows) registry.created.push({ id: row.id, email: row.email, password: '', fullName: '', role: 'client' })
  await registry.cleanup()
}

export function leftovers() {
  return {
    activeTestAccounts: activeTestAccounts(),
    projects: Number(sql(`select count(*) from projects where title like '${PREFIX} %'`)),
    templates: Number(sql(`select count(*) from project_templates where name like '${PREFIX} %'`)),
    storageObjects: Number(sql(`select count(*) from storage.objects where bucket_id='${BUCKET}'`)),
  }
}

// ── Simulatorul Resend ──────────────────────────────────────────────────────────

export type LoggedEmail = { at: string; path: string; body: { to?: unknown; subject?: string; text?: string; html?: string } | null }

/** Emailurile prinse de simulator de la `since` încoace. */
export function emailsSince(since: number): LoggedEmail[] {
  if (!fs.existsSync(RESEND_LOG)) return []
  return fs.readFileSync(RESEND_LOG, 'utf8').split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as LoggedEmail)
    .filter(item => Date.parse(item.at) >= since)
}

// ── Fișiere ─────────────────────────────────────────────────────────────────────

export const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n% ${name} ${randomUUID()}\n%%EOF\n`),
})

/** Obiectul din Storage există și are conținutul încărcat. */
export async function storageText(storagePath: string): Promise<string | null> {
  const { data, error } = await service.storage.from(BUCKET).download(storagePath)
  if (error || !data) return null
  return await data.text()
}

export { BUCKET }
