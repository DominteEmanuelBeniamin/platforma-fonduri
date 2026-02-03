import { createSupabaseServiceClient } from './supabase'

export async function getRoleByUserId(userId: string) {
  const supabaseAdmin = createSupabaseServiceClient()
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !data?.role) {
    return { ok: false as const, status: 500 as const, error: 'Failed to verify user role' }
  }

  return { ok: true as const, role: data.role as string }
}

export async function getProjectClientId(projectId: string) {
  const supabaseAdmin = createSupabaseServiceClient()
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, client_id')
    .eq('id', projectId)
    .single()

  if (error || !data) {
    return { ok: false as const, status: 404 as const, error: 'Project not found' }
  }

  return { ok: true as const, project: data }
}

export async function isConsultantMemberOfProject(projectId: string, consultantId: string) {
  const supabaseAdmin = createSupabaseServiceClient()
  const { data, error } = await supabaseAdmin
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .eq('consultant_id', consultantId)
    .maybeSingle()

  if (error) {
    return { ok: false as const, status: 500 as const, error: 'Failed to verify membership' }
  }

  return { ok: true as const, isMember: !!data }
}

/**
 * Reguli:
 * - admin: acces la orice
 * - client: acces doar la proiectele lui
 * - consultant: acces doar dacă e membru (project_members)
 */
export async function requireProjectAccess(projectId: string, callerId: string) {
  const roleRes = await getRoleByUserId(callerId)
  if (!roleRes.ok) return roleRes

  const role = roleRes.role

  if (role === 'admin') {
    return { ok: true as const, role }
  }

  const projRes = await getProjectClientId(projectId)
  if (!projRes.ok) return projRes

  if (role === 'client') {
    if (projRes.project.client_id !== callerId) {
      return { ok: false as const, status: 403 as const, error: 'Forbidden' }
    }
    return { ok: true as const, role }
  }

  if (role === 'consultant') {
    const memRes = await isConsultantMemberOfProject(projectId, callerId)
    if (!memRes.ok) return memRes

    if (!memRes.isMember) {
      return { ok: false as const, status: 403 as const, error: 'Forbidden' }
    }

    return { ok: true as const, role }
  }

  return { ok: false as const, status: 403 as const, error: 'Forbidden' }
}