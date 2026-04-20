/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

// GET /api/my-document-requests
// Returnează cererile de documente generale (fără activitate) în așteptare
// din proiectele consultantului — folosit pe dashboard-ul principal
export async function GET(request: Request) {
  try {
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    // Clienții nu au acces la această secțiune
    if (ctx.profile.role === 'client') {
      return NextResponse.json({ requests: [] })
    }

    const admin = createSupabaseServiceClient()

    // Obținem project_ids accesibile
    let projectIds: string[] = []

    if (ctx.profile.role === 'admin') {
      const { data: projects } = await admin.from('projects').select('id')
      projectIds = (projects ?? []).map((p: any) => p.id)
    } else {
      // Consultant: doar proiectele unde este member
      const { data: memberships } = await admin
        .from('project_members')
        .select('project_id')
        .eq('consultant_id', ctx.profile.id)
      projectIds = (memberships ?? []).map((m: any) => m.project_id)
    }

    if (projectIds.length === 0) {
      return NextResponse.json({ requests: [] })
    }

    const { data, error } = await admin
      .from('document_requirements')
      .select(`
        id, project_id, name, description, status, deadline_at,
        reminder_sent_at, reminder_type_sent, created_at,
        project:project_id(id, title, client:profiles!projects_client_id_fkey(full_name, email))
      `)
      .in('project_id', projectIds)
      .in('status', ['pending', 'review'])
      .order('deadline_at', { ascending: true, nullsFirst: false })

    if (error) {
      console.error('GET my-document-requests error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const requests = (data ?? []).map((req: any) => ({
      id: req.id,
      name: req.name,
      description: req.description ?? null,
      status: req.status,
      deadline_at: req.deadline_at ?? null,
      reminder_sent_at: req.reminder_sent_at ?? null,
      reminder_type_sent: req.reminder_type_sent ?? null,
      created_at: req.created_at,
      project_id: req.project_id,
      project_title: (req.project as any)?.title ?? null,
      client_name: (req.project as any)?.client?.full_name ?? null,
      client_email: (req.project as any)?.client?.email ?? null,
    }))

    return NextResponse.json({ requests })
  } catch (e: any) {
    console.error('GET my-document-requests exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
