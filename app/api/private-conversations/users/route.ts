import { z } from 'zod'
import { guardToResponse, requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { canUsePrivateChat, canChatWithUser } from '@/app/api/_utils/private-chat-access'

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export async function GET(request: Request) {
  try {
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    if (!canUsePrivateChat(ctx.profile.role)) {
      return Response.json({ items: [] })
    }

    const url = new URL(request.url)
    const parsed = QuerySchema.safeParse({
      q: url.searchParams.get('q') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })

    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid query', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const { q, limit } = parsed.data
    const admin = createSupabaseServiceClient()

    // 🔍 search profiles
    let query = admin
      .from('profiles')
      .select('id, full_name, email, role')
      .neq('id', ctx.user.id)

    if (q) {
      query = query.or(
        `full_name.ilike.%${q}%,email.ilike.%${q}%`
      )
    }

    const { data: users, error } = await query.limit(limit)

    if (error) {
      console.error('Search users failed:', error)
      return Response.json({ error: 'Failed to search users' }, { status: 500 })
    }

    const eligibleUsers = (users ?? []).filter((u) =>
      canChatWithUser(
        { id: ctx.user.id, role: ctx.profile.role },
        { id: u.id, role: u.role }
      )
    )

    // 🔥 verificăm conversații existente
    const userIds = eligibleUsers.map((u) => u.id)

    let existingMap = new Map<string, string>()

    if (userIds.length > 0) {
      const { data: participants } = await admin
        .from('private_conversation_participants')
        .select('conversation_id, user_id')
        .in('user_id', [ctx.user.id, ...userIds])

      const grouped = new Map<string, Set<string>>()

      for (const row of participants ?? []) {
        if (!grouped.has(row.conversation_id)) {
          grouped.set(row.conversation_id, new Set())
        }
        grouped.get(row.conversation_id)!.add(row.user_id)
      }

      for (const [conversationId, usersSet] of grouped.entries()) {
        if (usersSet.size !== 2) continue

        if (usersSet.has(ctx.user.id)) {
          for (const otherId of usersSet) {
            if (otherId !== ctx.user.id) {
              existingMap.set(otherId, conversationId)
            }
          }
        }
      }
    }

    const items = eligibleUsers.map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      hasConversation: existingMap.has(u.id),
      conversationId: existingMap.get(u.id) ?? null,
    }))

    return Response.json({ items })
  } catch (err) {
    console.error('GET private chat users unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}