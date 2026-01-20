import { requireUserOrAdmin, requireAdmin, supabaseAdmin } from '../../_utils/auth'
import { NextResponse } from 'next/server'


type PatchBody = Partial<{
  full_name: unknown
  role: unknown
  phone_number: unknown
  cui_firma: unknown
  email: unknown
}>

function isStringOrNullOrUndef(x: unknown) {
  return x === undefined || x === null || typeof x === 'string'
}

function normalizePhone(phone: string) {
  return phone.trim()
}

function normalizeCui(cui: string) {
  return cui.trim()
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: targetUserId } = await params

    if (!targetUserId) {
      return NextResponse.json({ error: 'User ID lipsește din URL' }, { status: 400 })
    }

    // Auth: user poate edita pe el, admin poate edita pe oricine
    const auth = await requireUserOrAdmin(request, targetUserId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // Refuzăm orice încercare de a modifica email-ul
    if (body.email !== undefined) {
      return NextResponse.json({ error: 'Email cannot be updated via this endpoint' }, { status: 400 })
    }

    // Construim update doar cu câmpuri permise și valide
    const update: Record<string, any> = {}

    // full_name (permis user + admin)
    if (body.full_name !== undefined) {
      if (typeof body.full_name !== 'string' || body.full_name.trim().length === 0) {
        return NextResponse.json({ error: 'full_name must be a non-empty string' }, { status: 400 })
      }
      update.full_name = body.full_name.trim()
    }

    // phone_number (permis user + admin) - acceptăm string sau null (ca să poți șterge)
    if (body.phone_number !== undefined) {
      if (!isStringOrNullOrUndef(body.phone_number)) {
        return NextResponse.json({ error: 'phone_number must be a string or null' }, { status: 400 })
      }
      if (typeof body.phone_number === 'string') {
        update.phone_number = normalizePhone(body.phone_number)
      } else {
        update.phone_number = body.phone_number // null
      }
    }

    // cui_firma (permis user + admin) - acceptăm string sau null
    if (body.cui_firma !== undefined) {
      if (!isStringOrNullOrUndef(body.cui_firma)) {
        return NextResponse.json({ error: 'cui_firma must be a string or null' }, { status: 400 })
      }
      if (typeof body.cui_firma === 'string') {
        update.cui_firma = normalizeCui(body.cui_firma)
      } else {
        update.cui_firma = body.cui_firma // null
      }
    }

    // role (DOAR admin)
    if (body.role !== undefined) {
      if (!auth.isAdmin) {
        return NextResponse.json({ error: 'Forbidden: only admin can update role' }, { status: 403 })
      }
      if (typeof body.role !== 'string' || body.role.trim().length === 0) {
        return NextResponse.json({ error: 'role must be a non-empty string' }, { status: 400 })
      }

      const role = body.role.trim()
      const allowedRoles = new Set(['admin', 'client', 'consultant'])
      if (!allowedRoles.has(role)) {
        return NextResponse.json({ error: `Invalid role. Allowed: ${Array.from(allowedRoles).join(', ')}` }, { status: 400 })
      }

      update.role = role
    }

    // Dacă nu avem nimic de updatat
    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'Nothing to update. Allowed fields: full_name, phone_number, cui_firma, role (admin only).' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(update)
      .eq('id', targetUserId)
      .select('id, email, full_name, role, phone_number, cui_firma')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ message: 'Profile updated', profile: data })
  } catch (e: any) {
    console.error('PATCH /api/users/[id] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}


export async function DELETE(  request: Request,
  { params }: { params: Promise<{ userId: string }> }) {
  try {
    // Auth: doar admin poate șterge utilizatori
    const auth = await requireAdmin(request)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const {userId : userId} = await params

    if (!userId) {
      return NextResponse.json({ error: 'User ID lipsește' }, { status: 400 })
    }

    // 1. Ștergem toate proiectele create de user (dacă e client)
    const { error: projectsError } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('client_id', userId)
    
    if (projectsError) console.warn('Eroare la ștergere proiecte:', projectsError)

    // 2. Ștergem din project_members (dacă e consultant)
    const { error: membersError } = await supabaseAdmin
      .from('project_members')
      .delete()
      .eq('consultant_id', userId)
    
    if (membersError) console.warn('Eroare la ștergere members:', membersError)

    // 3. Ștergem cererile de documente create de user
    const { error: docsError } = await supabaseAdmin
      .from('document_requirements')
      .delete()
      .eq('created_by', userId)
    
    if (docsError) console.warn('Eroare la ștergere documente:', docsError)

    // 4. Ștergem fișierele încărcate de user
    const { error: filesError } = await supabaseAdmin
      .from('files')
      .delete()
      .eq('uploaded_by', userId)
    
    if (filesError) console.warn('Eroare la ștergere files:', filesError)

    // 5. Acum ștergem utilizatorul din Auth (asta va șterge și din profiles)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (deleteError) throw deleteError

    return NextResponse.json({ message: 'Utilizator șters cu succes!' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Eroare la ștergere user:', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

