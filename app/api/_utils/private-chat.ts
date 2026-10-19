import { createSupabaseServiceClient } from './supabase'
import type { AppRole, Result } from './auth'
import { requireProfile } from './auth'
import { canChatWithUser } from './private-chat-access'
import { inactiveReferenceConflict } from './inactive-reference'
import { chatTimestampMicroseconds } from '@/lib/chat-timestamp'

const POSTGREST_PAGE_SIZE = 1000
const CONVERSATION_IDS_PER_BATCH = 50

type PrivateConversationReadRow = {
  conversation_id: string
  last_read_at: string | null
}

async function forEachPostgrestPage<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  consume: (rows: T[]) => boolean | void
) {
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + POSTGREST_PAGE_SIZE - 1)
    if (error) throw error

    const page = data ?? []
    const shouldContinue = consume(page)
    if (page.length < POSTGREST_PAGE_SIZE || shouldContinue === false) return
  }
}

function batches<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let from = 0; from < values.length; from += size) {
    result.push(values.slice(from, from + size))
  }
  return result
}

export type PrivateConversation = {
  id: string
  created_at: string
  created_by: string
  last_message_at: string | null
}

export type PrivateConversationParticipant = {
  conversation_id: string
  user_id: string
  joined_at: string
  last_read_at: string | null
}

