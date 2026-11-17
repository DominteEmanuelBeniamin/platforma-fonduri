import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { formatInternalEntries, internalEntryNotFound, loadInternalEntry, requireInternalProjectAccess, validateInternalEntryContext } from '@/app/api/_utils/internal-entries'
import { logAction } from '@/app/api/_utils/audit'
import { canEditInternalEntry, isInternalEntryUuid, parseInternalEntryInput, resolveInternalEntryContext } from '@/lib/internal-entry-security'

type Context = { params: Promise<{ id: string; entryId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id: projectId, entryId } = await params
    const access = await requireInternalProjectAccess(request, projectId, true)
    if (!access.ok) return access.response
    if (!isInternalEntryUuid(entryId)) return internalEntryNotFound()

    const parsed = parseInternalEntryInput(await request.json().catch(() => null), true)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'VALIDATION_ERROR' }, { status: 400 })
    if (Object.keys(parsed.value).length === 0) {
      return NextResponse.json({ error: 'At least one editable field is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()
    const loaded = await loadInternalEntry(admin, projectId, entryId)
    if (loaded.error) throw loaded.error
    if (!loaded.entry) return internalEntryNotFound()
    if (!canEditInternalEntry(access.profile, loaded.entry)) {
      return NextResponse.json({ error: 'You cannot edit this internal entry' }, { status: 403 })
    }

    const context = resolveInternalEntryContext(loaded.entry, parsed.value)
    if (!context) {
      return NextResponse.json({ error: 'Choose at most one context', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!await validateInternalEntryContext(admin, projectId, context)) {
      return NextResponse.json({ error: 'Context does not belong to this project', code: 'INVALID_CONTEXT' }, { status: 400 })
    }

    const { data: entry, error } = await admin.from('project_internal_entries')
      .update({ ...parsed.value, ...context })
      .eq('project_id', projectId)
      .eq('id', entryId)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!entry) return internalEntryNotFound()

    const changedFields = Object.keys(parsed.value)
    const auditFields = new Set(changedFields)
    if (changedFields.some(field => field === 'phase_id' || field === 'activity_id' || field === 'document_requirement_id')) {
      auditFields.add('phase_id')
      auditFields.add('activity_id')
      auditFields.add('document_requirement_id')
    }
    const oldAuditValues: Record<string, unknown> = {}
    const newAuditValues: Record<string, unknown> = {}
    for (const field of auditFields) {
      if (field === 'body') {
        oldAuditValues.body_changed = true
        newAuditValues.body_changed = true
      } else {
        oldAuditValues[field] = loaded.entry[field as keyof typeof loaded.entry]
        newAuditValues[field] = entry[field as keyof typeof entry]
      }
    }
    await logAction({
      actorId: access.user.id,
      actionType: 'update',
      entityType: 'project_internal_entry',
      entityId: entry.id,
      entityName: entry.title,
      oldValues: oldAuditValues,
      newValues: newAuditValues,
      description: 'A modificat o înregistrare din dosarul intern al proiectului.',
      request,
    })

    return NextResponse.json({ entry: (await formatInternalEntries(admin, projectId, [entry]))[0] })
  } catch (error) {
    console.error('PATCH internal entry failed:', error)
    return NextResponse.json({ error: 'Failed to update internal entry' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { id: projectId, entryId } = await params
    const access = await requireInternalProjectAccess(request, projectId, true)
    if (!access.ok) return access.response
    if (!isInternalEntryUuid(entryId)) return internalEntryNotFound()

    const admin = createSupabaseServiceClient()
    const loaded = await loadInternalEntry(admin, projectId, entryId)
    if (loaded.error) throw loaded.error
    if (!loaded.entry) return internalEntryNotFound()
    if (!canEditInternalEntry(access.profile, loaded.entry)) {
      return NextResponse.json({ error: 'You cannot delete this internal entry' }, { status: 403 })
    }

    const deletedAt = new Date().toISOString()
    const { error } = await admin.from('project_internal_entries')
      .update({ deleted_at: deletedAt, deleted_by: access.user.id })
      .eq('project_id', projectId)
      .eq('id', entryId)
      .is('deleted_at', null)
    if (error) throw error

    await logAction({
      actorId: access.user.id,
      actionType: 'delete',
      entityType: 'project_internal_entry',
      entityId: loaded.entry.id,
      entityName: loaded.entry.title,
      oldValues: { deleted_at: null },
      newValues: { deleted_at: deletedAt },
      description: 'A retras o înregistrare din dosarul intern al proiectului.',
      request,
    })

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('DELETE internal entry failed:', error)
    return NextResponse.json({ error: 'Failed to delete internal entry' }, { status: 500 })
  }
}
