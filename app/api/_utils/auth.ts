import { createClient } from '@supabase/supabase-js'
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!, // recomandat server-only (nu NEXT_PUBLIC)
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
)

function getBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

export async function requireAuth(request: Request) {
  const token = getBearerToken(request)
  if (!token) {
    return { ok: false as const, status: 401 as const, error: 'Missing Authorization Bearer token' }
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    return { ok: false as const, status: 401 as const, error: 'Invalid or expired token' }
  }

  return { ok: true as const, user: data.user }
}

export async function requireAdmin(request: Request) {
  const auth = await requireAuth(request)
  if (!auth.ok) return auth

  const callerId = auth.user.id

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single()

  if (profileError) {
    return { ok: false as const, status: 500 as const, error: 'Failed to verify user role' }
  }

  if (profile?.role !== 'admin') {
    return { ok: false as const, status: 403 as const, error: 'Forbidden: admin only' }
  }

  return { ok: true as const, user: auth.user, role: profile.role }
}

/**
 * Util când vrei: admin poate edita pe oricine, user poate edita doar pe el.
 */
export async function requireUserOrAdmin(request: Request, targetUserId: string) {
  const auth = await requireAuth(request)
  if (!auth.ok) return auth

  const callerId = auth.user.id
  if (callerId === targetUserId) {
    return { ok: true as const, user: auth.user, isAdmin: false as const }
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single()

  if (profileError) {
    return { ok: false as const, status: 500 as const, error: 'Failed to verify user role' }
  }

  if (profile?.role !== 'admin') {
    return { ok: false as const, status: 403 as const, error: 'Forbidden' }
  }

  return { ok: true as const, user: auth.user, isAdmin: true as const }
}
