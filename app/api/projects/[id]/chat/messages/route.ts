import { z } from 'zod'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const GetQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.iso.datetime({ offset: true }).optional(),
})

type ParsedQueryOk = {
  ok: true
  data: {
    limit: number
    cursor: string | undefined
    cursorIso: string | null
  }
}

type ParsedQueryErr = {
  ok: false
  error: z.ZodError
}

export function parseQuery(request: Request): ParsedQueryOk | ParsedQueryErr {
  const url = new URL(request.url)

  const raw = {
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  }

  const parsed = GetQuerySchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error }

  const { limit, cursor } = parsed.data

  // Normalizare pentru Postgres: întotdeauna ISO cu "Z"
  const cursorIso = cursor ? new Date(cursor).toISOString() : null

  return {
    ok: true,
    data: { limit, cursor, cursorIso },
  }
}

const CreateMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
})

const maskRow = (m: any) => {
  if (!m?.deleted_at) return { ...m, is_deleted: false }
  return {
    ...m,
    body: null,         // ✅ mascat
    is_deleted: true,   // ✅ flag util
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id:projectId } = await params

    const accessRes = await requireProjectAccess(request, projectId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const parsed = parseQuery(request)
    if (!parsed.ok) {
      return Response.json(
        { error: 'Invalid query params', details: z.treeifyError(parsed.error) }, 
        { status: 400 }
      )
    }

    const { limit, cursorIso } = parsed.data

    const admin = createSupabaseServiceClient()

    const requested = limit
    const pageSize = requested + 1

    let q = admin
      .from('project_chat_messages')
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
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(pageSize)
    
    if (cursorIso) {
      q = q.lt('created_at', cursorIso)
    }
    
    const { data, error } = await q
    if (error) {
      console.error('GET chat messages failed:', { projectId, error })
      return Response.json({ error: 'Failed to load chat messages' }, { status: 500 })
    }
    
    const rows = (data ?? []).map(maskRow)
    const hasMore = rows.length > requested
    const items = hasMore ? rows.slice(0, requested) : rows
    
    // nextCursor doar dacă mai există pagină
    const nextCursor = hasMore ? (items[items.length - 1]?.created_at ?? null) : null
    
    return Response.json({ items, nextCursor }) 
  } catch (err) {
    console.error('GET chat messages unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id:projectId } = await params

    const accessRes = await requireProjectAccess(request, projectId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const bodyJson = await request.json().catch(() => null)
    const parsed = CreateMessageSchema.safeParse(bodyJson)
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const admin = createSupabaseServiceClient()

    const insertPayload = {
      project_id: projectId,
      created_by: accessRes.user.id,
      body: parsed.data.body,
    }

    const { data, error } = await admin
      .from('project_chat_messages')
      .insert(insertPayload)
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
      console.error('POST chat message failed:', { projectId, error })
      return Response.json({ error: 'Failed to create chat message' }, { status: 500 })
    }

    return Response.json({ item: data }, { status: 201 })
  } catch (err) {
    console.error('POST chat message unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
