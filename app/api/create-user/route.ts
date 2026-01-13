import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Inițializăm Supabase cu SUPER-CHEIA (doar pe server)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, password, role, fullName } = body

    // 1. Creăm userul în Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true // Îl validăm direct, să nu stea să dea click pe mailuri
    })

    if (authError) throw authError

    if (authData.user) {
      // 2. Îi punem Rolul și Numele în tabelul Profiles
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ role: role, full_name: fullName })
        .eq('id', authData.user.id)

      if (profileError) throw profileError
    }

    return NextResponse.json({ message: 'User creat cu succes!' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}