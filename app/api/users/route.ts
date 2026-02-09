// import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'


export async function POST(request: Request) {
  try {

    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const body = await request.json()
    const { email, password, role, fullName } = body

    const admin = createSupabaseServiceClient()
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true // Îl validăm direct, să nu stea să dea click pe mailuri
    })

    if (authError) throw authError

    if (authData.user) {
      // 2. Îi punem Rolul și Numele în tabelul Profiles
      const { error: profileError } = await admin
        .from('profiles')
        .update({ role: role, full_name: fullName })
        .eq('id', authData.user.id)

      if (profileError) throw profileError

      // 3. Adăugăm log în audit
      const ipAddress = request.headers.get('x-forwarded-for') || 
                        request.headers.get('x-real-ip') || 
                        null

      await admin
        .from('audit_logs')
        .insert({
          user_id: ctx.profile.id, // Admin-ul care a creat utilizatorul
          action_type: 'create',
          entity_type: 'user',
          entity_id: authData.user.id,
          entity_name: email,
          new_values: { 
            role, 
            full_name: fullName, 
            email 
          },
          description: `Admin ${ctx.profile.email} a creat utilizatorul ${email} cu rolul ${role}`,
          ip_address: ipAddress
        })
    }

    return NextResponse.json({ message: 'User creat cu succes!' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
export async function GET(request: Request){
  try {

    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()
    const { data, error } = await admin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ users: data })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}