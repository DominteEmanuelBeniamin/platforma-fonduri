import { z } from 'zod'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import {
  getProjectChatReadStates,
  projectChatTimestampMicroseconds,
} from '@/app/api/_utils/project-chat'

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>

/** Ora celui mai nou mesaj din proiect, în ceasul bazei de date (0 dacă nu există sau nu răspunde). */
async function newestMessageMicroseconds(admin: ServiceClient, projectId: string) {
  const { data, error } = await admin
    .from('project_chat_messages')
    .select('created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data?.created_at) return 0
  return projectChatTimestampMicroseconds(data.created_at)
}

const MarkReadSchema = z
  .object({
    readThroughAt: z.iso.datetime({ offset: true }).optional(),
  })
  .optional()

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const accessRes = await requireProjectAccess(request, projectId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const { readStates } = await getProjectChatReadStates(projectId)
    const myReadState = readStates.find((row) => row.user_id === accessRes.user.id)

    return Response.json({
      ok: true,
      lastReadAt: myReadState?.last_read_at ?? null,
      readStates,
    })
  } catch (err) {
    console.error('GET project chat read state unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const accessRes = await requireProjectAccess(request, projectId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const bodyJson = await request.json().catch(() => undefined)
    const parsed = MarkReadSchema.safeParse(bodyJson)

    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const admin = createSupabaseServiceClient()
    const requestTimeMs = Date.now()
    const requestTimeIso = new Date(requestTimeMs).toISOString()
    const readThroughAt = parsed.data?.readThroughAt
    // Un marcaj din viitor e plafonat. Ora unui mesaj existent e mereu acceptată, chiar dacă
    // ceasul bazei de date e înaintea celui al serverului de aplicație.
    const ceiling = readThroughAt
      ? Math.max(requestTimeMs * 1000, await newestMessageMicroseconds(admin, projectId))
      : 0
    const lastReadAt =
      readThroughAt && projectChatTimestampMicroseconds(readThroughAt) <= ceiling
      ? readThroughAt
      : requestTimeIso

    // Insert only when absent, then conditionally advance so concurrent stale requests cannot regress it.
    const { error: insertError } = await admin
      .from('project_chat_reads')
      .upsert(
        {
          project_id: projectId,
          user_id: accessRes.user.id,
          last_read_at: lastReadAt,
        },
        { onConflict: 'project_id,user_id', ignoreDuplicates: true }
      )

    if (insertError) {
      console.error('POST project chat read failed:', {
        projectId,
        userId: accessRes.user.id,
        error: insertError,
      })
      return Response.json({ error: 'Failed to mark project chat as read' }, { status: 500 })
    }

    const { error: updateError } = await admin
      .from('project_chat_reads')
      .update({ last_read_at: lastReadAt })
      .eq('project_id', projectId)
      .eq('user_id', accessRes.user.id)
      .or(`last_read_at.is.null,last_read_at.lt.${lastReadAt}`)

    if (updateError) {
      console.error('POST project chat read failed:', {
        projectId,
        userId: accessRes.user.id,
        error: updateError,
      })
      return Response.json({ error: 'Failed to mark project chat as read' }, { status: 500 })
    }

    const { readStates } = await getProjectChatReadStates(projectId)
    const persistedLastReadAt =
      readStates.find((row) => row.user_id === accessRes.user.id)?.last_read_at ?? lastReadAt

    return Response.json({
      ok: true,
      lastReadAt: persistedLastReadAt,
      readStates,
    })
  } catch (err) {
    console.error('POST project chat read unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
