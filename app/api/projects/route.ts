import { NextResponse } from 'next/server'
import { supabaseAdmin, requireAuth } from '../_utils/auth'

function isNonEmptyString(x: unknown) {
  return typeof x === 'string' && x.trim().length > 0
}

export async function POST(request: Request) {
  try {
    // 1) Auth: cine face requestul
    const auth = await requireAuth(request)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const callerId = auth.user.id

    // 2) Rol: doar admin/consultant pot crea proiecte
    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .single()

    if (callerProfileError) {
      return NextResponse.json({ error: 'Failed to verify caller role' }, { status: 500 })
    }

    const allowedRoles = new Set(['admin', 'consultant'])
    if (!allowedRoles.has(callerProfile?.role)) {
      return NextResponse.json(
        { error: 'Forbidden: only admin/consultant can create projects' },
        { status: 403 }
      )
    }

    // 3) Body
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { title, client_id } = body as { title?: string; client_id?: unknown }
    
    if (typeof title !== 'string' || title.trim().length === 0) {
        return NextResponse.json(
          { error: 'title must be a non-empty string' },
          { status: 400 }
        )
      }
    if (!isNonEmptyString(title)) {
      return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 })
    }

    if (!isNonEmptyString(client_id)) {
      return NextResponse.json({ error: 'client_id must be a non-empty string' }, { status: 400 })
    }

    const cleanTitle = title.trim()

    // (optional) limită de lungime, ca să eviți titluri absurde
    if (cleanTitle.length > 120) {
      return NextResponse.json({ error: 'title is too long (max 120 chars)' }, { status: 400 })
    }

    // 4) Validăm că acel client există și e "client"
    const { data: clientProfile, error: clientError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', client_id)
      .single()

    if (clientError) {
      // dacă nu există, de obicei vine ca error la .single()
      return NextResponse.json({ error: 'client_id not found' }, { status: 404 })
    }

    if (clientProfile.role !== 'client') {
      return NextResponse.json(
        { error: 'client_id must belong to a user with role=client' },
        { status: 400 }
      )
    }

    // 5) Inserăm proiectul
    const { data: project, error: insertError } = await supabaseAdmin
      .from('projects')
      .insert({
        title: cleanTitle,
        client_id,
        status: 'contractare'
      })
      .select()
      .single()

    if (insertError) {
      // dacă ai UNIQUE sau FK errors, aici le prinzi
      return NextResponse.json({ error: insertError.message }, { status: 400 })
    }

    return NextResponse.json(
      { message: 'Project created', project },
      { status: 201 }
    )
  } catch (e: any) {
    console.error('POST /api/projects error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
