import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { templateNameChanged, templateNameConflict, templateNameTakenMessage } from '@/lib/template-name'

/**
 * 409 dacă `name` e deja numele altui șablon (D10, S-31). La redenumire
 * (`ownId`), se verifică doar un nume chiar schimbat: șabloanele vechi cu nume
 * dublat rămân editabile cât nu li se atinge numele.
 *
 * `message` poartă textul, fiindcă `apiFetch` rescrie `error` (vezi
 * app/providers/AuthProvider.tsx).
 */
export async function templateNameRefusal(
  admin: SupabaseClient,
  name: unknown,
  ownId?: string | null,
): Promise<NextResponse | null> {
  if (typeof name !== 'string' || !name.trim()) return null
  if (ownId) {
    const { data: own, error } = await admin.from('project_templates').select('name').eq('id', ownId).maybeSingle()
    if (error) throw error
    if (own && !templateNameChanged(own.name, name)) return null
  }
  const { data, error } = await admin.from('project_templates').select('id, name')
  if (error) throw error
  const clash = templateNameConflict(name, data ?? [], ownId)
  if (!clash) return null
  const message = templateNameTakenMessage(name)
  return NextResponse.json({ error: message, message, code: 'template_name_taken' }, { status: 409 })
}

export function templateNameErrorResponse(error: unknown): NextResponse | null {
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error) ||
      error.code !== 'P0001' || error.message !== 'template_name_taken') return null
  const name = 'details' in error && typeof error.details === 'string' ? error.details : ''
  const message = templateNameTakenMessage(name)
  return NextResponse.json({ error: message, message, code: 'template_name_taken' }, { status: 409 })
}
