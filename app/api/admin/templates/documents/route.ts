/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireTemplateAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { normalizeRequirementType, requirementTypeToMandatory } from '@/lib/requirement-type'
import {
  compensateTemplateDocument,
  copyTemplateAttachments,
  findReferencedPaths,
} from '@/app/api/_utils/attachment-storage'
import { parseTemplateDuplication } from '@/app/api/_utils/template-duplication'
import type { TemplateDuplication } from '@/app/api/_utils/template-duplication'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SAVE_ERROR_MESSAGE = 'Nu am putut salva cerința de document. Reîncearcă.'

// POST /api/admin/templates/documents - Creează document requirement în activitate
export async function POST(req: NextRequest) {
  const createdPaths: string[] = []
  let createdDocumentId: string | null = null
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: 'Doar adminii pot crea cerințe de documente' }, { status: 403 })
    }

    const body = await req.json()
    const {
      template_activity_id,
      name,
      description,
      is_mandatory,
      order_index,
      attachment_path,
      attachment_original_name,
      attachments,
    } = body
    const is_outgoing = body?.is_outgoing === true
    const attachmentItems = Array.isArray(attachments)
      ? attachments.filter((item: any) => item && typeof item.storage_path === 'string' && item.storage_path.trim())
      : null
    let resolvedItems = attachmentItems
    let resolvedLegacyPath = typeof attachment_path === 'string' && attachment_path.trim() ? attachment_path.trim() : null
    let legacyOriginalName = typeof attachment_original_name === 'string' ? attachment_original_name : null
    let legacyMissingAt: string | null = null
    let legacyMissingCheckedAt: string | null = null
    const requirement_type = is_outgoing ? 'optional' : normalizeRequirementType(body?.requirement_type, is_mandatory)

    if (!template_activity_id || !name) {
      return NextResponse.json({ error: 'Activitatea și numele sunt obligatorii' }, { status: 400 })
    }

    const { data: activityRow, error: activityError } = await supabaseAdmin
      .from('template_activities')
      .select('template_phases(template_id)')
      .eq('id', template_activity_id)
      .maybeSingle()
    if (activityError) throw activityError
    const templateId = (activityRow as any)?.template_phases?.template_id
    if (!templateId) return NextResponse.json({ error: 'Activitatea nu a fost găsită' }, { status: 404 })

    const templateAccess = await requireTemplateAccess(req, templateId, 'edit')
    if (!templateAccess.ok) {
      return NextResponse.json({ error: templateAccess.error }, { status: templateAccess.status })
    }

    let duplication: TemplateDuplication | undefined
    if (body.duplication !== undefined) {
      const parsed = parseTemplateDuplication(body.duplication, 'template_document')
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      duplication = parsed.value
      if (duplication.source_kind === 'persistent') {
        const { data: source, error: sourceError } = await supabaseAdmin
          .from('template_document_requirements')
          .select('id, name, template_activities(template_phases(template_id))')
          .eq('id', duplication.source_id)
          .maybeSingle()
        if (sourceError) throw sourceError
        const sourceTemplateId = (source as any)?.template_activities?.template_phases?.template_id
        if (!source || sourceTemplateId !== templateId) {
          return NextResponse.json({ error: 'Sursa duplicării nu aparține acestui template.' }, { status: 400 })
        }
        duplication = { ...duplication, source_name: source.name }
      }
    }

    // Fișierele abia încărcate nu au `id` de rând existent. Atașamentele
    // clonate au `id` și trebuie verificate ca să nu partajeze obiectul sursei.
    const freshPaths = new Set((resolvedItems ?? [])
      .filter((item: any) => !item.id)
      .map((item: any) => item.storage_path.trim()))
    const listIsNonEmpty = Boolean(resolvedItems && resolvedItems.length > 0)
    const sourcePaths = listIsNonEmpty
      ? (resolvedItems ?? []).map((item: any) => item.storage_path.trim())
      : (resolvedLegacyPath ? [resolvedLegacyPath] : [])
    const incomingPaths = sourcePaths.filter((path: string) => !freshPaths.has(path))
    const referencedPaths = incomingPaths.length > 0
      ? await findReferencedPaths(supabaseAdmin, [...new Set(incomingPaths)])
      : new Set<string>()
    const copied = await copyTemplateAttachments(
      supabaseAdmin,
      resolvedItems ?? [],
      listIsNonEmpty ? null : resolvedLegacyPath,
      legacyOriginalName,
      referencedPaths,
      createdPaths,
    )
    resolvedItems = resolvedItems ? copied.attachments : null
    resolvedLegacyPath = copied.legacyPath
    legacyOriginalName = copied.legacyOriginalName
    legacyMissingAt = copied.legacyMissingAt
    legacyMissingCheckedAt = copied.legacyMissingCheckedAt
    const firstAttachment = resolvedItems?.[0] ?? null
    const attachmentPath = firstAttachment?.storage_path || resolvedLegacyPath || null

    if (is_outgoing && !attachmentPath) {
      return NextResponse.json({ error: 'Trebuie atașat un fișier pentru documentul trimis clientului.' }, { status: 400 })
    }

    // Calculează order_index dacă nu e furnizat
    let finalOrderIndex = order_index
    if (finalOrderIndex === undefined) {
      const { data: maxOrder } = await supabaseAdmin
        .from('template_document_requirements')
        .select('order_index')
        .eq('template_activity_id', template_activity_id)
        .order('order_index', { ascending: false })
        .limit(1)
        .single()
      
      finalOrderIndex = (maxOrder?.order_index || 0) + 1
    }

    const { data: doc, error } = await supabaseAdmin
      .from('template_document_requirements')
      .insert({
        template_activity_id,
        name,
        description: description || null,
        requirement_type,
        is_mandatory: requirementTypeToMandatory(requirement_type),
        order_index: finalOrderIndex,
        attachment_path: attachmentPath,
        attachment_original_name: attachmentPath
          ? (firstAttachment ? firstAttachment.original_name : legacyOriginalName) ?? null
          : null,
        attachment_missing_at: attachmentPath ? firstAttachment?.missing_at || legacyMissingAt : null,
        attachment_missing_checked_at: attachmentPath ? firstAttachment?.missing_checked_at || legacyMissingCheckedAt : null,
        is_outgoing,
        is_active: true,
      })
      .select()
      .single()

    if (error) throw error
    if (!doc) throw new Error('Documentul nu a fost creat.')
    createdDocumentId = doc.id

    if (doc && resolvedItems && resolvedItems.length > 0) {
      const { error: attachmentsError } = await supabaseAdmin
        .from('document_requirement_attachments')
        .insert(resolvedItems.map((attachment: any, index: number) => ({
          template_document_requirement_id: doc.id,
          storage_path: attachment.storage_path.trim(),
          original_name: typeof attachment.original_name === 'string' ? attachment.original_name : null,
          mime_type: typeof attachment.mime_type === 'string' ? attachment.mime_type : null,
          file_size: typeof attachment.file_size === 'number' ? attachment.file_size : null,
          order_index: index,
          missing_at: attachment.missing_at || null,
          missing_checked_at: attachment.missing_checked_at || null,
          created_by: auth.profile.id,
        })))
      if (attachmentsError) throw attachmentsError
    }

    const { data: actRow } = await supabaseAdmin
      .from('template_activities')
      .select('name, template_phases(name, project_templates(name))')
      .eq('id', template_activity_id)
      .maybeSingle()
    const activityName = actRow?.name ?? template_activity_id
    const phaseName = (actRow as any)?.template_phases?.name ?? ''
    const templateName = (actRow as any)?.template_phases?.project_templates?.name ?? ''

    await logAction({
      actorId: auth.profile.id,
      actionType: duplication ? 'create' : 'add',
      entityType: 'template_document',
      entityId: doc.id,
      entityName: doc.name,
      newValues: {
        ...doc,
        template_name: templateName,
        phase_name: phaseName,
        activity_name: activityName,
        ...(duplication ? { duplication } : {}),
      },
      description: duplication
        ? `Duplicare cerinta document "${doc.name}" in activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}")`
        : `Adaugare cerinta document "${doc.name}" in activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}")`,
      request: req,
    })

    return NextResponse.json({ document: doc }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates/documents error:', error)
    await compensateTemplateDocument(supabaseAdmin, createdDocumentId, createdPaths)
    return NextResponse.json({ error: SAVE_ERROR_MESSAGE, message: SAVE_ERROR_MESSAGE }, { status: 500 })
  }
}