export type PrivateMessage = {
  id: string
  conversation_id: string
  created_by: string
  body: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export async function requirePrivateConversationParticipant(
  request: Request,
  conversationId: string
): Promise<
  Result<{
    user: { id: string }
    profile: { id: string; role: AppRole; email?: string | null }
    participant: PrivateConversationParticipant
  }>
> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  const admin = createSupabaseServiceClient()

  const { data: participant, error } = await admin
    .from('private_conversation_participants')
    .select('conversation_id, user_id, joined_at, last_read_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', ctx.user.id)
    .maybeSingle()

  if (error) {
    console.error('Failed to verify private conversation participant:', {
      conversationId,
      userId: ctx.user.id,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to verify conversation access' }
  }

  if (!participant) {
    return { ok: false, status: 403, error: 'Forbidden: not a participant in this conversation' }
  }

  return {
    ok: true,
    user: { id: ctx.user.id },
    profile: ctx.profile,
    participant,
  }
}

export async function requirePrivateMessageOwner(
  request: Request,
  messageId: string
): Promise<
  Result<{
    user: { id: string }
    profile: { id: string; role: AppRole; email?: string | null }
    message: PrivateMessage
  }>
> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  const admin = createSupabaseServiceClient()

  const { data: message, error } = await admin
    .from('private_messages')
    .select('id, conversation_id, created_by, body, created_at, edited_at, deleted_at')
    .eq('id', messageId)
    .maybeSingle()

  if (error) {
    console.error('Failed to load private message:', {
      messageId,
      userId: ctx.user.id,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to load message' }
  }

  if (!message) {
    return { ok: false, status: 404, error: 'Message not found' }
  }

  if (message.created_by !== ctx.user.id) {
    return { ok: false, status: 403, error: 'Forbidden: not your message' }
  }

  return {
    ok: true,
    user: { id: ctx.user.id },
    profile: ctx.profile,
    message,
  }
}

async function findExistingPrivateConversationBetweenUsers(
  userA: string,
  userB: string
): Promise<Result<{ conversation: PrivateConversation | null }>> {
  if (userA === userB) {
    return { ok: false, status: 400, error: 'You cannot start a private conversation with yourself' }
  }

  const admin = createSupabaseServiceClient()

  const { data: participantRows, error } = await admin
    .from('private_conversation_participants')
    .select('conversation_id, user_id')
    .in('user_id', [userA, userB])

  if (error) {
    console.error('Failed to search existing private conversation:', {
      userA,
      userB,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to search existing conversation' }
  }

  if (!participantRows?.length) {
    return { ok: true, conversation: null }
  }

  const grouped = new Map<string, Set<string>>()

  for (const row of participantRows) {
    if (!grouped.has(row.conversation_id)) {
      grouped.set(row.conversation_id, new Set())
    }
    grouped.get(row.conversation_id)!.add(row.user_id)
  }

  const candidateIds = [...grouped.entries()]
    .filter(([, users]) => users.has(userA) && users.has(userB))
    .map(([conversationId]) => conversationId)

  if (!candidateIds.length) {
    return { ok: true, conversation: null }
  }

  // verificăm că este conversație strict 1 la 1, nu una cu mai mulți participanți
  const { data: allParticipants, error: countError } = await admin
    .from('private_conversation_participants')
    .select('conversation_id, user_id')
    .in('conversation_id', candidateIds)

  if (countError) {
    console.error('Failed to validate private conversation participants:', {
      candidateIds,
      error: countError,
    })
    return { ok: false, status: 500, error: 'Failed to validate conversation participants' }
  }

  const totals = new Map<string, Set<string>>()

  for (const row of allParticipants || []) {
    if (!totals.has(row.conversation_id)) {
      totals.set(row.conversation_id, new Set())
    }
    totals.get(row.conversation_id)!.add(row.user_id)
  }

  const exactConversationId = [...totals.entries()].find(
    ([, users]) => users.size === 2 && users.has(userA) && users.has(userB)
  )?.[0]

  if (!exactConversationId) {
    return { ok: true, conversation: null }
  }

  const { data: conversation, error: conversationError } = await admin
    .from('private_conversations')
    .select('id, created_at, created_by, last_message_at')
    .eq('id', exactConversationId)
    .maybeSingle()

  if (conversationError) {
    console.error('Failed to load existing private conversation:', {
      exactConversationId,
      error: conversationError,
    })
    return { ok: false, status: 500, error: 'Failed to load existing conversation' }
  }

  return {
    ok: true,
    conversation: conversation ?? null,
  }
}

export async function getOrCreatePrivateConversation(
  request: Request,
  otherUserId: string
): Promise<
  Result<{
    user: { id: string }
    profile: { id: string; role: AppRole; email?: string | null }
    conversation: PrivateConversation
  }>
> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  if (!otherUserId) {
    return { ok: false, status: 400, error: 'Missing target user id' }
  }


  const admin = createSupabaseServiceClient()

  const { data: otherUser, error: otherUserError } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', otherUserId)
    .maybeSingle()

  if (otherUserError) {
    console.error('Failed to verify target private conversation user:', {
      currentUserId: ctx.user.id,
      otherUserId,
      error: otherUserError,
    })
    return { ok: false, status: 500, error: 'Failed to verify target user' }
  }

  if (!otherUser) {
    return { ok: false, status: 404, error: 'Target user not found' }
  }
  if (otherUser.is_active === false) {
    return { ok: false, status: 409, error: 'Nu poți începe o conversație cu un cont dezactivat' }
  }

  if (
    !canChatWithUser(
      { id: ctx.user.id, role: ctx.profile.role },
      { id: otherUser.id, role: otherUser.role }
    )
  ) {
    return { ok: false, status: 403, error: 'Not allowed to start this conversation' }
  }

  const existing = await findExistingPrivateConversationBetweenUsers(ctx.user.id, otherUserId)
  if (!existing.ok) return existing

  if (existing.conversation) {
    return {
      ok: true,
      user: { id: ctx.user.id },
      profile: ctx.profile,
      conversation: existing.conversation,
    }
  }

  const { data: createdConversation, error: createConversationError } = await admin
    .from('private_conversations')
    .insert({
      created_by: ctx.user.id,
      last_message_at: null,
    })
    .select('id, created_at, created_by, last_message_at')
    .single()

  if (createConversationError || !createdConversation) {
    const inactive = inactiveReferenceConflict(createConversationError, 'Nu poți începe o conversație folosind un cont dezactivat.')
    if (inactive) return { ok: false, status: inactive.status, error: inactive.body.message, code: inactive.body.code, details: inactive.body.details }
    console.error('Failed to create private conversation:', {
      currentUserId: ctx.user.id,
      otherUserId,
      error: createConversationError,
    })
    return { ok: false, status: 500, error: 'Failed to create conversation' }
  }

  const { error: participantsError } = await admin
    .from('private_conversation_participants')
    .insert([
      {
        conversation_id: createdConversation.id,
        user_id: ctx.user.id,
      },
      {
        conversation_id: createdConversation.id,
        user_id: otherUserId,
      },
    ])

  if (participantsError) {
    console.error('Failed to insert private conversation participants:', {
      conversationId: createdConversation.id,
      currentUserId: ctx.user.id,
      otherUserId,
      error: participantsError,
    })

    const { error: cleanupError } = await admin.from('private_conversations').delete().eq('id', createdConversation.id)
    if (cleanupError) {
      console.error('Failed to clean up private conversation after participant insert:', { conversationId: createdConversation.id, cleanupError })
      return { ok: false, status: 500, error: 'Failed to clean up conversation after participant insert' }
    }
    const inactive = inactiveReferenceConflict(participantsError, 'Nu poți începe o conversație cu un cont dezactivat.')
    if (inactive) return { ok: false, status: inactive.status, error: inactive.body.message, code: inactive.body.code, details: inactive.body.details }
    return { ok: false, status: 500, error: 'Failed to create conversation participants' }
  }

  return {
    ok: true,
    user: { id: ctx.user.id },
    profile: ctx.profile,
    conversation: createdConversation,
  }
}

export type PrivateConversationListItem = {
  id: string
  created_at: string
  created_by: string
  last_message_at: string | null
  last_read_at: string | null
  other_last_read_at: string | null
  has_unread: boolean
  other_user: {
    id: string
    full_name: string | null
    email: string | null
    is_active: boolean | null
  } | null
  last_message: {
    id: string
    body: string | null
    created_at: string
    created_by: string
  } | null
}

export async function listPrivateConversationsForCurrentUser(
  request: Request
): Promise<
  Result<{
    user: { id: string }
    profile: { id: string; role: AppRole; email?: string | null }
    items: PrivateConversationListItem[]
  }>
> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  const admin = createSupabaseServiceClient()
  const lastReadMap = new Map<string, string | null>()

  try {
    await forEachPostgrestPage<PrivateConversationReadRow>(
      (from, to) =>
        admin
          .from('private_conversation_participants')
          .select('conversation_id, last_read_at')
          .eq('user_id', ctx.user.id)
          .order('conversation_id')
          .range(from, to),
      (rows) => {
        for (const row of rows) lastReadMap.set(row.conversation_id, row.last_read_at)
      }
    )
  } catch (error) {
    console.error('Failed to load user private conversation participants:', {
      userId: ctx.user.id,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to load conversations' }
  }

  const conversationIds = [...lastReadMap.keys()]

  if (conversationIds.length === 0) {
    return {
      ok: true,
      user: { id: ctx.user.id },
      profile: ctx.profile,
      items: [],
    }
  }

  type ParticipantProfile = {
    id: string
    full_name: string | null
    email: string | null
    is_active: boolean | null
  }
  type ParticipantWithProfile = {
    conversation_id: string
    user_id: string
    last_read_at: string | null
    profiles: ParticipantProfile | ParticipantProfile[] | null
  }

  const conversationsById = new Map<string, PrivateConversation>()
  const participantsByConversation = new Map<string, ParticipantWithProfile[]>()
  const lastMessageByConversation = new Map<
    string,
    { id: string; body: string | null; created_at: string; created_by: string }
  >()
  const unreadConversationIds = new Set<string>()

  for (const conversationBatch of batches(conversationIds, CONVERSATION_IDS_PER_BATCH)) {
    try {
      await forEachPostgrestPage<PrivateConversation>(
        (from, to) =>
          admin
            .from('private_conversations')
            .select('id, created_at, created_by, last_message_at')
            .in('id', conversationBatch)
            .order('id')
            .range(from, to),
        (rows) => rows.forEach((row) => conversationsById.set(row.id, row))
      )
    } catch (error) {
      console.error('Failed to load private conversations:', {
        userId: ctx.user.id,
        conversationIds: conversationBatch,
        error,
      })
      return { ok: false, status: 500, error: 'Failed to load conversations' }
    }

    try {
      await forEachPostgrestPage<ParticipantWithProfile>(
        (from, to) =>
          admin
            .from('private_conversation_participants')
            .select(`
              conversation_id,
              user_id,
              last_read_at,
              profiles:user_id (
                id,
                full_name,
                email,
                is_active
              )
            `)
            .in('conversation_id', conversationBatch)
            .order('conversation_id')
            .order('user_id')
            .range(from, to),
        (rows) => {
          for (const row of rows) {
            const participants = participantsByConversation.get(row.conversation_id) ?? []
            participants.push(row)
            participantsByConversation.set(row.conversation_id, participants)
          }
        }
      )
    } catch (error) {
      console.error('Failed to load private conversation participants:', {
        userId: ctx.user.id,
        conversationIds: conversationBatch,
        error,
      })
      return { ok: false, status: 500, error: 'Failed to load conversation participants' }
    }

    try {
      await forEachPostgrestPage<{
        id: string
        conversation_id: string
        body: string | null
        created_at: string
        created_by: string
      }>(
        (from, to) =>
          admin
            .from('private_messages')
            .select('id, conversation_id, body, created_at, created_by')
            .in('conversation_id', conversationBatch)
            .is('deleted_at', null)
            .order('conversation_id')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to),
        (rows) => {
          for (const row of rows) {
            if (!lastMessageByConversation.has(row.conversation_id)) {
              lastMessageByConversation.set(row.conversation_id, {
                id: row.id,
                body: row.body,
                created_at: row.created_at,
                created_by: row.created_by,
              })
            }

            const lastReadAt = lastReadMap.get(row.conversation_id)
            if (
              row.created_by !== ctx.user.id &&
              (!lastReadAt || chatTimestampMicroseconds(row.created_at) > chatTimestampMicroseconds(lastReadAt))
            ) {
              unreadConversationIds.add(row.conversation_id)
            }
          }
        }
      )
    } catch (error) {
      console.error('Failed to load private conversation messages:', {
        userId: ctx.user.id,
        conversationIds: conversationBatch,
        error,
      })
      return { ok: false, status: 500, error: 'Failed to load conversation messages' }
    }
  }

  const items: PrivateConversationListItem[] = [...conversationsById.values()].map((conversation) => {
    const participants = participantsByConversation.get(conversation.id) ?? []
    const otherParticipant = participants.find((p) => p.user_id !== ctx.user.id)

    const otherProfile = Array.isArray(otherParticipant?.profiles)
      ? otherParticipant?.profiles[0] ?? null
      : otherParticipant?.profiles ?? null

    return {
      id: conversation.id,
      created_at: conversation.created_at,
      created_by: conversation.created_by,
      last_message_at: conversation.last_message_at,
      last_read_at: lastReadMap.get(conversation.id) ?? null,
      other_last_read_at: otherParticipant?.last_read_at ?? null,
      has_unread: unreadConversationIds.has(conversation.id),
      other_user: otherProfile,
      last_message: lastMessageByConversation.get(conversation.id) ?? null,
    }
  })

  items.sort((a, b) => {
    const aTime = a.last_message_at ? chatTimestampMicroseconds(a.last_message_at) : 0
    const bTime = b.last_message_at ? chatTimestampMicroseconds(b.last_message_at) : 0
    return bTime - aTime || b.id.localeCompare(a.id)
  })

  return {
    ok: true,
    user: { id: ctx.user.id },
    profile: ctx.profile,
    items,
  }
}

export async function getPrivateConversationUnreadSummary(
  request: Request
): Promise<
  Result<{
    user: { id: string }
    profile: { id: string; role: AppRole; email?: string | null }
    hasUnread: boolean
    unreadConversationCount: number
  }>
> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  const admin = createSupabaseServiceClient()
  const lastReadMap = new Map<string, string | null>()

  try {
    await forEachPostgrestPage<PrivateConversationReadRow>(
      (from, to) =>
        admin
          .from('private_conversation_participants')
          .select('conversation_id, last_read_at')
          .eq('user_id', ctx.user.id)
          .order('conversation_id')
          .range(from, to),
      (rows) => {
        for (const row of rows) lastReadMap.set(row.conversation_id, row.last_read_at)
      }
    )
  } catch (error) {
    console.error('Failed to load private conversation unread participants:', {
      userId: ctx.user.id,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to load unread conversations' }
  }

  const conversationIds = [...lastReadMap.keys()]

  if (conversationIds.length === 0) {
    return {
      ok: true,
      user: { id: ctx.user.id },
      profile: ctx.profile,
      hasUnread: false,
      unreadConversationCount: 0,
    }
  }

  const unreadConversationIds = new Set<string>()
  const idsWithReadState = conversationIds.filter((id) => !!lastReadMap.get(id))
  const idsWithoutReadState = conversationIds.filter((id) => !lastReadMap.get(id))

  try {
    for (const conversationBatch of batches(idsWithReadState, CONVERSATION_IDS_PER_BATCH)) {
      const earliestLastReadAt = conversationBatch
        .map((id) => lastReadMap.get(id)!)
        .reduce((earliest, value) =>
          chatTimestampMicroseconds(value) < chatTimestampMicroseconds(earliest) ? value : earliest
        )

      await forEachPostgrestPage<{
        conversation_id: string
        created_at: string
      }>(
        (from, to) =>
          admin
            .from('private_messages')
            .select('id, conversation_id, created_at')
            .in('conversation_id', conversationBatch)
            .neq('created_by', ctx.user.id)
            .is('deleted_at', null)
            .gt('created_at', earliestLastReadAt)
            .order('conversation_id')
            .order('created_at')
            .order('id')
            .range(from, to),
        (rows) => {
          for (const row of rows) {
            const lastReadAt = lastReadMap.get(row.conversation_id)
            if (lastReadAt && chatTimestampMicroseconds(row.created_at) > chatTimestampMicroseconds(lastReadAt)) {
              unreadConversationIds.add(row.conversation_id)
            }
          }
          return conversationBatch.some((id) => !unreadConversationIds.has(id))
        }
      )
    }

    for (const conversationBatch of batches(idsWithoutReadState, CONVERSATION_IDS_PER_BATCH)) {
      await forEachPostgrestPage<{ conversation_id: string }>(
        (from, to) =>
          admin
            .from('private_messages')
            .select('id, conversation_id')
            .in('conversation_id', conversationBatch)
            .neq('created_by', ctx.user.id)
            .is('deleted_at', null)
            .order('conversation_id')
            .order('created_at')
            .order('id')
            .range(from, to),
        (rows) => {
          for (const row of rows) unreadConversationIds.add(row.conversation_id)
          return conversationBatch.some((id) => !unreadConversationIds.has(id))
        }
      )
    }
  } catch (error) {
    console.error('Failed to load private conversation unread messages:', {
      userId: ctx.user.id,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to load unread conversations' }
  }

  const unreadConversationCount = unreadConversationIds.size

  return {
    ok: true,
    user: { id: ctx.user.id },
    profile: ctx.profile,
    hasUnread: unreadConversationCount > 0,
    unreadConversationCount,
  }
}
