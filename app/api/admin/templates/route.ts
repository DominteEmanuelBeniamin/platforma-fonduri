/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireAdmin } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'project-files'

async function storagePathExists(path: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60)

  if (error || !data?.signedUrl) return false

  try {
    const res = await fetch(data.signedUrl, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function verifyTemplateDocumentAttachment(doc: any) {
  if (Array.isArray(doc.attachments) && doc.attachments.length > 0) {
    const checkedAt = new Date().toISOString()
    const attachments = await Promise.all(doc.attachments.map(async (attachment: any) => {
      const available = await storagePathExists(attachment.storage_path)
      const missingAt = available ? null : attachment.missing_at || checkedAt
      await supabaseAdmin
        .from('document_requirement_attachments')
        .update({
          missing_at: missingAt,
          missing_checked_at: checkedAt,
        })
        .eq('storage_path', attachment.storage_path)
      return {
        ...attachment,
        missing_at: missingAt,
        missing_checked_at: checkedAt,
      }
    }))
    return { ...doc, attachments }
  }

  if (!doc.attachment_path) return doc

  const attachmentAvailable = await storagePathExists(doc.attachment_path)
  const checkedAt = new Date().toISOString()

  if (!attachmentAvailable) {
    const missingAt = doc.attachment_missing_at || checkedAt

    await Promise.all([
      supabaseAdmin
        .from('template_document_requirements')
        .update({
          attachment_missing_at: missingAt,
          attachment_missing_checked_at: checkedAt,
        })
        .eq('attachment_path', doc.attachment_path),
      supabaseAdmin
        .from('document_requirements')
        .update({
          attachment_missing_at: missingAt,
          attachment_missing_checked_at: checkedAt,
        })
        .eq('attachment_path', doc.attachment_path)
        .is('deleted_at', null),
    ])

    return {
      ...doc,
      attachment_missing_at: missingAt,
      attachment_missing_checked_at: checkedAt,
    }
  }

  if (doc.attachment_missing_at) {
    await Promise.all([
      supabaseAdmin
        .from('template_document_requirements')
        .update({
          attachment_missing_at: null,
          attachment_missing_checked_at: checkedAt,
        })
        .eq('attachment_path', doc.attachment_path),
      supabaseAdmin
        .from('document_requirements')
        .update({
          attachment_missing_at: null,
          attachment_missing_checked_at: checkedAt,
        })
        .eq('attachment_path', doc.attachment_path)
        .is('deleted_at', null),
    ])

    return {
      ...doc,
      attachment_missing_at: null,
      attachment_missing_checked_at: checkedAt,
    }
  }

  return doc
}

// GET /api/admin/templates
export async function GET(req: NextRequest) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: templates, error: templatesError } = await supabaseAdmin
      .from('project_templates')
      .select(`
        *,
        measure:program_measures(name, program:programs(name))
      `)
      .order('created_at', { ascending: false })

    if (templatesError) throw templatesError

    const templatesWithDetails = await Promise.all(
      (templates || []).map(async (template) => {
        const { data: phases } = await supabaseAdmin
          .from('template_phases')
          .select(`
            *,
            project_status:project_statuses(id, name, slug, color, icon)
          `)
          .eq('template_id', template.id)
          .eq('is_active', true)
          .order('order_index', { ascending: true })

        const phasesWithActivities = await Promise.all(
          (phases || []).map(async (phase) => {
            const { data: activities } = await supabaseAdmin
              .from('template_activities')
              .select('*, default_consultant:default_consultant_id(id, full_name, email)')
              .eq('template_phase_id', phase.id)
              .eq('is_active', true)
              .order('order_index', { ascending: true })

            const activitiesWithDocs = await Promise.all(
              (activities || []).map(async (activity) => {
                const { data: docs } = await supabaseAdmin
                  .from('template_document_requirements')
                  .select('*, attachments:document_requirement_attachments(id, storage_path, original_name, mime_type, file_size, order_index, missing_at, missing_checked_at, created_at)')
                  .eq('template_activity_id', activity.id)
                  .eq('is_active', true)
                  .order('order_index', { ascending: true })

                const verifiedDocs = await Promise.all(
                  (docs || []).map(verifyTemplateDocumentAttachment)
                )

                return { ...activity, document_requirements: verifiedDocs }
              })
            )

            return { ...phase, activities: activitiesWithDocs }
          })
        )

        return { ...template, phases: phasesWithActivities }
      })
    )

    return NextResponse.json({ templates: templatesWithDetails })
  } catch (error: any) {
    console.error('GET /api/admin/templates error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/admin/templates
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json()
    const { name, slug, description, measure_id, is_default } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Numele și slug-ul sunt obligatorii' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('project_templates')
      .select('id')
      .eq('slug', slug)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Un template cu acest slug există deja' }, { status: 400 })
    }

    const { data: template, error } = await supabaseAdmin
      .from('project_templates')
      .insert({
        name,
        slug,
        description: description || null,
        measure_id: measure_id || null,
        is_default: is_default || false,
        is_active: true,
        created_by: auth.profile.id
      })
      .select()
      .single()

    if (error) throw error

    await logAction({
      actorId: auth.profile.id,
      actionType: 'create',
      entityType: 'template',
      entityId: template.id,
      entityName: template.name,
      newValues: {
        name: template.name,
        slug: template.slug,
        description: template.description,
        measure_id: template.measure_id,
        is_default: template.is_default,
      },
      description: `Creare sablon ${template.name}`,
      request: req,
    })

    return NextResponse.json({ template }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
