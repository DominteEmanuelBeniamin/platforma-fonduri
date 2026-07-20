/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ templateId: string }>
}

function normalizeLabel(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function normalizeSlug(value: string | null | undefined) {
  return normalizeLabel(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function addBlockedReason(blocked: string[], reason: string) {
  if (!blocked.includes(reason)) blocked.push(reason)
}

async function loadTemplate(templateId: string) {
  const { data: template, error } = await supabaseAdmin
    .from('project_templates')
    .select('id, name, status')
    .eq('id', templateId)
    .maybeSingle()

  if (error) throw error
  if (!template) return null

  const { data: phases, error: phasesError } = await supabaseAdmin
    .from('template_phases')
    .select('*')
    .eq('template_id', templateId)
    .eq('is_active', true)
    .order('order_index')

  if (phasesError) throw phasesError

  const phasesWithChildren = await Promise.all((phases ?? []).map(async (phase: any) => {
    const { data: activities, error: activitiesError } = await supabaseAdmin
      .from('template_activities')
      .select('*')
      .eq('template_phase_id', phase.id)
      .eq('is_active', true)
      .order('order_index')

    if (activitiesError) throw activitiesError

    const activitiesWithDocs = await Promise.all((activities ?? []).map(async (activity: any) => {
      const { data: docs, error: docsError } = await supabaseAdmin
        .from('template_document_requirements')
        .select('*, attachments:document_requirement_attachments(id, storage_path, original_name, order_index)')
        .eq('template_activity_id', activity.id)
        .eq('is_active', true)
        .order('order_index')

      if (docsError) throw docsError
      return { ...activity, document_requirements: docs ?? [] }
    }))

    return { ...phase, activities: activitiesWithDocs }
  }))

  return { ...template, phases: phasesWithChildren }
}

async function buildProjectPreview(project: any, template: any) {
  const { data: phases, error: phasesError } = await supabaseAdmin
    .from('project_phases')
    .select('id, source_template_phase_id, name, slug, project_status_id')
    .eq('project_id', project.id)

  if (phasesError) throw phasesError

  const phaseRows = phases ?? []
  const phaseBySource = new Map(
    phaseRows
      .filter((phase: any) => phase.source_template_phase_id)
      .map((phase: any) => [phase.source_template_phase_id, phase])
  )
  const phaseByName = new Map(phaseRows.map((phase: any) => [normalizeLabel(phase.name), phase]))
  const phaseBySlug = new Map(phaseRows.map((phase: any) => [normalizeSlug(phase.slug || phase.name), phase]))

  const phaseIds = phaseRows.map((phase: any) => phase.id)
  const { data: activities, error: activitiesError } = phaseIds.length
      ? await supabaseAdmin
        .from('project_activities')
        .select('id, phase_id, source_template_activity_id, name')
        .in('phase_id', phaseIds)
    : { data: [], error: null }

  if (activitiesError) throw activitiesError

  const activityRows = activities ?? []
  const activityBySource = new Map(
    activityRows
      .filter((activity: any) => activity.source_template_activity_id)
      .map((activity: any) => [activity.source_template_activity_id, activity])
  )
  const activitiesByPhase = new Map<string, any[]>()
  for (const activity of activityRows) {
    const phaseActivities = activitiesByPhase.get(activity.phase_id) ?? []
    phaseActivities.push(activity)
    activitiesByPhase.set(activity.phase_id, phaseActivities)
  }

  const { data: docs, error: docsError } = await supabaseAdmin
    .from('document_requirements')
    .select('id, activity_id, name, source_template_document_requirement_id, attachment_path, attachment_original_name, is_outgoing, attachments:document_requirement_attachments(id, storage_path, original_name, order_index)')
    .eq('project_id', project.id)
    .is('deleted_at', null)

  if (docsError) throw docsError

  const docRows = docs ?? []
  const docBySource = new Map(
    docRows
      .filter((doc: any) => doc.source_template_document_requirement_id)
      .map((doc: any) => [doc.source_template_document_requirement_id, doc])
  )
  const docsByActivity = new Map<string, any[]>()
  for (const doc of docRows) {
    if (!doc.activity_id) continue
    const activityDocs = docsByActivity.get(doc.activity_id) ?? []
    activityDocs.push(doc)
    docsByActivity.set(doc.activity_id, activityDocs)
  }

  const additions = {
    phases: [] as any[],
    activities: [] as any[],
    document_requests: [] as any[],
  }
  const updates = {
    phases: [] as any[],
    activities: [] as any[],
    document_requests: [] as any[],
  }
  const blocked: string[] = []

  for (const tPhase of template.phases ?? []) {
    const phase = phaseBySource.get(tPhase.id)
    if (!phase) {
      const phaseName = normalizeLabel(tPhase.name)
      const phaseSlug = normalizeSlug(tPhase.slug || tPhase.name)
      const conflictingPhase = phaseByName.get(phaseName) || phaseBySlug.get(phaseSlug)
      if (conflictingPhase && conflictingPhase.source_template_phase_id !== tPhase.id) {
        addBlockedReason(
          blocked,
          `Proiectul are deja faza "${conflictingPhase.name}" fără legătură cu faza "${tPhase.name}" din template.`
        )
      }
      additions.phases.push({ id: tPhase.id, name: tPhase.name })
    } else if (phase.name !== tPhase.name || phase.project_status_id !== tPhase.project_status_id) {
      updates.phases.push({ id: tPhase.id, name: tPhase.name })
    }

    for (const tActivity of tPhase.activities ?? []) {
      const activity = activityBySource.get(tActivity.id)
      if (!activity) {
        if (phase) {
          const conflictingActivity = (activitiesByPhase.get(phase.id) ?? []).find((projectActivity: any) =>
            normalizeLabel(projectActivity.name) === normalizeLabel(tActivity.name) &&
            projectActivity.source_template_activity_id !== tActivity.id
          )
          if (conflictingActivity) {
            addBlockedReason(
              blocked,
              `Faza "${phase.name}" are deja activitatea "${conflictingActivity.name}" fără legătură cu activitatea "${tActivity.name}" din template. Redenumește activitatea locală sau leag-o manual de template înainte de propagare.`
            )
          }
        }
        additions.activities.push({ id: tActivity.id, name: tActivity.name, parent_phase_id: tPhase.id })
      } else if (activity.name !== tActivity.name) {
        updates.activities.push({ id: tActivity.id, name: tActivity.name, parent_phase_id: tPhase.id })
      }

      for (const tDoc of tActivity.document_requirements ?? []) {
        const doc = docBySource.get(tDoc.id)
        if (!doc) {
          if (activity) {
            const conflictingDoc = (docsByActivity.get(activity.id) ?? []).find((projectDoc: any) =>
              normalizeLabel(projectDoc.name) === normalizeLabel(tDoc.name) &&
              projectDoc.source_template_document_requirement_id !== tDoc.id
            )
            if (conflictingDoc) {
              addBlockedReason(
                blocked,
                `Activitatea "${activity.name}" are deja cererea de document "${conflictingDoc.name}" fără legătură cu cererea "${tDoc.name}" din template. Redenumește cererea locală sau leag-o manual de template înainte de propagare.`
              )
            }
          }
          additions.document_requests.push({
            id: tDoc.id,
            name: tDoc.name,
            parent_activity_id: tActivity.id,
          })
        } else if (
          activity &&
          (doc.activity_id !== activity.id ||
          Boolean(doc.is_outgoing) !== Boolean(tDoc.is_outgoing) ||
          (
            doc.attachment_path !== tDoc.attachment_path ||
            doc.attachment_original_name !== (tDoc.attachment_original_name || null) ||
            JSON.stringify((doc.attachments ?? []).map((a: any) => [a.storage_path, a.original_name])) !==
              JSON.stringify((tDoc.attachments ?? []).map((a: any) => [a.storage_path, a.original_name]))
          )
          )
        ) {
          updates.document_requests.push({
            id: tDoc.id,
            name: tDoc.name,
            parent_activity_id: tActivity.id,
          })
        }
      }
    }
  }

  return {
    project_id: project.id,
    project_title: project.title,
    eligible: blocked.length === 0,
    blocked_reasons: blocked,
    additions,
    updates,
    totals: {
      phases: additions.phases.length + updates.phases.length,
      activities: additions.activities.length + updates.activities.length,
      document_requests: additions.document_requests.length + updates.document_requests.length,
    },
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { templateId } = await params
    const template = await loadTemplate(templateId)

    if (!template) {
      return NextResponse.json({ error: 'Template negăsit' }, { status: 404 })
    }
    if (template.status !== 'published') {
      return NextResponse.json({ error: 'Preview-ul de propagare este permis doar pentru template-uri publicate' }, { status: 400 })
    }

    const { data: projects, error: projectsError } = await supabaseAdmin
      .from('projects')
      .select('id, title')
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })

    if (projectsError) throw projectsError

    const projectPreviews = await Promise.all((projects ?? []).map(project => buildProjectPreview(project, template)))
    const eligible = projectPreviews.filter(project => project.eligible)
    const ineligible = projectPreviews.filter(project => !project.eligible)
    const additionTotals = eligible.reduce(
      (acc, project) => {
        acc.phases += project.totals.phases
        acc.activities += project.totals.activities
        acc.document_requests += project.totals.document_requests
        return acc
      },
      { phases: 0, activities: 0, document_requests: 0 }
    )

    return NextResponse.json({
      template: { id: template.id, name: template.name },
      eligible,
      ineligible,
      totals: {
        ...additionTotals,
        candidate_projects: projectPreviews.length,
        eligible_projects: eligible.length,
        ineligible_projects: ineligible.length,
      },
    })
  } catch (error: any) {
    console.error('POST propagation preview error:', error)
    return NextResponse.json({ error: error.message ?? 'Server error' }, { status: 500 })
  }
}
