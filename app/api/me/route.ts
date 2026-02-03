import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'

export async function GET(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return guardToResponse(ctx)

  const admin = createSupabaseServiceClient()
  const { data: profile, error } = await admin
    .from('profiles')
    .select('*')
    .eq('id', ctx.user.id)
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }

  return NextResponse.json({ profile })
}
