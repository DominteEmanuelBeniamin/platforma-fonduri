import { z } from 'zod'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const UpdateMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
})

async function loadMessage(admin: ReturnType<typeof createSupabaseServiceClient>, messageId: string) {
  return admin
    .from('project_chat_messages')
    .select('id, project_id, created_by, body, created_at, edited_at, deleted_at')
    .eq('id', messageId)
    .maybeSingle()
}

function canMutateMessage(role: string, callerId: string, messageCreatedBy: string) {
  if (role === 'admin') return true
  return callerId === messageCreatedBy
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id: projectId, messageId } = await params

    const accessRes = await requireProjectAccess(request, projectId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const admin = createSupabaseServiceClient()

    const { data, error } = await admin
      .from('project_chat_messages')
      .select(
        `
        id,
        project_id,
        created_by,
        body,
        created_at,
        edited_at,
        deleted_at,
        profiles:created_by (
          id,
          full_name,
          email
        )
      `
      )
      .eq('project_id', projectId)
      .eq('id', messageId)
      .maybeSingle()

    if (error) {
      console.error('GET chat message by id failed:', { projectId, messageId, error })
      return Response.json({ error: 'Failed to load chat message' }, { status: 500 })
    }

    if (!data) {
      return Response.json({ error: 'Not Found' }, { status: 404 })
    }
    
    if (data.deleted_at) {
      return Response.json({
        item: {
          ...data,
          body: null,
          is_deleted: true,
        },
      })
    }
    
    return Response.json({ item: { ...data, is_deleted: false } })
    

    return Response.json({ item: data })
  } catch (err) {
    console.error('GET chat message by id unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id:projectId, messageId } = await params

    const accessRes = await requireProjectAccess(request, projectId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const bodyJson = await request.json().catch(() => null)
    const parsed = UpdateMessageSchema.safeParse(bodyJson)
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const admin = createSupabaseServiceClient()

    const { data: msg, error: msgErr } = await loadMessage(admin, messageId)
    if (msgErr) {
      console.error('PATCH load message failed:', { projectId, messageId, msgErr })
      return Response.json({ error: 'Failed to load message' }, { status: 500 })
    }
    if (!msg || msg.project_id !== projectId) {
      return Response.json({ error: 'Message not found' }, { status: 404 })
    }
    if (msg.deleted_at) {
      return Response.json({ error: 'Message is deleted' }, { status: 409 })
    }

    const allowed = canMutateMessage(accessRes.profile.role, accessRes.user.id, msg.created_by)
    if (!allowed) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await admin
      .from('project_chat_messages')
      .update({ body: parsed.data.body, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('project_id', projectId)
      .select(`
      id,
      project_id,
      created_by,
      body,
      created_at,
      edited_at,
      deleted_at,
      profiles:created_by (
        id,
        full_name,
        email
      )
    `)
      .single()

    if (error || !data) {
      console.error('PATCH message failed:', { projectId, messageId, error })
      return Response.json({ error: 'Failed to update message' }, { status: 500 })
    }

    return Response.json({ item: data })
  } catch (err) {
    console.error('PATCH message unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id:projectId, messageId } = await params

    const accessRes = await requireProjectAccess(request, projectId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const admin = createSupabaseServiceClient()

    const { data: msg, error: msgErr } = await loadMessage(admin, messageId)
    if (msgErr) {
      console.error('DELETE load message failed:', { projectId, messageId, msgErr })
      return Response.json({ error: 'Failed to load message' }, { status: 500 })
    }
    if (!msg || msg.project_id !== projectId) {
      return Response.json({ error: 'Message not found' }, { status: 404 })
    }

    const allowed = canMutateMessage(accessRes.profile.role, accessRes.user.id, msg.created_by)
    if (!allowed) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (msg.deleted_at) {
      // already deleted (idempotent)
      return Response.json({ ok: true })
    }

    const { error } = await admin
      .from('project_chat_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('project_id', projectId)

    if (error) {
      console.error('DELETE (soft) message failed:', { projectId, messageId, error })
      return Response.json({ error: 'Failed to delete message' }, { status: 500 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('DELETE message unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
