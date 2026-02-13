/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/projects/route.ts
import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'
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
        .select('*, profiles(full_name, cif)')
        .order('created_at', { ascending: false })

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ projects: data ?? [] })
    }

    // Client: doar proiectele lui
    if (profile.role === 'client') {
      const { data, error } = await admin
        .from('projects')
        .select('*, profiles(full_name, cif)')
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
        .select('*, profiles(full_name, cif)')
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

    // Doar admin poate crea proiecte
    const allowed = new Set(['admin'])
    if (!allowed.has(profile.role)) {
      return NextResponse.json(
        { error: 'Forbidden: only admin can create projects' },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { title, client_id } = body as { title?: unknown; client_id?: unknown }

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

    const admin = createSupabaseServiceClient()

    // Validăm că clientul există
    const { data: clientProfile, error: clientError } = await admin
      .from('profiles')
      .select('id, role, email, full_name, cif')
      .eq('id', client_id)
      .maybeSingle()

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

    // Inserăm proiectul
    const { data: project, error: insertError } = await admin
      .from('projects')
      .insert({
        title: cleanTitle,
        client_id: client_id,
        status: 'contractare'
      })
      .select('*, profiles(full_name, cif)')
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 })
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
        cod_intern: project.cod_intern
      },
      description: `${profile.email || 'Admin'} a creat proiectul "${project.title}" pentru clientul ${clientProfile.email || clientProfile.full_name || client_id}`,
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