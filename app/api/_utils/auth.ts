// app/api/_utils/auth.ts
import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient, createSupabaseServiceClient } from './supabase'

export type AppRole = 'admin' | 'consultant' | 'client'

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
): Promise<Result<{ user: User; profile: { id: string; role: AppRole; email?: string | null } }>> {
  const auth = await requireUser(request)
  if (!auth.ok) return auth

  const supabase = createSupabaseServerClient(request)
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, email')
    .eq('id', auth.user.id)
    .single()

  if (error || !profile?.role) {
    return { ok: false, status: 500, error: 'Failed to load user profile' }
  }

  return { ok: true, user: auth.user, profile: { id: profile.id, role: profile.role as AppRole, email: profile.email } }
}

export async function requireAdmin(
  request: Request
): Promise<Result<{ user: User; profile: { id: string; role: 'admin'; email?: string | null } }>> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  if (ctx.profile.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden: admin only' }
  }

  return { ok: true, user: ctx.user, profile: { ...ctx.profile, role: 'admin' } }
}

/**
 * admin poate acționa pe oricine, user doar pe el
 */
export async function requireUserOrAdmin(
  request: Request,
  targetUserId: string
): Promise<Result<{ user: User; profile: { id: string; role: AppRole; email?: string | null }; isAdmin: boolean }>> {
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
  | { role: 'consultant'; projectId: string; membershipId: string }
  | { role: 'client'; projectId: string }

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
    profile: { id: string; role: AppRole; email?: string | null }
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

    return { ok: true, user, profile, access: { role: 'consultant', projectId, membershipId: membership.id } }
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
 * Helper: cum răspunzi consistent din route.ts când un guard dă eroare
 */
export function guardToResponse(err: { status: number; error: string }) {
  return Response.json({ error: err.error }, { status: err.status })
}