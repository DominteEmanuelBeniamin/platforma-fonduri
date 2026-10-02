// app/api/_utils/auth.ts
import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient, createSupabaseServiceClient } from './supabase'
import type { ProjectPermissions } from '@/lib/project-permissions'

export type AppRole = 'admin' | 'consultant' | 'client'
export type TemplateStatus = 'draft' | 'published'
export type TemplatePermission = 'read' | 'edit' | 'publish'
export type ConsultantLevel = 'junior' | 'senior'
export type AppProfile = {
  id: string
  role: AppRole
  email?: string | null
  consultant_level: ConsultantLevel
}

type Ok<T> = { ok: true } & T
type Err = { ok: false; status: number; error: string }
export type Result<T> = Ok<T> | Err

function getBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

export async function requireUser(request: Request): Promise<Result<{ user: User }>> {
  const token = getBearerToken(request)
  if (!token) {
    return { ok: false, status: 401, error: 'Missing Authorization Bearer token' }
  }

  // IMPORTANT: validate token in user-context (anon + Authorization header)
  const supabase = createSupabaseServerClient(request)
  const { data, error } = await supabase.auth.getUser()

  if (error || !data?.user) {
    return { ok: false, status: 401, error: 'Invalid or expired token' }
  }

  return { ok: true, user: data.user }
}

export async function requireProfile(
  request: Request
): Promise<Result<{ user: User; profile: AppProfile }>> {
  const auth = await requireUser(request)
  if (!auth.ok) return auth

  const supabase = createSupabaseServerClient(request)
  // `*` și nu o listă de coloane: dacă deploy-ul ajunge înaintea migrației
  // pentru consultant_level, nivelul lipsește (= junior) în loc să dea 500
  // la fiecare cerere autentificată.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .single()

  if (error || !profile?.role) {
    return { ok: false, status: 500, error: 'Failed to load user profile' }
  }

  return {
    ok: true,
    user: auth.user,
    profile: {
      id: profile.id,
      role: profile.role as AppRole,
      email: profile.email,
      consultant_level: profile.consultant_level === 'senior' ? 'senior' : 'junior',
    },
  }
}

export async function requireAdmin(
  request: Request
): Promise<Result<{ user: User; profile: AppProfile & { role: 'admin' } }>> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  if (ctx.profile.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden: admin only' }
  }

  return { ok: true, user: ctx.user, profile: { ...ctx.profile, role: 'admin' } }
}

/**
 * Consultantul senior are drepturi în plus (issue #104). Nivelul se citește
 * din profil la fiecare cerere, deci o retrogradare are efect imediat.
 */
export function isSeniorConsultant(profile: Pick<AppProfile, 'role' | 'consultant_level'>) {
  return profile.role === 'consultant' && profile.consultant_level === 'senior'
}

export function canReadTemplate(role: AppRole) {
  return role === 'admin' || role === 'consultant'
}

export function canEditTemplate(
  profile: Pick<AppProfile, 'role' | 'consultant_level'>,
  status: TemplateStatus | null | undefined,
) {
  if (profile.role === 'admin' || isSeniorConsultant(profile)) return true
  return profile.role === 'consultant' && status === 'draft'
}

/** Ștergerea și duplicarea unui șablon: admin sau consultant senior. */
export function canManageTemplates(profile: Pick<AppProfile, 'role' | 'consultant_level'>) {
  return profile.role === 'admin' || isSeniorConsultant(profile)
}

export function canPublishTemplate(role: AppRole) {
  return role === 'admin'
}

/** Ștergerea și duplicarea șabloanelor: admin sau consultant senior, altfel 403. */
export async function requireTemplateManager(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx
  if (!canManageTemplates(ctx.profile)) {
    return { ok: false as const, status: 403, error: 'Forbidden: template management denied' }
  }
  return ctx
}

export async function requireTemplateAccess(
  request: Request,
  templateId: string,
  permission: TemplatePermission,
) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  if (permission === 'read' && !canReadTemplate(ctx.profile.role)) {
    return { ok: false as const, status: 403, error: 'Forbidden: template access denied' }
  }

  const admin = createSupabaseServiceClient()
  const { data: template, error } = await admin
    .from('project_templates')
    .select('id, name, status, is_active')
    .eq('id', templateId)
    .maybeSingle()

  if (error) return { ok: false as const, status: 500, error: 'Failed to load template' }
  if (!template) return { ok: false as const, status: 404, error: 'Template not found' }

  const status: TemplateStatus = template.status === 'draft' ? 'draft' : 'published'
  const allowed = permission === 'read'
    ? canReadTemplate(ctx.profile.role)
    : permission === 'edit'
    ? canEditTemplate(ctx.profile, status)
    : canPublishTemplate(ctx.profile.role)

  if (!allowed) {
    return { ok: false as const, status: 403, error: 'Forbidden: template modification denied' }
  }

  return {
    ok: true as const,
    user: ctx.user,
    profile: ctx.profile,
    template: { ...template, status },
  }
}

