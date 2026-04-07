import { createSupabaseServiceClient } from './supabase'
import type { AppRole, Result } from './auth'
import { requireProfile } from './auth'

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

  if (ctx.user.id === otherUserId) {
    return { ok: false, status: 400, error: 'You cannot start a private conversation with yourself' }
  }

  const admin = createSupabaseServiceClient()

  const { data: otherUser, error: otherUserError } = await admin
    .from('profiles')
    .select('id')
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

    await admin.from('private_conversations').delete().eq('id', createdConversation.id)

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
  other_user: {
    id: string
    full_name: string | null
    email: string | null
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

  const { data: myParticipants, error: myParticipantsError } = await admin
    .from('private_conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', ctx.user.id)

  if (myParticipantsError) {
    console.error('Failed to load user private conversation participants:', {
      userId: ctx.user.id,
      error: myParticipantsError,
    })
    return { ok: false, status: 500, error: 'Failed to load conversations' }
  }

  const conversationIds = (myParticipants ?? []).map((row) => row.conversation_id)

  if (conversationIds.length === 0) {
    return {
      ok: true,
      user: { id: ctx.user.id },
      profile: ctx.profile,
      items: [],
    }
  }

  const lastReadMap = new Map<string, string | null>()
  for (const row of myParticipants ?? []) {
    lastReadMap.set(row.conversation_id, row.last_read_at)
  }

  const { data: conversations, error: conversationsError } = await admin
    .from('private_conversations')
    .select('id, created_at, created_by, last_message_at')
    .in('id', conversationIds)

  if (conversationsError) {
    console.error('Failed to load private conversations:', {
      userId: ctx.user.id,
      conversationIds,
      error: conversationsError,
    })
    return { ok: false, status: 500, error: 'Failed to load conversations' }
  }

  const { data: allParticipants, error: allParticipantsError } = await admin
    .from('private_conversation_participants')
    .select(`
      conversation_id,
      user_id,
      profiles:user_id (
        id,
        full_name,
        email
      )
    `)
    .in('conversation_id', conversationIds)

  if (allParticipantsError) {
    console.error('Failed to load private conversation participants:', {
      userId: ctx.user.id,
      conversationIds,
      error: allParticipantsError,
    })
    return { ok: false, status: 500, error: 'Failed to load conversation participants' }
  }

  const { data: messages, error: messagesError } = await admin
    .from('private_messages')
    .select('id, conversation_id, body, created_at, created_by, deleted_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false })

  if (messagesError) {
    console.error('Failed to load private conversation messages:', {
      userId: ctx.user.id,
      conversationIds,
      error: messagesError,
    })
    return { ok: false, status: 500, error: 'Failed to load conversation messages' }
  }

  type ParticipantProfile =
  | {
      id: string
      full_name: string | null
      email: string | null
    }
  | {
      id: string
      full_name: string | null
      email: string | null
    }[]
  | null

const participantsByConversation = new Map<
  string,
  Array<{
    conversation_id: string
    user_id: string
    profiles: ParticipantProfile
  }>
>()

  for (const row of allParticipants ?? []) {
    if (!participantsByConversation.has(row.conversation_id)) {
      participantsByConversation.set(row.conversation_id, [])
    }
    participantsByConversation.get(row.conversation_id)!.push(row)
  }

  const lastMessageByConversation = new Map<
    string,
    {
      id: string
      body: string | null
      created_at: string
      created_by: string
    } | null
  >()

  for (const row of messages ?? []) {
    if (lastMessageByConversation.has(row.conversation_id)) continue

    lastMessageByConversation.set(row.conversation_id, {
      id: row.id,
      body: row.deleted_at ? null : row.body,
      created_at: row.created_at,
      created_by: row.created_by,
    })
  }

  const items: PrivateConversationListItem[] = (conversations ?? []).map((conversation) => {
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
      other_user: otherProfile,
      last_message: lastMessageByConversation.get(conversation.id) ?? null,
    }
  })

  items.sort((a, b) => {
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    return bTime - aTime
  })

  return {
    ok: true,
    user: { id: ctx.user.id },
    profile: ctx.profile,
    items,
  }
}