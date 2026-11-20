import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { formatInternalEntries, requireInternalProjectAccess, validateInternalEntryContext } from '@/app/api/_utils/internal-entries'
import { logAction } from '@/app/api/_utils/audit'
import { parseInternalEntryInput } from '@/lib/internal-entry-security'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params
    const access = await requireInternalProjectAccess(request, projectId)
    if (!access.ok) return access.response

    const admin = createSupabaseServiceClient()
    const entries = []
    const pageSize = 200
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await admin.from('project_internal_entries')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + pageSize - 1)
      if (error) throw error
      entries.push(...await formatInternalEntries(admin, projectId, data ?? []))
      if (!data || data.length < pageSize) break
    }

    return NextResponse.json({ entries }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('GET internal entries failed:', error)
    return NextResponse.json({ error: 'Failed to load internal dossier' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params
    const access = await requireInternalProjectAccess(request, projectId, true)
    if (!access.ok) return access.response

    const parsed = parseInternalEntryInput(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'VALIDATION_ERROR' }, { status: 400 })

    const context = {
      phase_id: parsed.value.phase_id ?? null,
      activity_id: parsed.value.activity_id ?? null,
      document_requirement_id: parsed.value.document_requirement_id ?? null,
    }
    const admin = createSupabaseServiceClient()
    if (!await validateInternalEntryContext(admin, projectId, context)) {
      return NextResponse.json({ error: 'Context does not belong to this project', code: 'INVALID_CONTEXT' }, { status: 400 })
    }

    const { data: entry, error } = await admin.from('project_internal_entries').insert({
      project_id: projectId,
      title: parsed.value.title!,
      body: parsed.value.body ?? '',
      ...context,
      created_by: access.user.id,
    }).select('*').single()
    if (error || !entry) throw error ?? new Error('Entry insert returned no row')

    await logAction({
      actorId: access.user.id,
      actionType: 'create',
      entityType: 'project_internal_entry',
      entityId: entry.id,
      entityName: entry.title,
      newValues: { project_id: projectId, title: entry.title, ...context },
      description: 'A creat o înregistrare în dosarul intern al proiectului.',
      request,
    })

    return NextResponse.json({ entry: (await formatInternalEntries(admin, projectId, [entry]))[0] }, { status: 201 })
  } catch (error) {
    console.error('POST internal entry failed:', error)
    return NextResponse.json({ error: 'Failed to create internal entry' }, { status: 500 })
  }
}