/**
 * admin poate acționa pe oricine, user doar pe el
 */
export async function requireUserOrAdmin(
  request: Request,
  targetUserId: string
): Promise<Result<{ user: User; profile: AppProfile; isAdmin: boolean }>> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  if (ctx.user.id === targetUserId) {
    return { ok: true, user: ctx.user, profile: ctx.profile, isAdmin: ctx.profile.role === 'admin' }
  }

  if (ctx.profile.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  return { ok: true, user: ctx.user, profile: ctx.profile, isAdmin: true }
}

export type ProjectAccess =
  | { role: 'admin'; projectId: string }
  | { role: 'consultant'; projectId: string; membershipId: string; level: ConsultantLevel }
  | { role: 'client'; projectId: string }

/**
 * Singurul loc care decide cine administrează un proiect: adminul și
 * consultantul senior membru (requireProjectAccess a verificat deja
 * apartenența). Ștergerea proiectului și reasignarea clientului/consultantului
 * general rămân la admin și nu trec prin acest helper.
 */
export function canManageProject(access: ProjectAccess) {
  return access.role === 'admin' || (access.role === 'consultant' && access.level === 'senior')
}

/** Permisiunile trimise interfeței, ca să nu repete logica pe roluri. */
export function projectPermissions(access: ProjectAccess): ProjectPermissions {
  const manage = canManageProject(access)
  return {
    edit_project: manage,
    reassign_project: access.role === 'admin',
    delete_project: access.role === 'admin',
    delete_phases: manage,
    manage_team: manage,
    remove_any_member: access.role === 'admin',
    moderate_chat: manage,
    edit_others_messages: access.role === 'admin',
  }
}

/**
 * Verifică accesul la proiect conform regulilor tale:
 * - admin: orice proiect
 * - consultant: doar dacă e membru în project_members
 * - client: doar dacă projects.client_id == user.id
 */
export async function requireProjectAccess(
  request: Request,
  projectId: string
): Promise<
  Result<{
    user: User
    profile: AppProfile
    access: ProjectAccess
  }>
> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  const { user, profile } = ctx

  // folosim service client pt verificări rapide (și ca să nu depindă de RLS),
  // DAR decizia e a noastră, pe baza profile.role + relații.
  const admin = createSupabaseServiceClient()

  if (profile.role === 'admin') {
    return { ok: true, user, profile, access: { role: 'admin', projectId } }
  }

  if (profile.role === 'consultant') {
    const { data: membership, error } = await admin
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('consultant_id', user.id)
      .maybeSingle()

    if (error) return { ok: false, status: 500, error: 'Failed to verify consultant membership' }
    if (!membership) return { ok: false, status: 403, error: 'Forbidden: not a member of this project' }

    return {
      ok: true,
      user,
      profile,
      access: { role: 'consultant', projectId, membershipId: membership.id, level: profile.consultant_level },
    }
  }

  // client
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, client_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projectError) {
    console.error('Failed to verify client project access:', {
      projectId,
      userId: user.id,
      error: projectError
    })
    return { ok: false, status: 500, error: 'Failed to verify client project access' }
  }

  if (!project) {
    console.error('Project not found:', { projectId, userId: user.id })
    return { ok: false, status: 404, error: 'Project not found' }
  }

  if (project.client_id !== user.id) {
    console.error('Client access denied:', {
      projectId,
      userId: user.id,
      clientId: project.client_id
    })
    return { ok: false, status: 403, error: 'Forbidden: not your project' }
  }

  return { ok: true, user, profile, access: { role: 'client', projectId } }
}

/**
 * requireProjectAccess + canManageProject: admin sau senior membru, altfel 403.
 */
export async function requireProjectManager(request: Request, projectId: string) {
  const ctx = await requireProjectAccess(request, projectId)
  if (!ctx.ok) return ctx
  if (!canManageProject(ctx.access)) {
    return { ok: false as const, status: 403, error: 'Forbidden: project management denied' }
  }
  return ctx
}

/**
 * Helper: cum răspunzi consistent din route.ts când un guard dă eroare
 */
export function guardToResponse(err: { status: number; error: string }) {
  return Response.json({ error: err.error }, { status: err.status })
}
