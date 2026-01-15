import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Inițializăm Supabase cu Service Role Key (doar pe server)
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

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { userId } = body

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