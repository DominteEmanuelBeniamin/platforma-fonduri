import { z } from 'zod'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { getProjectChatReadStates } from '@/app/api/_utils/project-chat'

const MarkReadSchema = z
  .object({
    readThroughAt: z.iso.datetime({ offset: true }).optional(),
  })
  .optional()

const latestIso = (...values: Array<string | null | undefined>) => {
  const present = values.filter((value): value is string => !!value)
  if (present.length === 0) return new Date().toISOString()

  return present.reduce((latest, value) =>
    new Date(value).getTime() > new Date(latest).getTime() ? value : latest
  )
}

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
      participantCount: readStates.length,
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

    const { data: currentRow, error: currentError } = await admin
      .from('project_chat_reads')
      .select('last_read_at')
      .eq('project_id', projectId)
      .eq('user_id', accessRes.user.id)
      .maybeSingle()

    if (currentError) {
      console.error('POST project chat read current row failed:', {
        projectId,
        userId: accessRes.user.id,
        error: currentError,
      })
      return Response.json({ error: 'Failed to mark project chat as read' }, { status: 500 })
    }

    const lastReadAt = latestIso(
      new Date().toISOString(),
      parsed.data?.readThroughAt,
      currentRow?.last_read_at ?? null
    )

    const { error } = await admin
      .from('project_chat_reads')
      .upsert(
        {
          project_id: projectId,
          user_id: accessRes.user.id,
          last_read_at: lastReadAt,
        },
        { onConflict: 'project_id,user_id' }
      )

    if (error) {
      console.error('POST project chat read failed:', {
        projectId,
        userId: accessRes.user.id,
        error,
      })
      return Response.json({ error: 'Failed to mark project chat as read' }, { status: 500 })
    }

    const { readStates } = await getProjectChatReadStates(projectId)

    return Response.json({
      ok: true,
      lastReadAt,
      readStates,
      participantCount: readStates.length,
    })
  } catch (err) {
    console.error('POST project chat read unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
