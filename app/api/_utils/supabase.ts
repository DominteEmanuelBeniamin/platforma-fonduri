// app/api/_utils/supabase.ts
import { createClient } from '@supabase/supabase-js'

function requireEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

/**
 * Client "user-context":
 * - folosește ANON key
 * - atașează automat Authorization header din request
 * - bun pentru: auth.getUser(), citire profiles/alte tabele sub RLS
 */
export function createSupabaseServerClient(request: Request) {
  const url = requireEnv('SUPABASE_URL') // server-only (nu NEXT_PUBLIC)
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!anonKey) throw new Error('Missing env: SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)')

  const authHeader = request.headers.get('authorization') || ''

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        // Supabase va folosi acest header pentru auth.getUser() și pentru RLS (dacă ai politici)
        Authorization: authHeader,
      },
    },
  })
}

/**
 * Client "service/admin":
 * - folosește SERVICE ROLE key (bypass RLS)
 * - bun pentru: uploads în Storage, insert/update forțate după ce ai verificat accesul
 */
export function createSupabaseServiceClient() {
  const url = requireEnv('SUPABASE_URL')
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
