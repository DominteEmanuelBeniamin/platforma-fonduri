// app/api/projects/route.ts
import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '../_utils/auth'
import { canCreateProjects } from '@/lib/project-permissions'
import { createSupabaseServiceClient } from '../_utils/supabase'
import { inactiveReferenceConflict } from '../_utils/inactive-reference'
import { logProjectAction, getClientIP, getUserAgent } from '../_utils/audit'

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0
}

export async function GET(request: Request) {
  try {
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const { user, profile } = ctx
    const callerId = user.id

    const admin = createSupabaseServiceClient()

    // Admin: toate proiectele
    if (profile.role === 'admin') {
      const { data, error } = await admin
        .from('projects')
        .select('*, profiles!projects_client_id_fkey(full_name, cif, is_active), template:project_templates(id, name)')
        .order('created_at', { ascending: false })

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ projects: data ?? [] })
    }

    // Client: doar proiectele lui
    if (profile.role === 'client') {
      const { data, error } = await admin
        .from('projects')
        .select('*, profiles!projects_client_id_fkey(full_name, cif, is_active), template:project_templates(id, name)')
        .eq('client_id', callerId)
        .order('created_at', { ascending: false })

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ projects: data ?? [] })
    }

    // Consultant: doar proiectele unde e membru
    if (profile.role === 'consultant') {
      const { data: memberships, error: memErr } = await admin
        .from('project_members')
        .select('project_id')
        .eq('consultant_id', callerId)

      if (memErr) return NextResponse.json({ error: 'Failed to load memberships' }, { status: 500 })

      const projectIds = (memberships ?? [])
        .map(m => m.project_id)
        .filter((x): x is string => typeof x === 'string')

      if (projectIds.length === 0) {
        return NextResponse.json({ projects: [] })
      }

      const { data, error } = await admin
        .from('projects')
        .select('*, profiles!projects_client_id_fkey(full_name, cif, is_active), template:project_templates(id, name)')
        .in('id', projectIds)
        .order('created_at', { ascending: false })

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ projects: data ?? [] })
    }

    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } catch (e: unknown) {
    const error = e as Error
    console.error('GET /api/projects error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const { user, profile } = ctx

    // Dosare noi deschid doar adminul și consultantul senior; juniorul nu.
    if (!canCreateProjects(profile)) {
      return NextResponse.json(
        { error: 'Forbidden: doar adminul și consultanții seniori deschid dosare' },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { title, client_id, supervisor_ids } = body as { title?: unknown; client_id?: unknown; supervisor_ids?: unknown }

    if (!isNonEmptyString(title)) {
      return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 })
    }
    if (!isNonEmptyString(client_id)) {
      return NextResponse.json({ error: 'client_id must be a non-empty string' }, { status: 400 })
    }

    const cleanTitle = title.trim()
    if (cleanTitle.length > 120) {
      return NextResponse.json({ error: 'title is too long (max 120 chars)' }, { status: 400 })
    }

    // Supervizorii: cel puțin un consultant senior, care devine membru al
    // proiectului și îl administrează de la început (issue #104).
    if (!Array.isArray(supervisor_ids) || !supervisor_ids.every(isNonEmptyString)) {
      return NextResponse.json({ error: 'supervisor_ids must be an array of consultant ids' }, { status: 400 })
    }
    const supervisorIds = [...new Set(supervisor_ids.map(id => id.trim()))]
    if (supervisorIds.length === 0) {
      return NextResponse.json({ error: 'Alege cel puțin un supervizor (consultant senior).' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    // Supervizorii și clientul se verifică în paralel: nu depind unul de altul.
    const [
      { data: supervisors, error: supervisorsError },
      { data: clientProfile, error: clientError },
    ] = await Promise.all([
      admin
        .from('profiles')
        .select('id, email, full_name, role, consultant_level, is_active')
        .in('id', supervisorIds),
      admin
        .from('profiles')
        .select('id, role, email, full_name, cif, is_active')
        .eq('id', client_id)
        .maybeSingle(),
    ])

    if (supervisorsError) {
      console.error('supervisors lookup error:', supervisorsError)
      return NextResponse.json({ error: 'Failed to validate supervisor_ids' }, { status: 500 })
    }
    // Un senior dezactivat n-ar mai putea gestiona dosarul: nu poate fi supervizor.
    const validSupervisors = (supervisors ?? []).filter(s =>
      s.role === 'consultant' && s.consultant_level === 'senior' && s.is_active !== false)
    if (validSupervisors.length !== supervisorIds.length) {
      return NextResponse.json({ error: 'Supervizorii trebuie să fie consultanți seniori activi.' }, { status: 400 })
    }

    // Validăm că clientul există
    if (clientError) {
      console.error('client lookup error:', clientError)
      return NextResponse.json({ error: 'Failed to validate client_id' }, { status: 500 })
    }
    if (!clientProfile) {
      return NextResponse.json({ error: 'client_id not found' }, { status: 404 })
    }
    if (clientProfile.role !== 'client') {
      return NextResponse.json(
        { error: 'client_id must belong to a user with role=client' },
        { status: 400 }
      )
    }
    if (clientProfile.is_active === false) {
      return NextResponse.json({ error: 'Clientul trebuie să aibă un cont activ.' }, { status: 409 })
    }

    // Inserăm proiectul
    const { data: project, error: insertError } = await admin
      .from('projects')
      .insert({
        title: cleanTitle,
        client_id: client_id,
        status: 'contractare'
      })
      .select('*, profiles!projects_client_id_fkey(full_name, cif, is_active)')
      .single()

    if (insertError) {
      const inactive = inactiveReferenceConflict(insertError, 'Nu poți crea proiectul cu un cont dezactivat.')
      if (inactive) return NextResponse.json(inactive.body, { status: inactive.status })
      return NextResponse.json({ error: insertError.message }, { status: 400 })
    }

    // Supervizorii și, dacă e consultant, cel care creează proiectul devin
    // membri dintr-un singur insert. Fără ei proiectul n-ar avea cine să-l
    // administreze, deci la eșec proiectul abia creat se șterge.
    const memberIds = new Set(supervisorIds)
    if (profile.role === 'consultant') memberIds.add(user.id)
    const { error: memberError } = await admin
      .from('project_members')
      .insert([...memberIds].map(consultant_id => ({ project_id: project.id, consultant_id, role_in_project: 'member' })))

    if (memberError) {
      console.error('project members insert error:', memberError)
      const { error: cleanupError } = await admin.from('projects').delete().eq('id', project.id)
      if (cleanupError) {
        console.error('project cleanup after member insert failure:', cleanupError)
        return NextResponse.json({ error: 'Proiectul nu a putut fi finalizat sau curățat. Contactează un administrator.' }, { status: 500 })
      }
      const inactive = inactiveReferenceConflict(memberError, 'Nu poți adăuga un cont dezactivat în echipa proiectului.')
      if (inactive) return NextResponse.json(inactive.body, { status: inactive.status })
      return NextResponse.json({ error: 'Nu am putut adăuga supervizorii în proiect.' }, { status: 500 })
    }

    // ✅ AUDIT LOG - Creare proiect
    await logProjectAction({
      adminId: user.id,
      actionType: 'create',
      projectId: project.id,
      projectTitle: project.title,
      oldValues: null,
      newValues: {
        title: project.title,
        client_id: project.client_id,
        client_email: clientProfile.email,
        client_name: clientProfile.full_name,
        client_cif: clientProfile.cif,
        status: project.status,
        cod_intern: project.cod_intern,
        supervisors: validSupervisors.map(s => s.email ?? s.full_name ?? s.id),
      },
      description: `${profile.email || 'User'} a creat proiectul "${project.title}" pentru clientul ${clientProfile.email || clientProfile.full_name || client_id}`,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request)
    })

    return NextResponse.json({ message: 'Project created', project }, { status: 201 })
  } catch (e: unknown) {
    const error = e as Error
    console.error('POST /api/projects error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}
